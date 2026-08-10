"""Break the reference seven ways and require the hidden properties to notice."""

from __future__ import annotations

import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tests.hidden.check_idempotency import run

REFERENCE = (Path(__file__).parent / "reference" / "idempotency.py").read_text(encoding="utf-8")
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
        "uses a check-then-insert deferred transaction",
        'connection.execute("BEGIN IMMEDIATE")\n        stored = _lookup_receipt(connection, key)',
        'connection.execute("BEGIN")\n        stored = _lookup_receipt(connection, key)\n        __import__("time").sleep(0.05)',
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


def _load(source: str) -> types.ModuleType:
    module = types.ModuleType("mutant")
    module.__dict__["__file__"] = "<mutant>"
    exec(compile(source, "<mutant>", "exec"), module.__dict__)  # noqa: S102 - author-only test
    return module


def main() -> int:
    baseline = run(_load(REFERENCE), SEED)
    if baseline:
        print("the reference does not pass its hidden suite:")
        for failure in baseline:
            print(f"  {failure}")
        return 1
    print("reference: passes")

    survivors: list[str] = []
    for name, before, after in MUTATIONS:
        if before not in REFERENCE:
            print(f"BROKEN {name}: mutation target is missing")
            survivors.append(name)
            continue
        source = REFERENCE.replace(before, after, 1)
        try:
            failures = run(_load(source), SEED)
        except Exception as error:  # noqa: BLE001 - a crashing mutant is killed
            failures = [type(error).__name__]
        if failures:
            print(f"killed {name}")
        else:
            print(f"SURVIVED {name}")
            survivors.append(name)

    if survivors:
        print(f"{len(survivors)} mutation(s) survived")
        return 1
    print(f"all {len(MUTATIONS)} mutations killed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
