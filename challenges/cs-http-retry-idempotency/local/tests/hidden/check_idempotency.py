"""Hidden property checks for the three code checkpoints.

The `generalize` checkpoint drives concurrent first attempts through a deterministic
interleave instead of trusting the operating system's scheduler. Before this existed,
a plain check-then-insert (read the receipt, see nothing, insert) passed the
eight-thread barrier test on every run: each attempt finished its read and insert in
well under a millisecond, so the window rule 9 of the statement warns about was never
actually open during grading.

Every attempt of a concurrent round runs in its own worker process: a fresh `python -I`
interpreter that loads this file by path, installs a hook around `sqlite3.connect`, and
only then imports the submission. The workers share nothing but the SQLite file. Right
after a worker fetches the result of a SELECT -- the moment a check-then-insert has
decided "absent" -- the hook reports "parked" to the coordinator over a pipe and waits.
The coordinator releases the parked workers together once every worker that can still
arrive has arrived, or 50 ms after the first of them parked when the rest are blocked
inside SQLite's busy handler. A correct implementation is not slowed down in any way
that matters: with `BEGIN IMMEDIATE` only one worker reaches the read at a time, so it
pays one stall per serialized read and nothing else. A lock or dictionary inside the
program -- in the submission's own globals or stashed on a shared module such as
`sqlite3` -- is a separate object in every worker process, exactly as behind a
pre-forking gateway, so only serialization that lives in the database can cross the
worker boundary. Every wait has a deadline, so a submission cannot deadlock the checker.

The workers are started the way `multiprocessing`'s spawn method starts a process
(`sys.executable -I -c ...` plus an inherited socketpair), but by hand: the verifier's
runner removes this suite from `sys.modules` and `sys.path` before grading, so a
pickled-by-name process target could not be resolved in the child, and a forked child
would inherit the runner's already-imported copy of the submission.
"""

from __future__ import annotations

import hashlib
import importlib.util
import itertools
import json
import multiprocessing
import signal
import sqlite3
import sqlite3.dbapi2
import subprocess
import sys
import tempfile
import threading
import time
from multiprocessing.connection import Connection, wait
from pathlib import Path
from types import ModuleType

import _sqlite3

#: Worker processes per concurrent round, one attempt each. Eight stays well inside the
#: verifier's PID and address-space budgets: every worker is one single-threaded
#: interpreter under the rlimits it inherits from the runner.
CONCURRENT_ATTEMPTS = 8
#: How long the coordinator waits for the other workers after the first one parked.
#: This is the only cost a correct implementation pays: one stall per SELECT it fetches
#: while the other workers are blocked inside SQLite waiting for its write turn.
STALL_SECONDS = 0.05
#: Upper bound for one concurrent round: handing out the attempts, the start barrier,
#: and every attempt. A worker that has not answered by then is recorded as unanswered
#: (a failed property) instead of hanging the checker until the verifier kills it.
ROUND_TIMEOUT_SECONDS = 4.0
#: Upper bound for starting the worker processes of one pool.
WORKER_START_TIMEOUT_SECONDS = 5.0
#: Wall-clock budget for the whole concurrency phase. Every wait below is capped by what
#: remains of it, so the checker returns its property list before the verifier's 15 s
#: runner timeout would discard the verdict detail.
PHASE_BUDGET_SECONDS = 12.0
#: How long a parked worker waits for its release before going on alone. A safety net
#: for a coordinator that died; a live coordinator releases within STALL_SECONDS.
RELEASE_TIMEOUT_SECONDS = 2.0
#: Each attempt arms the worker's own interval timer (SIGALRM, default action: exit) so
#: an attempt that outlives the round and possibly the coordinator cannot become an
#: orphan running participant code forever.
WORKER_ATTEMPT_ALARM_SECONDS = ROUND_TIMEOUT_SECONDS + 2.0

_copy_names = itertools.count()

#: Responses recorded for an attempt that never answered. Both are failed properties.
_UNANSWERED_EXITED = {"unanswered": "the worker process exited"}
_UNANSWERED_TIMEOUT = {"unanswered": "no response before the round deadline"}
_CLOSED = object()


class _Budget:
    """Remaining wall-clock time of one phase; every wait below is capped by it."""

    def __init__(self, seconds: float) -> None:
        self._deadline = time.monotonic() + seconds

    def remaining(self, cap: float | None = None) -> float:
        left = self._deadline - time.monotonic()
        if cap is not None:
            left = min(left, cap)
        return max(0.0, left)


# --- worker side: the sqlite3 hook and the park gate ------------------------------


