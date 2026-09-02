"""Hidden property checks for the three code checkpoints.

The `generalize` checkpoint drives concurrent first attempts through a deterministic
interleave instead of trusting the operating system's thread scheduler. Before this
existed, a plain check-then-insert (read the receipt, see nothing, insert) passed the
eight-thread barrier test on every run: each attempt finished its read and insert in
well under a millisecond, so the window rule 9 of the statement warns about was never
actually open during grading. Now the checker wraps `sqlite3.connect` so that every
participant thread parks right after it fetches the result of a SELECT -- the moment a
check-then-insert has decided "absent" -- and is released together with the others
once every thread that can still arrive has arrived. A correct implementation is not
slowed down in any way that matters: with `BEGIN IMMEDIATE` only one thread reaches
the read at a time, the others sit in SQLite's busy handler, and the lone parked
thread is released after a short stall. The attempts are also spread over two copies
of the participant module, the way a gateway spreads requests over worker processes,
so a lock or dictionary inside one copy cannot serialize them.
"""

from __future__ import annotations

import importlib.util
import hashlib
import itertools
import json
import sqlite3
import sqlite3.dbapi2
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import ModuleType

import _sqlite3

#: Threads per concurrent round and the number of participant-module copies they are
#: spread over. Eight stays well inside the verifier's PID and address-space budgets
#: (the trusted runner bounds glibc's per-thread malloc arenas before this module is
#: imported); two copies is the smallest deployment in which an in-process lock is
#: visibly not a serialization.
CONCURRENT_ATTEMPTS = 8
MODULE_COPIES = 2
#: How long a parked thread waits for the others before going on alone. This is the
#: only cost a correct implementation pays: one stall per SELECT it fetches while the
#: other threads are blocked inside SQLite waiting for its write turn.
STALL_SECONDS = 0.05
#: Upper bound for the start barrier; a thread that cannot even start within this is
#: released to run alone rather than failing the whole round with a BrokenBarrierError.
BARRIER_TIMEOUT_SECONDS = 5.0

_copy_names = itertools.count()


class _Interleave:
    """Turn-taking scheduler that makes check-then-insert interleave deterministically.

    A round has `parties` participant threads. Every participant that fetches from a
    SELECT parks here. Parked participants are released as one generation when
    parked + finished reaches `parties` (everyone that can still arrive has arrived) or
    when the first of them has waited `STALL_SECONDS` (the rest are blocked inside
    SQLite, which is what a correct BEGIN IMMEDIATE looks like from the outside).
    Nothing ever waits without a deadline, so a round cannot deadlock on a submission.
    """

    def __init__(self) -> None:
        self._condition = threading.Condition()
        self._local = threading.local()
        self._active = False
        self._parties = 0
        self._finished = 0
        self._parked = 0
        self._generation = 0

    def start(self, parties: int) -> None:
        with self._condition:
            self._active = True
            self._parties = parties
            self._finished = 0
            self._parked = 0

    def stop(self) -> None:
        with self._condition:
            self._active = False
            self._release()

    def join(self) -> None:
        """Mark the calling thread as a participant of the active round."""
        self._local.participant = True

    def leave(self) -> None:
        self._local.participant = False
        with self._condition:
            if not self._active:
                return
            self._finished += 1
            if self._parked and self._parked + self._finished >= self._parties:
                self._release()

    def park(self) -> None:
        """Called by the sqlite3 hook right after a participant fetched a SELECT result."""
        if not getattr(self._local, "participant", False):
            return
        with self._condition:
            if not self._active:
                return
            self._parked += 1
            generation = self._generation
            if self._parked + self._finished >= self._parties:
                self._release()
                return
            deadline = time.monotonic() + STALL_SECONDS
            while self._generation == generation:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    self._release()
                    return
                self._condition.wait(remaining)

    def _release(self) -> None:
        self._generation += 1
        self._parked = 0
        self._condition.notify_all()


