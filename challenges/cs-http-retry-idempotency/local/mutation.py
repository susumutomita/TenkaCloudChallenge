"""Break the reference on purpose and require the hidden properties to notice.

Two families of mutants:

- source-level mutations of the reference, one defect each;
- author-only mutant files under ``mutants/`` for defects that do not read as a
  one-line edit of the reference: a JSON sidecar as the receipt source of truth, and
  the four concurrency shapes the ``generalize`` checkpoint exists to reject (a plain
  check-then-insert, a lock inside one copy of the program, a lock stashed on the
  shared ``sqlite3`` module so every copy inside one interpreter finds it, and a
  ``BEGIN IMMEDIATE`` placed after the read).

The same directory holds ``honest_*.py``: the statement's two recipes and the
``with connection:`` idiom, written on top of the starter. They must keep passing --
if the checker ever rejects one of them, the ceiling has become a trap rather than a
property.

Every mutant is loaded from a real file, the way the verifier loads a submission, so
the checker's worker processes (which import the submission by path) and its "second
copy of the program" (``_fresh``) are exercised here too. The last block goes through
``verifier.server.evaluate`` -- the subprocess runner with its limits -- for what
cannot be expressed as a broken submission: the verifier must reject the concurrency
shapes end to end with a property-level message, still accept the reference and the
honest shapes, and still let the naive shape clear ``replay`` and ``bind`` (the floor
is unchanged).

Run inside the author image (or in CI):  python mutation.py
Exit code 0 means every mutation was killed.
"""

from __future__ import annotations

import importlib.util
import sys
import tempfile
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tests.hidden.check_idempotency import run

HERE = Path(__file__).resolve().parent
REFERENCE = (HERE / "reference" / "idempotency.py").read_text(encoding="utf-8")
# Issue 440: scaffold-leftover guard は tests/hidden に check_*.py 1 本だけを許す。
# これらは hidden test ではなく mutation suite が読む author 専用の mutant なので、
# reference/ と同格の mutants/ へ置く (参加者 image には元から入らない)。
MUTANTS_DIR = HERE / "mutants"
SEED = "mutation-suite-seed"

MUTATIONS: list[tuple[str, str, str]] = [
    (
        "always creates instead of looking up a durable receipt",
        "def _lookup_receipt(connection: sqlite3.Connection, key: str) -> tuple[object, ...] | None:\n    return connection.execute(",
        "def _lookup_receipt(connection: sqlite3.Connection, key: str) -> tuple[object, ...] | None:\n    if key:\n        return None\n    return connection.execute(",
    ),
    (
        "stores state only in a process-local in-memory database",
        'sqlite3.connect(str(db_path), timeout=10, isolation_level=None)',
        'sqlite3.connect(":memory:", timeout=10, isolation_level=None)',
    ),
    (
        "stores the receipt in a sidecar database outside the ledger file",
        '    connection.execute(\n        """CREATE TABLE IF NOT EXISTS idempotency_receipts (',
        '''    connection.execute(
        "ATTACH DATABASE ? AS receipt_store",
        (str(db_path) + ".receipts.sqlite",),
    )
    connection.execute(
        """CREATE TABLE IF NOT EXISTS receipt_store.idempotency_receipts (''',
    ),
    (
        "uses a deferred transaction, so two readers both hold only a read turn",
        'connection.execute("BEGIN IMMEDIATE")\n        stored = _lookup_receipt(connection, key)',
        'connection.execute("BEGIN")\n        stored = _lookup_receipt(connection, key)',
    ),
    (
        "takes no write turn, so the ledger row commits alone before the receipt insert fails",
        'connection.execute("BEGIN IMMEDIATE")\n        stored = _lookup_receipt(connection, key)',
        'stored = _lookup_receipt(connection, key)',
    ),
    (
        "binds only the key and ignores the request fingerprint",
        "if stored_fingerprint != fingerprint:",
        "if False:",
    ),
    (
        "manufactures a different body instead of replaying the stored response",
        'return {"status": status, "body": json.loads(body_json)}',
        'return {"status": status, "body": {**json.loads(body_json), "replayed": True}}',
    ),
    (
        "poisons a key before request validation succeeds",
        '    if normalized is None:\n        return _error(400, "invalid_request")',
        '''    if normalized is None:
        connection = _open_database(db_path)
        try:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute(
                "INSERT INTO idempotency_receipts VALUES (?, ?, ?, ?)",
                (key, "poisoned", 400, '{"error":"invalid_request"}'),
            )
            connection.commit()
        finally:
            connection.close()
        return _error(400, "invalid_request")''',
    ),
    (
        "writes a ledger effect unrelated to the accepted request",
        '(normalized["account"], normalized["amount"], normalized["memo"]),',
        '("acct-discarded", 1, ""),',
    ),
]

FILE_MUTANTS: list[tuple[str, str]] = [
    ("uses a JSON sidecar as the receipt source of truth", "sidecar_mutant.py"),
    ("reads the receipt in autocommit mode and inserts when it sees nothing", "naive_mutant.py"),
    ("serializes check-then-insert with a lock inside one copy of the program", "process_lock_mutant.py"),
    ("serializes check-then-insert with a lock stashed on the shared sqlite3 module", "shared_module_lock_mutant.py"),
    ("takes the write turn only after deciding the receipt is absent", "late_immediate_mutant.py"),
]