class _ParkGate:
    """Worker-side half of the cross-process interleave.

    `park` is called by the sqlite3 hook right after this process fetched a SELECT
    result while an attempt is active. It reports "parked" to the coordinator and waits
    for the release with a deadline, so a dead or stalled coordinator can never
    deadlock a worker. Participant threads inside one worker park one at a time.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._connection: Connection | None = None
        self._active = False

    def bind(self, connection: Connection) -> None:
        self._connection = connection

    def start(self) -> None:
        self._active = True

    def stop(self) -> None:
        self._active = False

    def park(self) -> None:
        if not self._active:
            return
        with self._lock:
            connection = self._connection
            if not self._active or connection is None:
                return
            try:
                connection.send(("parked",))
                deadline = time.monotonic() + RELEASE_TIMEOUT_SECONDS
                remaining = RELEASE_TIMEOUT_SECONDS
                while remaining > 0 and not connection.poll(remaining):
                    remaining = deadline - time.monotonic()
                if remaining > 0:
                    # The release -- or the coordinator giving the round up, which
                    # means the same thing for this attempt: go on alone.
                    connection.recv()
            except (OSError, EOFError, ValueError):
                self._active = False


_GATE = _ParkGate()
_REAL_CONNECT = getattr(sqlite3, "_tenka_real_connect", None) or sqlite3.connect


def _reads_rows(sql: object) -> bool:
    """True for a statement whose fetched result is a decision input (a read)."""
    if not isinstance(sql, str):
        return False
    text = sql.lstrip()
    while text.startswith(("--", "/*")):
        if text.startswith("--"):
            newline = text.find("\n")
            text = "" if newline < 0 else text[newline + 1 :].lstrip()
        else:
            end = text.find("*/")
            text = "" if end < 0 else text[end + 2 :].lstrip()
    return text[:6].upper().startswith(("SELECT", "WITH", "VALUES"))


class _HookedCursor(sqlite3.Cursor):
    """A cursor that parks its process the first time it fetches from a read."""

    _pending = False

    def execute(self, sql, parameters=(), /):  # noqa: ANN001 - sqlite3 signature
        self._pending = False
        result = super().execute(sql, parameters)
        self._pending = _reads_rows(sql)
        return result

    def executemany(self, sql, seq_of_parameters, /):  # noqa: ANN001
        self._pending = False
        return super().executemany(sql, seq_of_parameters)

    def executescript(self, sql_script, /):  # noqa: ANN001
        self._pending = False
        return super().executescript(sql_script)

    def fetchone(self):  # noqa: ANN201
        row = super().fetchone()
        self._observed()
        return row

    def fetchmany(self, size=None):  # noqa: ANN001, ANN201
        rows = super().fetchmany(self.arraysize if size is None else size)
        self._observed()
        return rows

    def fetchall(self):  # noqa: ANN201
        rows = super().fetchall()
        self._observed()
        return rows

    def __next__(self):  # noqa: ANN204
        row = super().__next__()
        self._observed()
        return row

    def _observed(self) -> None:
        if self._pending:
            self._pending = False
            _GATE.park()


class _HookedConnection(sqlite3.Connection):
    """A connection whose cursors are `_HookedCursor`.

    The C implementation of `Connection.execute` builds its cursor without going
    through a Python-level `cursor()` override, so both shortcuts are re-routed here.
    """

    def cursor(self, factory=None):  # noqa: ANN001, ANN201
        return super().cursor(_hooked_cursor_factory(factory))

    def execute(self, sql, parameters=(), /):  # noqa: ANN001, ANN201
        return self.cursor().execute(sql, parameters)

    def executemany(self, sql, seq_of_parameters, /):  # noqa: ANN001, ANN201
        return self.cursor().executemany(sql, seq_of_parameters)


def _hooked_cursor_factory(factory: object) -> object:
    if factory is None:
        return _HookedCursor
    if isinstance(factory, type) and issubclass(factory, _HookedCursor):
        return factory
    if isinstance(factory, type) and issubclass(factory, sqlite3.Cursor):
        try:
            return type(f"Hooked{factory.__name__}", (_HookedCursor, factory), {})
        except TypeError:
            return factory
    return factory


def _hooked_connection_factory(factory: object) -> object:
    if factory is None:
        return _HookedConnection
    if isinstance(factory, type) and issubclass(factory, _HookedConnection):
        return factory
    if isinstance(factory, type) and issubclass(factory, sqlite3.Connection):
        try:
            return type(f"Hooked{factory.__name__}", (_HookedConnection, factory), {})
        except TypeError:
            return factory
    return factory


def _hooked_connect(*args, **kwargs):  # noqa: ANN002, ANN003, ANN201
    """`sqlite3.connect` with the interleave hook installed on every connection."""
    if len(args) >= 6:
        positional = list(args)
        positional[5] = _hooked_connection_factory(positional[5])
        return _REAL_CONNECT(*positional, **kwargs)
    kwargs["factory"] = _hooked_connection_factory(kwargs.get("factory"))
    return _REAL_CONNECT(*args, **kwargs)


def _install_sqlite_hook() -> None:
    """Patch every name a submission can reach `connect` through, once per process.

    Only worker processes install it, before they import the submission, so
    `from sqlite3 import connect` at the top of a submission binds the hooked function
    too. Outside an active attempt the hook is a no-op. The coordinator never installs
    it: its own reads of the ledger go through the real `sqlite3.connect`.
    """
    if getattr(sqlite3, "_tenka_real_connect", None) is not None:
        return
    sqlite3._tenka_real_connect = _REAL_CONNECT  # type: ignore[attr-defined]
    sqlite3.connect = _hooked_connect
    sqlite3.dbapi2.connect = _hooked_connect
    _sqlite3.connect = _hooked_connect


def _plain(value: object, depth: int = 0) -> object:
    """The response as plain builtins, so it crosses the pipe without importing anything.

    Equality is preserved for everything a well-formed response contains (dicts, lists,
    tuples, strings, numbers, None). Any other object becomes a marker string, which
    fails the same properties the object itself would have failed.
    """
    if depth > 12:
        return f"<{type(value).__name__}>"
    if value is None or type(value) in (bool, int, float, str, bytes):
        return value
    if isinstance(value, bool):
        return bool(value)
    if isinstance(value, int):
        return int(value)
    if isinstance(value, float):
        return float(value)
    if isinstance(value, str):
        return str(value)
    if isinstance(value, bytes):
        return bytes(value)
    if isinstance(value, dict):
        return {
            _plain(key, depth + 1) if isinstance(key, (str, int, float, bool, bytes, type(None))) else f"<{type(key).__name__}>": _plain(item, depth + 1)
            for key, item in value.items()
        }
    if isinstance(value, tuple):
        return tuple(_plain(item, depth + 1) for item in value)
    if isinstance(value, list):
        return [_plain(item, depth + 1) for item in value]
    return f"<{type(value).__name__}>"


def _send(connection: Connection, message: tuple[object, ...]) -> bool:
    try:
        connection.send(message)
        return True
    except (OSError, ValueError):
        return False


def _receive(connection: Connection, timeout: float | None) -> object:
    """One message; `None` after `timeout` seconds without one; `_CLOSED` when gone."""
    try:
        if timeout is not None and not connection.poll(timeout):
            return None
        return connection.recv()
    except (OSError, EOFError, ValueError):
        return _CLOSED


def _arm_alarm(seconds: float) -> None:
    if not hasattr(signal, "setitimer") or threading.current_thread() is not threading.main_thread():
        return
    try:
        signal.setitimer(signal.ITIMER_REAL, seconds)
    except (OSError, ValueError):
        return


def _load_participant(participant_path: str, module_name: str) -> ModuleType:
    """Import the submission in this worker the way the runner imports it: by file."""
    directory = str(Path(participant_path).resolve().parent)
    if directory not in sys.path:
        sys.path.insert(0, directory)
    spec = importlib.util.spec_from_file_location(module_name, participant_path)
    if spec is None or spec.loader is None:
        raise ImportError(module_name)
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    if not callable(getattr(module, "handle_request", None)):
        raise AttributeError("handle_request")
    return module


def _worker_main(fd: int, participant_path: str, module_name: str) -> None:
    """Entry point of one worker process: hook sqlite3, import the submission, serve.

    Protocol with the coordinator, all messages tuples: `("ready",)` or
    `("failed", exception_class)` once; then per attempt `("attempt", db_path, key,
    request)` in, `("armed",)` out, `("go",)` in, any number of `("parked",)` out each
    answered by one `("release",)` in, and `("done", response)` out. `("exit",)` or a
    closed pipe ends the worker.
    """
    connection = Connection(fd)
    _install_sqlite_hook()
    _GATE.bind(connection)
    try:
        module = _load_participant(participant_path, module_name)
    except BaseException as error:  # noqa: BLE001 - reported to the coordinator by class name
        _send(connection, ("failed", type(error).__name__))
        return
    if not _send(connection, ("ready",)):
        return
    while True:
        message = _receive(connection, None)
        if message is _CLOSED or not isinstance(message, tuple) or not message:
            return
        if message[0] == "exit":
            return
        if message[0] != "attempt" or len(message) != 4:
            continue
        _, db_path, key, request = message
        if not _send(connection, ("armed",)):
            return
        go = _receive(connection, ROUND_TIMEOUT_SECONDS + 1.0)
        if go is _CLOSED:
            return
        if not isinstance(go, tuple) or not go or go[0] != "go":
            continue
        _arm_alarm(WORKER_ATTEMPT_ALARM_SECONDS)
        _GATE.start()
        try:
            response = _call(module, Path(str(db_path)), key, request)
        except BaseException as error:  # noqa: BLE001 - SystemExit and friends fail the property too
            response = {"raised": type(error).__name__}
        finally:
            _GATE.stop()
            _arm_alarm(0.0)
        if not _send(connection, ("done", _plain(response))):
            return


# --- coordinator side: the worker pool and the interleaved round --------------------

_WORKER_BOOTSTRAP = (
    "import importlib.util, sys\n"
    "spec = importlib.util.spec_from_file_location('tenka_hidden_checker', sys.argv[1])\n"
    "module = importlib.util.module_from_spec(spec)\n"
    "spec.loader.exec_module(module)\n"
    "module._worker_main(int(sys.argv[2]), sys.argv[3], sys.argv[4])\n"
)


class _Worker:
    def __init__(self, index: int, process: subprocess.Popen[bytes], connection: Connection) -> None:
        self.index = index
        self.process = process
        self.connection = connection
        self.alive = True

    def send(self, message: tuple[object, ...]) -> bool:
        if not self.alive or not _send(self.connection, message):
            self.alive = False
            return False
        return True

    def receive(self) -> tuple[object, ...] | None:
        """One message, or `None` once the worker is gone (EOF, broken pipe, undecodable)."""
        try:
            message = self.connection.recv()
        except Exception:  # noqa: BLE001 - any transport or unpickling failure means the worker is gone
            self.alive = False
            return None
        if not isinstance(message, tuple) or not message:
            return ("",)
        return message

    def kill(self) -> None:
        self.alive = False
        try:
            self.process.kill()
        except OSError:
            pass

    def close(self) -> None:
        self.send(("exit",))
        self.alive = False
        try:
            self.connection.close()
        except OSError:
            pass
        try:
            self.process.wait(timeout=1.0)
        except subprocess.TimeoutExpired:
            self.kill()
            self.process.wait()


class _WorkerPool:
    """`count` worker processes serving the submission at `module.__file__`.

    `failures` names, property-style, why the pool could not be started (the program
    could not be imported in a fresh process, a process could not be created, ...).
    """

    def __init__(self, module: ModuleType, count: int, budget: _Budget) -> None:
        self.failures: list[str] = []
        self._workers: list[_Worker] = []
        self._budget = budget
        self._start(module, count)

    def __enter__(self) -> _WorkerPool:
        return self

    def __exit__(self, *_exc_info: object) -> None:
        self.close()

    def _start(self, module: ModuleType, count: int) -> None:
        participant = Path(str(getattr(module, "__file__", "")))
        checker = Path(__file__).resolve()
        if not participant.is_file() or not sys.executable:
            self.failures.append("the program could not be started as separate worker processes")
            return
        for index in range(count):
            parent_end, child_end = multiprocessing.Pipe()
            try:
                process = subprocess.Popen(
                    [
                        sys.executable,
                        "-I",
                        "-c",
                        _WORKER_BOOTSTRAP,
                        str(checker),
                        str(child_end.fileno()),
                        str(participant),
                        str(module.__name__),
                    ],
                    pass_fds=(child_end.fileno(),),
                    stdin=subprocess.DEVNULL,
                    close_fds=True,
                )
            except (OSError, ValueError) as error:
                parent_end.close()
                child_end.close()
                self.failures.append(
                    f"a worker process could not be started ({type(error).__name__})"
                )
                return
            child_end.close()
            self._workers.append(_Worker(index, process, parent_end))
        pending = {worker.connection: worker for worker in self._workers}
        while pending:
            timeout = self._budget.remaining(WORKER_START_TIMEOUT_SECONDS)
            arrived = wait(list(pending), timeout) if timeout > 0 else []
            if not arrived:
                self.failures.append("a worker process did not start in time")
                return
            for connection in arrived:
                worker = pending.pop(connection)
                message = worker.receive()
                if message is None:
                    self.failures.append("a worker process exited before it could import the program")
                elif message[0] == "failed":
                    detail = message[1] if len(message) > 1 else "Exception"
                    self.failures.append(
                        f"the program could not be imported in a separate worker process ({detail})"
                    )
                elif message[0] != "ready":
                    self.failures.append("a worker process did not report that it was ready")

    def run_round(
        self, db_path: Path, attempts: list[tuple[str, dict[str, object]]]
    ) -> list[object]:
        """Run one interleaved round: attempt i goes to worker i, all on `db_path`.

        Every worker confirms it holds its attempt before any of them is told to go, so
        all of them reach their receipt read together unless the submission itself keeps
        them out with SQLite. Parked workers are released as one generation when
        parked + finished reaches the number of workers that started (everyone that can
        still arrive has arrived) or STALL_SECONDS after the first of them parked.
        """
        results: list[object] = [_UNANSWERED_EXITED] * len(attempts)
        deadline = time.monotonic() + self._budget.remaining(ROUND_TIMEOUT_SECONDS)

        waiting: dict[Connection, int] = {}
        for index, (worker, (key, request)) in enumerate(zip(self._workers, attempts)):
            if worker.send(("attempt", str(db_path), key, request)):
                waiting[worker.connection] = index
        armed: list[int] = []
        while waiting:
            arrived = wait(list(waiting), max(deadline - time.monotonic(), 0.0))
            if not arrived:
                break
            for connection in arrived:
                index = waiting.pop(connection)
                message = self._workers[index].receive()
                if message is not None and message[0] == "armed":
                    armed.append(index)
        pending: dict[Connection, int] = {}
        for index in armed:
            worker = self._workers[index]
            if worker.send(("go",)):
                pending[worker.connection] = index
        parties = len(pending)
        finished = 0
        parked: list[int] = []
        stall_deadline: float | None = None
        while pending:
            now = time.monotonic()
            if stall_deadline is not None and now >= stall_deadline:
                self._release(parked)
                parked, stall_deadline = [], None
                continue
            if now >= deadline:
                break
            until = deadline if stall_deadline is None else min(deadline, stall_deadline)
            for connection in wait(list(pending), max(until - now, 0.0)):
                index = pending[connection]
                message = self._workers[index].receive()
                if message is None:
                    del pending[connection]
                    finished += 1
                    results[index] = _UNANSWERED_EXITED
                elif message[0] == "parked":
                    parked.append(index)
                    if stall_deadline is None:
                        stall_deadline = time.monotonic() + STALL_SECONDS
                elif message[0] == "done":
                    del pending[connection]
                    finished += 1
                    results[index] = message[1] if len(message) > 1 else _UNANSWERED_EXITED
            if parked and len(parked) + finished >= parties:
                self._release(parked)
                parked, stall_deadline = [], None
        for connection, index in pending.items():
            # Still inside participant code after the deadline: unusable for the next
            # round, and its alarm would end it anyway.
            results[index] = _UNANSWERED_TIMEOUT
            self._workers[index].kill()
        return results

    def _release(self, parked: list[int]) -> None:
        for index in parked:
            self._workers[index].send(("release",))

    def close(self) -> None:
        for worker in self._workers:
            worker.close()
        self._workers = []


def _seeded_text(seed: str, label: str, width: int = 16) -> str:
    return hashlib.sha256(f"{seed}:{label}".encode("utf-8")).hexdigest()[:width]


def _operation(seed: str, label: str) -> tuple[str, dict[str, object]]:
    """One phase-specific operation the participant has not seen in public tests.

    Values change with the verifier seed as well as the property label. A submission
    that special-cases the old fixed ``pay:hidden-*`` keys or payloads therefore fails
    on the next deploy instead of passing every code checkpoint.
    """
    digest = hashlib.sha256(f"{seed}:{label}:amount".encode("utf-8")).digest()
    amount = 1_000 + int.from_bytes(digest[:4], "big") % 900_000
    return (
        f"pay:{_seeded_text(seed, label + ':key', 24)}",
        {
            "account": f"acct-{_seeded_text(seed, label + ':account', 12)}",
            "amount": amount,
            "memo": f"memo-{_seeded_text(seed, label + ':memo', 18)}",
        },
    )


def _ledger_count(db_path: Path) -> int:
    if not db_path.exists():
        return 0
    with sqlite3.connect(db_path) as connection:
        tables = {
            row[0]
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        return (
            int(connection.execute("SELECT COUNT(*) FROM ledger").fetchone()[0])
            if "ledger" in tables
            else 0
        )


def _ledger_rows(db_path: Path) -> list[tuple[object, ...]]:
    if not db_path.exists():
        return []
    try:
        with sqlite3.connect(db_path) as connection:
            return list(
                connection.execute(
                    "SELECT account, amount, memo FROM ledger ORDER BY id"
                ).fetchall()
            )
    except sqlite3.Error:
        return []


def _rows_for(db_path: Path, request: dict[str, object]) -> int:
    """How many ledger rows carry exactly this request's account, amount, and memo."""
    wanted = (request["account"], request["amount"], request["memo"])
    return sum(1 for row in _ledger_rows(db_path) if tuple(row) == wanted)


