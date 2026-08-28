"""Mutation suite: break the reference on purpose, assert the hidden tests notice.

The mutations here target the thing this problem is about — claiming a property
without demonstrating it, and demonstrating the wrong thing.

Run inside the image (or in CI):  python mutation.py
Exit code 0 means every mutation was killed.
"""

from __future__ import annotations

import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tests.hidden.check_properties import run

SEED = "mutation-suite-seed"
REFERENCE = Path(__file__).resolve().parent / "reference"

# (name, classify source or None to reuse the reference, counterexamples source or None)
MUTATIONS: list[tuple[str, str | None, str | None]] = [
    (
        "claims every protocol is fine",
        """
def classify(protocol_id):
    return {"complete": True, "sound": True, "private": True}
""",
        None,
    ),
    (
        "labels P2 unsound but demonstrates it with an in-range witness",
        None,
        """
def _solve(statement, target):
    p, a, b = statement["p"], statement["a"], statement["b"]
    return ((target - b) * pow(a, -1, p)) % p

def incompleteness_witness(statement):
    return _solve(statement, statement["c"])

def unsoundness_witness(statement):
    return _solve(statement, statement["c"])

def extract_witness(transcript):
    return int(transcript["opening"]["value"])
""",
    ),
    (
        "incompleteness witness is out of range, so it is not a valid witness at all",
        None,
        """
def _solve(statement, target):
    p, a, b = statement["p"], statement["a"], statement["b"]
    return ((target - b) * pow(a, -1, p)) % p

def incompleteness_witness(statement):
    return statement["hi"] + 1

def unsoundness_witness(statement):
    return _solve(statement, statement["c"]) + statement["p"]

def extract_witness(transcript):
    return int(transcript["opening"]["value"])
""",
    ),
    (
        "extractor returns a hard-coded value that fits one instance",
        None,
        """
def _solve(statement, target):
    p, a, b = statement["p"], statement["a"], statement["b"]
    return ((target - b) * pow(a, -1, p)) % p

def incompleteness_witness(statement):
    return _solve(statement, statement["c"])

def unsoundness_witness(statement):
    return _solve(statement, statement["c"]) + statement["p"]

def extract_witness(transcript):
    return 11
""",
    ),
    (
        "swaps soundness and privacy in the matrix",
        """
def classify(protocol_id):
    return {
        "p1": {"complete": False, "sound": True, "private": True},
        "p2": {"complete": True, "sound": True, "private": False},
        "p3": {"complete": True, "sound": False, "private": True},
    }[protocol_id]
""",
        None,
    ),
    (
        "confuses 'accepts valid input' with 'secure' and marks P2 sound",
        """
def classify(protocol_id):
    return {
        "p1": {"complete": False, "sound": True, "private": True},
        "p2": {"complete": True, "sound": True, "private": True},
        "p3": {"complete": True, "sound": True, "private": False},
    }[protocol_id]
""",
        None,
    ),
]


def _module(source: str, name: str) -> types.ModuleType:
    module = types.ModuleType(name)
    exec(compile(source, f"<{name}>", "exec"), module.__dict__)  # noqa: S102 - our own fixtures
    return module


def main() -> int:
    reference_classify = _module((REFERENCE / "classify.py").read_text(encoding="utf-8"), "ref_c")
    reference_ce = _module(
        (REFERENCE / "counterexamples.py").read_text(encoding="utf-8"), "ref_ce"
    )

    if run(reference_classify.classify, reference_ce, SEED):
        print("FAIL reference implementation does not pass the hidden tests")
        return 1
    print("PASS reference implementation passes the hidden tests")

    survivors: list[str] = []
    for name, classify_source, ce_source in MUTATIONS:
        classify = (
            _module(classify_source, "mut_c").classify
            if classify_source
            else reference_classify.classify
        )
        counterexamples = _module(ce_source, "mut_ce") if ce_source else reference_ce
        failures = run(classify, counterexamples, SEED)
        if failures:
            print(f"KILLED {name} ({failures[0]})")
        else:
            survivors.append(name)
            print(f"SURVIVED {name}")

    # The always-accept verifier cannot be expressed as a broken submission, so assert
    # end to end that a wrong submission is actually rejected.
    from verifier.server import evaluate  # noqa: PLC0415 - imported after sys.path

    for label, checkpoint, submission in (
        ("verifier accepts an all-True matrix", "property-matrix", {"p1": {}, "p2": {}, "p3": {}}),
        ("verifier accepts a non-integer witness", "unsoundness", "not-a-number"),
    ):
        if evaluate(checkpoint, submission)[0]:
            survivors.append(label)
            print(f"SURVIVED {label}")
        else:
            print(f"KILLED {label}")

    print()
    if survivors:
        print(f"{len(survivors)} mutation(s) survived:")
        for name in survivors:
            print(f"  - {name}")
        return 1
    print(f"All {len(MUTATIONS) + 2} mutations killed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