#: Correct programs in the shapes the statement teaches. The suite fails if any of them
#: stops passing: the ceiling must reject defects, never a documented recipe.
HONEST_SHAPES: list[tuple[str, str]] = [
    ("BEGIN IMMEDIATE before the read, in the starter's legacy isolation mode", "honest_begin_immediate.py"),
    ("PRIMARY KEY on the key column; the loser rolls back and re-reads", "honest_primary_key.py"),
    ("`with connection:` around BEGIN IMMEDIATE, the read, and both inserts", "honest_with_connection.py"),
]

#: Hidden operation values the verifier's failure message must never echo (AGENTS.md §15).
HIDDEN_VALUE_PREFIXES = ("pay:", "acct-", "memo-")


def _load(source: str, name: str, directory: Path) -> types.ModuleType:
    """Import a mutant from a real file so `_fresh` can make a second copy of it."""
    path = directory / f"{name}.py"
    path.write_text(source, encoding="utf-8")
    spec = importlib.util.spec_from_file_location(f"mutant_{name}", path)
    if spec is None or spec.loader is None:
        raise ImportError(name)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _failures(source: str, name: str, directory: Path) -> list[str]:
    try:
        return run(_load(source, name, directory), SEED)
    except Exception as error:  # noqa: BLE001 - a crashing mutant is killed
        return [type(error).__name__]


def main() -> int:
    survivors: list[str] = []
    with tempfile.TemporaryDirectory() as workspace:
        directory = Path(workspace)
        baseline = _failures(REFERENCE, "reference", directory)
        if baseline:
            print("the reference does not pass its hidden suite:")
            for failure in baseline:
                print(f"  {failure}")
            return 1
        print("reference: passes")

        for index, (name, before, after) in enumerate(MUTATIONS):
            if before not in REFERENCE:
                print(f"BROKEN {name}: mutation target is missing")
                survivors.append(name)
                continue
            failures = _failures(REFERENCE.replace(before, after, 1), f"m{index}", directory)
            if failures:
                print(f"killed {name}")
            else:
                print(f"SURVIVED {name}")
                survivors.append(name)

        for index, (name, file_name) in enumerate(FILE_MUTANTS):
            source = (MUTANTS_DIR / file_name).read_text(encoding="utf-8")
            failures = _failures(source, f"f{index}", directory)
            if failures:
                print(f"killed {name}")
            else:
                print(f"SURVIVED {name}")
                survivors.append(name)

        for index, (name, file_name) in enumerate(HONEST_SHAPES):
            source = (MUTANTS_DIR / file_name).read_text(encoding="utf-8")
            failures = _failures(source, f"h{index}", directory)
            if failures:
                survivors.append(f"the checker rejects an honest shape: {name}")
                print(f"FAIL the checker rejects an honest shape: {name}")
                for failure in failures:
                    print(f"  {failure}")
            else:
                print(f"PASS honest shape passes: {name}")

    # The verifier itself: subprocess runner, resource limits, nonce-bound verdict and
    # the §15 message. These cannot be expressed as a broken submission.
    from verifier.server import evaluate  # noqa: PLC0415 - imported late, after sys.path

    naive = (MUTANTS_DIR / "naive_mutant.py").read_text(encoding="utf-8")
    locked = (MUTANTS_DIR / "process_lock_mutant.py").read_text(encoding="utf-8")
    module_locked = (MUTANTS_DIR / "shared_module_lock_mutant.py").read_text(encoding="utf-8")
    for checkpoint in ("replay", "bind"):
        if not evaluate(checkpoint, naive)[0]:
            survivors.append(f"floor changed: the verifier rejects the naive shape on {checkpoint}")
            print(f"FAIL the verifier rejects the naive shape on {checkpoint} (floor must not move)")
        else:
            print(f"PASS the naive shape still clears {checkpoint} through the verifier")
    for name, source in (
        ("naive shape", naive),
        ("in-process lock", locked),
        ("shared-module lock", module_locked),
    ):
        correct, message = evaluate("generalize", source)
        if correct:
            survivors.append(f"verifier accepts the {name} on generalize")
            print(f"SURVIVED verifier accepts the {name} on generalize")
        elif not message:
            survivors.append(f"verifier gave no property-level message for the {name}")
            print(f"SURVIVED verifier gave no property-level message for the {name}")
        elif any(prefix in message for prefix in HIDDEN_VALUE_PREFIXES):
            survivors.append(f"verifier message for the {name} echoes a hidden value")
            print(f"SURVIVED verifier message for the {name} echoes a hidden value")
        else:
            print(f"killed verifier rejects the {name} on generalize: {message[:96]}...")
    if not evaluate("generalize", REFERENCE)[0]:
        survivors.append("verifier rejects the reference on generalize")
        print("FAIL verifier rejects the reference on generalize")
    else:
        print("PASS the reference clears generalize through the verifier")
    for name, file_name in HONEST_SHAPES:
        correct, message = evaluate("generalize", (MUTANTS_DIR / file_name).read_text(encoding="utf-8"))
        if correct:
            print(f"PASS the honest shape clears generalize through the verifier: {name}")
        else:
            survivors.append(f"verifier rejects an honest shape on generalize: {name}")
            print(f"FAIL verifier rejects an honest shape on generalize: {name}: {message[:200]}")

    if survivors:
        print(f"{len(survivors)} mutation(s) survived")
        for name in survivors:
            print(f"  - {name}")
        return 1
    print(
        f"all {len(MUTATIONS) + len(FILE_MUTANTS)} mutations killed; "
        f"{len(HONEST_SHAPES)} honest shapes pass; verifier near-miss checks pass."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