def _has_sqlite_receipt(
    db_path: Path,
    key: str,
    request: dict[str, object],
    response: object,
) -> bool:
    """Find the documented durable receipt without prescribing a table name.

    The participant contract requires one SQLite row to bind the idempotency key,
    canonical request fingerprint, response status, and serialized response body.
    Looking across user tables keeps that contract schema-neutral while rejecting a
    process cache or sidecar file that merely happens to replay the same behavior.
    """
    if not isinstance(response, dict) or response.get("status") != 201:
        return False
    body = response.get("body")
    if not isinstance(body, dict):
        return False
    canonical = json.dumps(request, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    fingerprint = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    if not db_path.exists():
        return False
    try:
        with sqlite3.connect(db_path) as connection:
            tables = [
                str(row[0])
                for row in connection.execute(
                    """SELECT name FROM sqlite_master
                       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"""
                )
            ]
            for table in tables:
                quoted = '"' + table.replace('"', '""') + '"'
                for row in connection.execute(f"SELECT * FROM {quoted}"):
                    values = list(row)
                    if key not in values or fingerprint not in values or 201 not in values:
                        continue
                    for value in values:
                        if isinstance(value, bytes):
                            try:
                                value = value.decode("utf-8")
                            except UnicodeDecodeError:
                                continue
                        if not isinstance(value, str):
                            continue
                        try:
                            stored_body = json.loads(value)
                        except (TypeError, ValueError):
                            continue
                        if stored_body == body:
                            return True
    except sqlite3.Error:
        return False
    return False


def _backup_sqlite(source: Path, destination: Path) -> bool:
    """Copy only SQLite state, deliberately excluding adjacent sidecar files."""
    try:
        with sqlite3.connect(source) as source_connection:
            with sqlite3.connect(destination) as destination_connection:
                source_connection.backup(destination_connection)
    except sqlite3.Error:
        return False
    return True


def _sqlite_only_recovery_properties(
    module: ModuleType,
    db_path: Path,
    key: str,
    request: dict[str, object],
    response: object,
) -> list[str]:
    """Prove the SQLite file alone is sufficient for replay and conflict.

    A row scan alone can be gamed by mirroring receipt-looking columns into the
    ledger while consulting an adjacent JSON file. Independent SQLite backups remove
    every sibling file before fresh handler instances exercise both decision paths.
    """
    failures: list[str] = []
    replay_copy = db_path.with_name(f"{db_path.stem}-sqlite-replay.sqlite")
    conflict_copy = db_path.with_name(f"{db_path.stem}-sqlite-conflict.sqlite")
    if not _backup_sqlite(db_path, replay_copy) or not _backup_sqlite(db_path, conflict_copy):
        return ["the completed operation could not be recovered from a SQLite backup"]

    replayed = _call(_fresh(module), replay_copy, key, request)
    if replayed != response or _ledger_count(replay_copy) != 1:
        failures.append("a SQLite-only backup did not replay the exact stored response")

    changed = {**request, "amount": int(request["amount"]) + 1}
    conflict = _call(_fresh(module), conflict_copy, key, changed)
    if conflict != {"status": 409, "body": {"error": "idempotency_conflict"}}:
        failures.append("a SQLite-only backup did not retain the key/request binding")
    if _ledger_count(conflict_copy) != 1:
        failures.append("a conflict recovered from SQLite changed the ledger")
    return failures


def _call(module: ModuleType, db_path: Path, key: object, request: object) -> object:
    try:
        return module.handle_request(db_path, key, request)
    except Exception as error:  # noqa: BLE001 - participant exceptions are a failed property
        return {"raised": type(error).__name__}


def _fresh(module: ModuleType) -> ModuleType:
    """A second, independent copy of the submission: fresh module globals, same file."""
    path = Path(str(getattr(module, "__file__", "")))
    if not path.is_file():
        return module
    spec = importlib.util.spec_from_file_location(
        f"participant_copy_{next(_copy_names)}", path
    )
    if spec is None or spec.loader is None:
        return module
    fresh = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fresh)
    return fresh


