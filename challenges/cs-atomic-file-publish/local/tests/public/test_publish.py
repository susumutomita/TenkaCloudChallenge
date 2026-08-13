"""Intentionally incomplete public tests: the shipped starter passes all of them.

Every test here looks at the file *after* publish returns. That is exactly the blind
spot the problem is about, and it is why a broken publisher goes green.
"""

from __future__ import annotations

import argparse
import importlib.util
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SUBMISSION = Path(os.environ.get("SUBMISSION_DIR", ROOT / "starter")) / "publish.py"


def _load():
    spec = importlib.util.spec_from_file_location("participant_publish", SUBMISSION)
    if spec is None or spec.loader is None:
        raise AssertionError("could not load publish.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    if not hasattr(module, "publish"):
        raise AssertionError("publish.py must define publish()")
    return module


def test_creates_a_new_file() -> None:
    module = _load()
    with tempfile.TemporaryDirectory() as directory:
        target = Path(directory) / "config.json"
        result = module.publish(target, '{"mode":"green"}')
        assert result["ok"] is True
        assert result["bytes"] == len('{"mode":"green"}')
        assert target.read_text(encoding="utf-8") == '{"mode":"green"}'


def test_replaces_an_existing_file() -> None:
    module = _load()
    with tempfile.TemporaryDirectory() as directory:
        target = Path(directory) / "config.json"
        module.publish(target, "first revision")
        module.publish(target, "second revision")
        assert target.read_text(encoding="utf-8") == "second revision"


def test_shrinking_leaves_no_trailing_bytes() -> None:
    module = _load()
    with tempfile.TemporaryDirectory() as directory:
        target = Path(directory) / "config.json"
        module.publish(target, "a very long first revision indeed")
        module.publish(target, "short")
        assert target.read_text(encoding="utf-8") == "short"


def test_unicode_round_trips_as_utf8() -> None:
    module = _load()
    with tempfile.TemporaryDirectory() as directory:
        target = Path(directory) / "config.json"
        text = '{"greeting":"こんにちは"}'
        result = module.publish(target, text)
        assert target.read_bytes() == text.encode("utf-8")
        assert result["bytes"] == len(text.encode("utf-8"))


def test_invalid_input_is_rejected() -> None:
    module = _load()
    with tempfile.TemporaryDirectory() as directory:
        target = Path(directory) / "config.json"
        assert module.publish(target, 42) == {"ok": False, "error": "invalid_content"}
        assert module.publish("", "hello") == {"ok": False, "error": "invalid_target"}
        assert module.publish(Path(directory) / "missing" / "f.txt", "hello") == {
            "ok": False,
            "error": "invalid_target",
        }
        assert not target.exists()


def test_output_shape() -> None:
    module = _load()
    with tempfile.TemporaryDirectory() as directory:
        target = Path(directory) / "config.json"
        result = module.publish(target, "hello")
        assert set(result) == {"ok", "path", "bytes"}
        assert result["path"] == str(target)


def test_workbench_contract() -> None:
    if os.environ.get("BROWSER_PUBLIC_TESTS") == "1":
        return
    sys.path.insert(0, str(ROOT))
    from workbench import server

    config = server.config_payload()
    assert config["id"] == "cs-atomic-file-publish"
    assert [item["id"] for item in config["checkpoints"]] == [
        "environment", "observe", "audit", "publish", "durable", "generalize"
    ]
    files = server.starter_payload()
    prepared = server.prepare_submissions("public-seed", files)
    assert prepared["ok"] is True
    assert set(prepared["submissions"]) == {"environment", "publish", "durable", "generalize"}


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
