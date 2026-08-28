"""Intentionally incomplete public tests.

Every *conversation* here follows the documented order, and the shipped starter
passes all of those. That is the blind spot the problem is about: a handler that
never asks what state it is in serves a well-behaved client perfectly.

One test is not about order at all. `test_a_message_with_an_unexpected_key_is_malformed`
covers a shape rule the starter does not implement, and it fails until you do. It is
here because the rule is graded and a participant could otherwise only discover it by
losing points: a message carrying a key beyond the ones its type declares is
malformed, and shape is judged before the state is consulted. Getting the state
machine right while leaving the shape check out is exactly the near-miss this test
exists to catch early.
"""

from __future__ import annotations

import argparse
import importlib.util
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SUBMISSION = Path(os.environ.get("SUBMISSION_DIR", ROOT / "starter")) / "session.py"


def _load():
    spec = importlib.util.spec_from_file_location("participant_session", SUBMISSION)
    if spec is None or spec.loader is None:
        raise AssertionError("could not load session.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    if not hasattr(module, "new_session"):
        raise AssertionError("session.py must define new_session()")
    return module


def test_the_documented_conversation_works() -> None:
    module = _load()
    session = module.new_session()
    assert session.handle({"type": "HELLO"})["state"] == "greeted"
    assert session.handle({"type": "AUTH"})["state"] == "ready"
    reply = session.handle({"type": "DATA", "payload": "first"})
    assert reply["ok"] is True
    assert reply["accepted"] == 1
    assert session.handle({"type": "BYE"})["state"] == "closed"


def test_several_data_messages_are_counted() -> None:
    module = _load()
    session = module.new_session()
    session.handle({"type": "HELLO"})
    session.handle({"type": "AUTH"})
    for expected in (1, 2, 3):
        assert session.handle({"type": "DATA", "payload": "x"})["accepted"] == expected


def test_an_unknown_type_is_refused() -> None:
    module = _load()
    session = module.new_session()
    assert session.handle({"type": "NOPE"}) == {"ok": False, "error": "unexpected_message"}


def test_a_malformed_message_is_reported() -> None:
    module = _load()
    session = module.new_session()
    for malformed in ("HELLO", {}, {"type": ""}, {"payload": "x"}):
        assert session.handle(malformed) == {"ok": False, "error": "malformed_message"}


def test_a_message_with_an_unexpected_key_is_malformed() -> None:
    # A key beyond the ones its type declares is a shape error, not an extra the
    # handler may ignore. The starter accepts both of these, so this one does fail
    # until the shape is actually checked.
    module = _load()
    session = module.new_session()
    assert session.handle({"type": "HELLO", "extra": 1}) == {
        "ok": False,
        "error": "malformed_message",
    }
    session = module.new_session()
    session.handle({"type": "HELLO"})
    session.handle({"type": "AUTH"})
    assert session.handle({"type": "DATA", "payload": "x", "extra": 1}) == {
        "ok": False,
        "error": "malformed_message",
    }


def test_data_without_a_payload_is_malformed() -> None:
    module = _load()
    session = module.new_session()
    session.handle({"type": "HELLO"})
    session.handle({"type": "AUTH"})
    assert session.handle({"type": "DATA"}) == {"ok": False, "error": "malformed_message"}


def test_each_session_starts_fresh() -> None:
    module = _load()
    first = module.new_session()
    first.handle({"type": "HELLO"})
    second = module.new_session()
    assert second.handle({"type": "HELLO"})["state"] == "greeted"


def test_workbench_contract() -> None:
    if os.environ.get("BROWSER_PUBLIC_TESTS") == "1":
        return
    sys.path.insert(0, str(ROOT))
    from workbench import server

    config = server.config_payload()
    assert config["id"] == "cs-protocol-state-guard"
    assert [item["id"] for item in config["checkpoints"]] == [
        "environment", "observe", "audit", "guard", "terminal", "generalize"
    ]
    files = server.starter_payload()
    prepared = server.prepare_submissions("public-seed", files)
    assert prepared["ok"] is True
    assert set(prepared["submissions"]) == {"environment", "guard", "terminal", "generalize"}


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