def _replay_properties(module: ModuleType, seed: str, phase: str) -> list[str]:
    failures: list[str] = []
    with tempfile.TemporaryDirectory() as directory:
        db_path = Path(directory) / "replay.sqlite"
        key, request_a = _operation(seed, f"{phase}:replay")
        # Reorder the same fields to prove the fingerprint is canonical rather than a
        # hash of dict insertion order or source JSON bytes.
        request_b = {
            "memo": request_a["memo"],
            "amount": request_a["amount"],
            "account": request_a["account"],
        }
        first = _call(module, db_path, key, request_a)
        second = _call(module, db_path, key, request_b)
        if first != second:
            failures.append("same key and canonical request did not replay the exact status/body")
        if not isinstance(first, dict) or first.get("status") != 201:
            failures.append("the first valid operation did not return status 201")
        body = first.get("body") if isinstance(first, dict) else None
        expected_body_fields = {
            "account": request_a["account"],
            "amount": request_a["amount"],
            "memo": request_a["memo"],
        }
        if (
            not isinstance(body, dict)
            or set(body) != {"chargeId", "account", "amount", "memo"}
            or not isinstance(body.get("chargeId"), str)
            or not body.get("chargeId")
            or any(body.get(name) != value for name, value in expected_body_fields.items())
        ):
            failures.append("an unseen valid request was not preserved in the response body")
        expected_ledger = [
            (request_a["account"], request_a["amount"], request_a["memo"])
        ]
        if _ledger_rows(db_path) != expected_ledger:
            failures.append("the durable business effect did not preserve the unseen request")
        if _ledger_count(db_path) != 1:
            failures.append("a sequential retry changed the ledger or did not leave one durable receipt")
        if not _has_sqlite_receipt(db_path, key, request_a, first):
            failures.append("the key, fingerprint, status, and body were not stored together in SQLite")
        failures.extend(_sqlite_only_recovery_properties(module, db_path, key, request_a, first))
    return failures


