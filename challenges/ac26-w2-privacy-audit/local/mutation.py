"""Author-side check: break the reference on purpose and confirm the hidden tests notice.

A mutation that survives means the hidden suite has a hole. Nothing here is an
equivalent mutant -- each one changes an audit verdict on at least one program, and the
list is kept honest by deleting any entry that turns out not to.

The last entry breaks the *verifier* rather than a submission: a /verify that credits
whatever it is handed would let every other test pass while grading nothing.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from tests.hidden import check_auditor  # noqa: E402

REFERENCE = (ROOT / "reference" / "auditor.py").read_text(encoding="utf-8")
SEED = "mutation-suite-seed"

MUTATIONS: tuple[tuple[str, str, str], ...] = (
    (
        "treats every log line as a leak",
        'if kind == "emit" and event["label"] not in allowed:',
        'if kind == "emit":',
    ),
    (
        "treats every share read as a cross-party read",
        'if kind == "peek" and event["party"] != event["owner"]:',
        'if kind == "peek":',
    ),
    (
        "ignores the error path entirely",
        'if kind == "fail" and event["label"] not in allowed:\n            return {"kind": "leaked-in-error", "index": index}',
        "pass",
    ),
    (
        "forgets the declared result is allowed to be revealed",
        'return sorted({*spec["publicInputs"], *spec["masked"], spec["result"]})',
        'return sorted({*spec["publicInputs"], *spec["masked"]})',
    ),
    (
        "treats the masked differences as secrets",
        'return sorted({*spec["publicInputs"], *spec["masked"], spec["result"]})',
        'return sorted({*spec["publicInputs"], spec["result"]})',
    ),
    (
        "reports the violation without locating it",
        'return {"kind": "opened-a-secret", "index": index}',
        'return {"kind": "opened-a-secret", "index": 0}',
    ),
    (
        "repairs by deleting every observable operation",
        'if kind == "open" and op[1] not in allowed:\n            continue',
        'if kind in ("open", "peek", "emit", "fail"):\n            continue',
    ),
)

VERIFIER_MUTATION = (
    "verifier credits a submission that audits nothing",
    "auditor that always returns None",
)


def _load(source: str):
    import types

    module = types.ModuleType("mutant")
    exec(compile(source, "<mutant>", "exec"), module.__dict__)  # noqa: S102 - author tool
    return module


def main() -> int:
    reference = _load(REFERENCE)
    baseline = check_auditor.run(reference, SEED)
    if baseline:
        print(f"FAIL reference implementation does not pass the hidden tests: {baseline}")
        return 1
    print("PASS reference implementation passes the hidden tests")

    survivors = 0
    for name, needle, replacement in MUTATIONS:
        if needle not in REFERENCE:
            print(f"SURVIVED {name} (the mutation no longer applies to the reference)")
            survivors += 1
            continue
        mutated = REFERENCE.replace(needle, replacement, 1)
        try:
            failures = check_auditor.run(_load(mutated), SEED)
        except Exception as error:  # noqa: BLE001 - a mutation that crashes is caught
            failures = [f"raised {type(error).__name__}"]
        if failures:
            print(f"KILLED {name} ({failures[0]})")
        else:
            print(f"SURVIVED {name}")
            survivors += 1

    # A submission that never reports anything must still fail the checkpoints that
    # feed it a leaking program. If it does not, the whole suite is decoration.
    name, _ = VERIFIER_MUTATION
    blind = _load(REFERENCE + "\n\ndef first_violation(trace, spec):\n    return None\n")
    if check_auditor.run(blind, SEED):
        print(f"KILLED {name}")
    else:
        print(f"SURVIVED {name}")
        survivors += 1

    if survivors:
        print(f"\n{survivors} mutation(s) survived. The hidden tests have a hole.")
        return 1
    print(f"\nAll {len(MUTATIONS) + 1} mutations killed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