# One scheduler and one real `connect` per process, registered on the sqlite3 module
# itself so that a second import of this file (mutation suite, verifier runner) reuses
# them instead of wrapping the wrapper.
_REAL_CONNECT = getattr(sqlite3, "_tenka_real_connect", None) or sqlite3.connect
_SCHEDULER: _Interleave = getattr(sqlite3, "_tenka_scheduler", None) or _Interleave()


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
    """A cursor that parks its thread the first time it fetches from a read."""

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
            _SCHEDULER.park()


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

    Installing at import time matters: the runner imports this module before the
    submission, so `from sqlite3 import connect` at the top of a submission binds the
    hooked function too. Outside an active round the hook is a no-op.
    """
    if getattr(sqlite3, "_tenka_real_connect", None) is not None:
        return
    sqlite3._tenka_real_connect = _REAL_CONNECT  # type: ignore[attr-defined]
    sqlite3._tenka_scheduler = _SCHEDULER  # type: ignore[attr-defined]
    sqlite3.connect = _hooked_connect
    sqlite3.dbapi2.connect = _hooked_connect
    _sqlite3.connect = _hooked_connect


_install_sqlite_hook()


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


def _concurrent_round(
    copies: list[ModuleType],
    db_path: Path,
    attempts: list[tuple[str, dict[str, object]]],
) -> list[object]:
    """Run one interleaved round: attempt i goes to copy i % len(copies).

    Every thread starts behind one barrier and then runs under the interleave
    scheduler, so all of them reach their receipt read before any of them may insert
    unless the submission itself keeps them out with SQLite.
    """
    barrier = threading.Barrier(len(attempts))
    _SCHEDULER.start(len(attempts))

    def attempt(index: int) -> object:
        _SCHEDULER.join()
        try:
            try:
                barrier.wait(timeout=BARRIER_TIMEOUT_SECONDS)
            except threading.BrokenBarrierError:
                pass
            key, request = attempts[index]
            return _call(copies[index % len(copies)], db_path, key, request)
        finally:
            _SCHEDULER.leave()

    try:
        with ThreadPoolExecutor(max_workers=len(attempts)) as pool:
            return list(pool.map(attempt, range(len(attempts))))
    finally:
        _SCHEDULER.stop()


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
    if not responses or any(response != responses[0] for response in responses):
        failures.append(f"{label}: concurrent first attempts did not all receive the same stored response")
    rows = _rows_for(db_path, request)
    if rows > 1:
        failures.append(
            f"{label}: concurrent first attempts ({CONCURRENT_ATTEMPTS} threads over "
            f"{MODULE_COPIES} copies of the program) created more than one business effect for one key"
        )
    elif rows == 0:
        failures.append(f"{label}: concurrent first attempts did not create the business effect")
    if responses and not _has_sqlite_receipt(db_path, key, request, responses[0]):
        failures.append(f"{label}: concurrent creation did not leave one complete SQLite receipt")
    return failures


def _concurrency_and_restart_properties(module: ModuleType, seed: str, phase: str) -> list[str]:
    failures = _binding_and_validation_properties(module, seed, phase)
    copies = [module] + [_fresh(module) for _ in range(MODULE_COPIES - 1)]

    # Round 1: one key, eight simultaneous first attempts over two copies of the module.
    with tempfile.TemporaryDirectory() as directory:
        db_path = Path(directory) / "concurrent.sqlite"
        warm_key, warm_request = _operation(seed, f"{phase}:concurrent:warm-up")
        warm = _call(module, db_path, warm_key, warm_request)
        if not isinstance(warm, dict) or warm.get("status") != 201:
            failures.append("the operation created before the concurrent round was not created")
        key, request = _operation(seed, f"{phase}:concurrent")
        responses = _concurrent_round(copies, db_path, [(key, request)] * CONCURRENT_ATTEMPTS)
        failures.extend(_same_key_round_properties(responses, db_path, key, request, "one key"))
        if _ledger_count(db_path) != 2:
            failures.append("concurrent first attempts changed the ledger beyond their own row")

    # Round 2: two different keys interleaved over the same copies. Serializing must
    # not merge them: each key gets its own single row, receipt, and charge id.
    with tempfile.TemporaryDirectory() as directory:
        db_path = Path(directory) / "concurrent-mixed.sqlite"
        warm_key, warm_request = _operation(seed, f"{phase}:concurrent-mixed:warm-up")
        warm = _call(module, db_path, warm_key, warm_request)
        if not isinstance(warm, dict) or warm.get("status") != 201:
            failures.append("the operation created before the mixed concurrent round was not created")
        operations = [
            _operation(seed, f"{phase}:concurrent-mixed:{index}") for index in range(2)
        ]
        attempts = [operations[(index // MODULE_COPIES) % 2] for index in range(CONCURRENT_ATTEMPTS)]
        responses = _concurrent_round(copies, db_path, attempts)
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

    with tempfile.TemporaryDirectory() as directory:
        db_path = Path(directory) / "restart.sqlite"
        key, request = _operation(seed, f"{phase}:restart")
        first = _call(module, db_path, key, request)
        restarted = _fresh(module)
        second = _call(restarted, db_path, key, request)
        if first != second:
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