def _binding_and_validation_properties(module: ModuleType, seed: str, phase: str) -> list[str]:
    failures = _replay_properties(module, seed, phase)
    with tempfile.TemporaryDirectory() as directory:
        db_path = Path(directory) / "binding.sqlite"
        key, original = _operation(seed, f"{phase}:binding")
        changed = {**original, "amount": int(original["amount"]) + 1}
        created = _call(module, db_path, key, original)
        conflict = _call(module, db_path, key, changed)
        if not isinstance(created, dict) or created.get("status") != 201:
            failures.append("a valid first operation was not created")
        if conflict != {"status": 409, "body": {"error": "idempotency_conflict"}}:
            failures.append("same key with a different valid request was not a 409 conflict")
        if _ledger_count(db_path) != 1:
            failures.append("a conflicting request changed the ledger or receipt")
        if not _has_sqlite_receipt(db_path, key, original, created):
            failures.append("the original durable SQLite receipt was missing after a conflict")

        recovery_key, recovery_request = _operation(seed, f"{phase}:validation-recovery")
        invalid_key = _call(module, db_path, "", original)
        invalid_request = _call(
            module,
            db_path,
            recovery_key,
            {"account": recovery_request["account"], "amount": 0},
        )
        recovered = _call(module, db_path, recovery_key, recovery_request)
        if invalid_key != {"status": 400, "body": {"error": "invalid_idempotency_key"}}:
            failures.append("an invalid key did not fail first with the documented 400")
        if invalid_request != {"status": 400, "body": {"error": "invalid_request"}}:
            failures.append("an invalid request did not return the documented 400")
        if not isinstance(recovered, dict) or recovered.get("status") != 201:
            failures.append("validation consumed an idempotency key before a valid operation")
        if _ledger_count(db_path) != 2:
            failures.append("validation or conflict produced an unexpected side effect")
        if not _has_sqlite_receipt(db_path, recovery_key, recovery_request, recovered):
            failures.append("the recovered key did not leave its durable receipt in SQLite")
    return failures


