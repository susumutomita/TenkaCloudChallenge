"""Break the reference eight ways and require the hidden properties to notice."""

from __future__ import annotations

import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tests.hidden.check_session import run

REFERENCE = (Path(__file__).parent / "reference" / "session.py").read_text(encoding="utf-8")
# Issue 440: scaffold-leftover guard は tests/hidden に check_*.py 1 本だけを許す。
# これは hidden test ではなく mutation suite が読む author 専用の mutant なので、
# reference/ と同格の mutants/ へ置く (参加者 image には元から入らない)。
PATCHED_SWITCH_MUTANT = (Path(__file__).parent / "mutants" / "sidecar_mutant.py").read_text(
    encoding="utf-8"
)
SEED = "mutation-suite-seed"

MUTATIONS: list[tuple[str, str, str]] = [
    (
        "ignores the state and branches on the message type alone",
        '        destination = TRANSITIONS.get((self.state, kind))\n        if destination is None:\n            return _error("unexpected_message")',
        '        destination = {"HELLO": "greeted", "AUTH": "ready", "DATA": "ready", "BYE": "closed"}.get(kind)\n        if destination is None:\n            return _error("unexpected_message")',
    ),
    (
        "lets a closed session be reopened",
        '    ("ready", "BYE"): "closed",\n}',
        '    ("ready", "BYE"): "closed",\n    ("closed", "HELLO"): "greeted",\n}',
    ),
    (
        "accepts DATA before the client has authenticated",
        '    ("ready", "DATA"): "ready",',
        '    ("ready", "DATA"): "ready",\n    ("greeted", "DATA"): "ready",',
    ),
    (
        "ignores an unexpected message instead of refusing it",
        '        destination = TRANSITIONS.get((self.state, kind))\n        if destination is None:\n            return _error("unexpected_message")',
        '        destination = TRANSITIONS.get((self.state, kind))\n        if destination is None:\n            return {"ok": True, "state": self.state}',
    ),
    (
        "records the payload before checking whether the message is allowed",
        '        destination = TRANSITIONS.get((self.state, kind))\n        if destination is None:',
        '        if kind == "DATA":\n            self.received.append(str(message["payload"]))\n        destination = TRANSITIONS.get((self.state, kind))\n        if destination is None:',
    ),
    (
        "keeps the session state on the class instead of the instance",
        "    def __init__(self) -> None:\n        self.state = START\n        self.received: list[str] = []",
        "    state = START\n    received: list[str] = []\n\n    def __init__(self) -> None:\n        pass",
    ),
    (
        "treats a malformed message as merely unexpected",
        '            return _error("malformed_message")\n        kind = message["type"]',
        '            return _error("unexpected_message")\n        kind = message["type"]',
    ),
    (
        "accepts extra fields alongside a known message type",
        '        elif allowed != {"type"}:\n            return _error("malformed_message")',
        "        elif False:\n            return _error(\"malformed_message\")",
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

    patched_name = "patches the known bad pairs but never answers the whole space"
    try:
        failures = run(_load(PATCHED_SWITCH_MUTANT), SEED)
    except Exception as error:  # noqa: BLE001 - a crashing mutant is killed
        failures = [type(error).__name__]
    if failures:
        print(f"killed {patched_name}")
    else:
        print(f"SURVIVED {patched_name}")
        survivors.append(patched_name)

    if survivors:
        print(f"{len(survivors)} mutation(s) survived")
        return 1
    print(f"all {len(MUTATIONS) + 1} mutations killed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
