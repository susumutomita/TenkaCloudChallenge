"""Hidden property checks for the three code checkpoints."""

from __future__ import annotations

import importlib.util
import hashlib
import sqlite3
import tempfile
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import ModuleType


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


def _call(module: ModuleType, db_path: Path, key: object, request: object) -> object:
    try:
        return module.handle_request(db_path, key, request)
    except Exception as error:  # noqa: BLE001 - participant exceptions are a failed property
        return {"raised": type(error).__name__}


def _fresh(module: ModuleType) -> ModuleType:
    path = Path(str(getattr(module, "__file__", "")))
    if not path.is_file():
        return module
    spec = importlib.util.spec_from_file_location(f"participant_restart_{id(module)}", path)
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
    return failures


def _concurrency_and_restart_properties(module: ModuleType, seed: str, phase: str) -> list[str]:
    failures = _binding_and_validation_properties(module, seed, phase)
    with tempfile.TemporaryDirectory() as directory:
        db_path = Path(directory) / "concurrent.sqlite"
        key, request = _operation(seed, f"{phase}:concurrent")
        # Eight simultaneous first attempts expose check-then-insert while remaining
        # well within the verifier's PID and address-space budgets. The trusted runner
        # bounds glibc's per-thread malloc arenas before this module is imported.
        barrier = threading.Barrier(8)

        def attempt(_index: int) -> object:
            barrier.wait(timeout=5)
            return _call(module, db_path, key, request)

        with ThreadPoolExecutor(max_workers=8) as pool:
            responses = list(pool.map(attempt, range(8)))
        if not responses or any(response != responses[0] for response in responses):
            failures.append("concurrent retries did not all receive the same stored response")
        if _ledger_count(db_path) != 1:
            failures.append("concurrent first attempts created more than one business effect")

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
    return failures


def check_replay(module: ModuleType, seed: str) -> list[str]:
    return _replay_properties(module, seed, "replay-checkpoint")


def check_bind(module: ModuleType, seed: str) -> list[str]:
    return _binding_and_validation_properties(module, seed, "bind-checkpoint")


def check_generalize(module: ModuleType, seed: str) -> list[str]:
    return _concurrency_and_restart_properties(module, seed, "generalize-checkpoint")


def run(module: ModuleType, seed: str) -> list[str]:
    return _concurrency_and_restart_properties(module, seed, "full-run")