def _same_key_round_properties(
    responses: list[object],
    db_path: Path,
    key: str,
    request: dict[str, object],
    label: str,
) -> list[str]:
    """Properties of one key's concurrent first attempts. Messages name the property only."""
    failures: list[str] = []
    raised = sorted(
        {
            str(response["raised"])
            for response in responses
            if isinstance(response, dict) and "raised" in response
        }
    )
    if raised:
        failures.append(
            f"{label}: a concurrent first attempt raised {', '.join(raised)} instead of returning a response"
        )
    unanswered = sorted(
        {
            str(response["unanswered"])
            for response in responses
            if isinstance(response, dict) and "unanswered" in response
        }
    )
    if unanswered:
        failures.append(
            f"{label}: a concurrent first attempt did not return a response ({', '.join(unanswered)})"
        )
    if not responses or any(response != responses[0] for response in responses):
        failures.append(f"{label}: concurrent first attempts did not all receive the same stored response")
    rows = _rows_for(db_path, request)
    if rows > 1:
        failures.append(
            f"{label}: concurrent first attempts ({CONCURRENT_ATTEMPTS} worker processes "
            f"sharing one SQLite file) created more than one business effect for one key"
        )
    elif rows == 0:
        failures.append(f"{label}: concurrent first attempts did not create the business effect")
    if responses and not _has_sqlite_receipt(db_path, key, request, responses[0]):
        failures.append(f"{label}: concurrent creation did not leave one complete SQLite receipt")
    return failures


