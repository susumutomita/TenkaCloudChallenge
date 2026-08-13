"""Intentionally incomplete public tests: the shipped starter passes all of them."""

from __future__ import annotations

import argparse
import importlib.util
import os
import sqlite3
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SUBMISSION = Path(os.environ.get("SUBMISSION_DIR", ROOT / "starter")) / "idempotency.py"


def _load():
    spec = importlib.util.spec_from_file_location("participant_idempotency", SUBMISSION)
    if spec is None or spec.loader is None:
        raise AssertionError("could not load idempotency.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    if not hasattr(module, "handle_request"):
        raise AssertionError("idempotency.py must define handle_request()")
    return module


def _count(db_path: Path) -> int:
    if not db_path.exists():
        return 0
    with sqlite3.connect(db_path) as connection:
        found = connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='ledger'"
        ).fetchone()
        return 0 if found is None else int(connection.execute("SELECT COUNT(*) FROM ledger").fetchone()[0])


def test_single_valid_request() -> None:
    module = _load()
    with tempfile.TemporaryDirectory() as directory:
        db_path = Path(directory) / "charges.sqlite"
        response = module.handle_request(
            db_path, "pay:public-1", {"account": "acct-123", "amount": 4200, "memo": "book"}
        )
        assert response["status"] == 201
        assert response["body"]["account"] == "acct-123"
        assert response["body"]["amount"] == 4200
        assert isinstance(response["body"]["chargeId"], str)
        assert _count(db_path) == 1


def test_invalid_input_has_no_effect() -> None:
    module = _load()
    with tempfile.TemporaryDirectory() as directory:
        db_path = Path(directory) / "charges.sqlite"
        cases = [
            ("", {"account": "acct-123", "amount": 100}),
            ("pay:bad", {"account": "acct-123", "amount": 0}),
            ("pay:bad", {"account": "acct-123", "amount": True}),
        ]
        for key, request in cases:
            response = module.handle_request(db_path, key, request)
            assert response["status"] == 400
        assert _count(db_path) == 0


def test_two_different_keys_make_two_charges() -> None:
    module = _load()
    with tempfile.TemporaryDirectory() as directory:
        db_path = Path(directory) / "charges.sqlite"
        request = {"account": "acct-234", "amount": 5500}
        first = module.handle_request(db_path, "pay:public-a", request)
        second = module.handle_request(db_path, "pay:public-b", request)
        assert first["status"] == second["status"] == 201
        assert first["body"]["chargeId"] != second["body"]["chargeId"]
        assert _count(db_path) == 2


def test_output_shape() -> None:
    module = _load()
    with tempfile.TemporaryDirectory() as directory:
        response = module.handle_request(
            Path(directory) / "charges.sqlite",
            "pay:public-shape",
            {"account": "acct-345", "amount": 1700, "memo": "tea"},
        )
        assert set(response) == {"status", "body"}
        assert set(response["body"]) == {"chargeId", "account", "amount", "memo"}


def test_workbench_contract() -> None:
    if os.environ.get("BROWSER_PUBLIC_TESTS") == "1":
        return
    sys.path.insert(0, str(ROOT))
    from workbench import server

    config = server.config_payload()
    assert config["id"] == "cs-http-retry-idempotency"
    assert [item["id"] for item in config["checkpoints"]] == [
        "environment", "uncertain", "audit", "replay", "bind", "generalize"
    ]
    files = server.starter_payload()
    prepared = server.prepare_submissions("public-seed", files)
    assert prepared["ok"] is True
    assert set(prepared["submissions"]) == {"environment", "replay", "bind", "generalize"}


TESTS = {
    name: value
    for name, value in globals().items()
    if name.startswith("test_") and callable(value)
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", default="")
    args = parser.parse_args()
    selected = {name: test for name, test in TESTS.items() if args.only in name}
    if not selected:
        print("no public test matched", file=sys.stderr)
        return 2
    failures: list[str] = []
    for name, test in selected.items():
        try:
            test()
            print(f"pass {name}")
        except Exception as error:  # noqa: BLE001 - test runner reports each failure
            failures.append(name)
            print(f"FAIL {name}: {type(error).__name__}: {error}")
    if failures:
        print(f"{len(failures)} failed")
        return 1
    print(f"all passed ({len(selected)})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
