"""Public tests: they check the SHAPE of your answers, not whether they are right.

They confirm classify() returns the three keys and that your generators return
integers. They cannot tell you whether P2 really accepts your out-of-range witness —
that is what the hidden verifier does, deliberately.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SUBMISSION_DIR = os.environ.get("SUBMISSION_DIR")
sys.path.insert(0, str(ROOT))
sys.path.insert(0, SUBMISSION_DIR or str(ROOT / "starter"))

from fixtures.generate import PROTOCOL_IDS, instance  # noqa: E402
from classify import PROPERTIES, classify  # noqa: E402
from counterexamples import (  # noqa: E402
    extract_witness,
    incompleteness_witness,
    unsoundness_witness,
)

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def test_classify_answers_every_protocol() -> None:
    for protocol_id in PROTOCOL_IDS:
        answer = classify(protocol_id)
        assert set(answer) == set(PROPERTIES), f"{protocol_id}: expected keys {PROPERTIES}"


def test_classify_returns_booleans() -> None:
    for protocol_id in PROTOCOL_IDS:
        for prop, value in classify(protocol_id).items():
            assert isinstance(value, bool), f"{protocol_id}.{prop} is not a boolean"


def test_generators_return_integers() -> None:
    statement = instance(SEED).as_public()
    assert isinstance(incompleteness_witness(statement), int)
    assert isinstance(unsoundness_witness(statement), int)


def test_extractor_returns_an_integer() -> None:
    from fixtures.generate import verify

    inst = instance(SEED)
    _accepted, transcript = verify("p3", inst, inst.witness)
    assert isinstance(extract_witness(transcript), int)


def main() -> int:
    only = ""
    if "--only" in sys.argv:
        index = sys.argv.index("--only")
        only = sys.argv[index + 1] if index + 1 < len(sys.argv) else ""

    failures = 0
    selected = 0
    for name, fn in sorted(globals().items()):
        if not name.startswith("test_") or not callable(fn):
            continue
        if only and only not in name:
            continue
        selected += 1
        try:
            fn()
            print(f"PASS {name}")
        except AssertionError as error:
            failures += 1
            print(f"FAIL {name}: {error or 'assertion failed'}")
    print()
    if selected == 0:
        print(f"no public test matched --only {only!r}")
        return 1
    print("public tests:", "all passed" if failures == 0 else f"{failures} failed")
    print()
    print("These only check the shape of your answers. The starter passes all of")
    print("them while classifying every protocol wrongly and demonstrating nothing.")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