def _unique(items: list[str]) -> list[str]:
    seen: list[str] = []
    for item in items:
        if item not in seen:
            seen.append(item)
    return seen


def _concurrency_and_restart_properties(module: ModuleType, seed: str, phase: str) -> list[str]:
    failures = _binding_and_validation_properties(module, seed, phase)
    budget = _Budget(PHASE_BUDGET_SECONDS)

    with _WorkerPool(module, CONCURRENT_ATTEMPTS, budget) as pool:
        if pool.failures:
            return failures + _unique(pool.failures)

        # Round 1: one key, eight simultaneous first attempts, one worker process each.
        with tempfile.TemporaryDirectory() as directory:
            db_path = Path(directory) / "concurrent.sqlite"
            warm_key, warm_request = _operation(seed, f"{phase}:concurrent:warm-up")
            warm = _call(module, db_path, warm_key, warm_request)
            if not isinstance(warm, dict) or warm.get("status") != 201:
                failures.append("the operation created before the concurrent round was not created")
            key, request = _operation(seed, f"{phase}:concurrent")
            responses = pool.run_round(db_path, [(key, request)] * CONCURRENT_ATTEMPTS)
            failures.extend(_same_key_round_properties(responses, db_path, key, request, "one key"))
            if _ledger_count(db_path) != 2:
                failures.append("concurrent first attempts changed the ledger beyond their own row")

        # Round 2: two different keys interleaved over the same workers. Serializing
        # must not merge them: each key gets its own single row, receipt, and charge id.
        with tempfile.TemporaryDirectory() as directory:
            db_path = Path(directory) / "concurrent-mixed.sqlite"
            warm_key, warm_request = _operation(seed, f"{phase}:concurrent-mixed:warm-up")
            warm = _call(module, db_path, warm_key, warm_request)
            if not isinstance(warm, dict) or warm.get("status") != 201:
                failures.append("the operation created before the mixed concurrent round was not created")
            operations = [
                _operation(seed, f"{phase}:concurrent-mixed:{index}") for index in range(2)
            ]
            attempts = [operations[index % 2] for index in range(CONCURRENT_ATTEMPTS)]
            responses = pool.run_round(db_path, attempts)
            charge_ids: list[object] = []
            for index, (key, request) in enumerate(operations):
                own = [response for attempt, response in zip(attempts, responses) if attempt[0] == key]
                failures.extend(_same_key_round_properties(own, db_path, key, request, f"mixed key {index}"))
                if own and isinstance(own[0], dict) and isinstance(own[0].get("body"), dict):
                    charge_ids.append(own[0]["body"].get("chargeId"))
            if len(charge_ids) == 2 and charge_ids[0] == charge_ids[1]:
                failures.append("two different keys created at the same time received the same chargeId")
            if _ledger_count(db_path) != 3:
                failures.append("concurrent first attempts for two keys changed the ledger beyond their own rows")

    # Restart round: this process serves the first attempt; the retry goes to a process
    # started afterwards, which has nothing but the SQLite file to answer from.
    with tempfile.TemporaryDirectory() as directory:
        db_path = Path(directory) / "restart.sqlite"
        key, request = _operation(seed, f"{phase}:restart")
        first = _call(module, db_path, key, request)
        with _WorkerPool(module, 1, budget) as restarted:
            if restarted.failures:
                failures.extend(_unique(restarted.failures))
                second: object = _UNANSWERED_EXITED
            else:
                second = restarted.run_round(db_path, [(key, request)])[0]
        if isinstance(second, dict) and "unanswered" in second:
            failures.append(f"handler recreation did not return a response ({second['unanswered']})")
        elif first != second:
            failures.append("handler recreation lost the exact stored status/body")
        if _ledger_count(db_path) != 1:
            failures.append("handler recreation created a second business effect")
        if not _has_sqlite_receipt(db_path, key, request, first):
            failures.append("handler recreation did not replay a receipt stored in SQLite")
    return failures


def check_replay(module: ModuleType, seed: str) -> list[str]:
    return _replay_properties(module, seed, "replay-checkpoint")


def check_bind(module: ModuleType, seed: str) -> list[str]:
    return _binding_and_validation_properties(module, seed, "bind-checkpoint")


def check_generalize(module: ModuleType, seed: str) -> list[str]:
    return _concurrency_and_restart_properties(module, seed, "generalize-checkpoint")


def run(module: ModuleType, seed: str) -> list[str]:
    return _concurrency_and_restart_properties(module, seed, "full-run")
