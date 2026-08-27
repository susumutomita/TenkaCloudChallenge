"""Public tests: shapes, and nothing that would tell you an answer.

They never say which specimens leak, never check a channel, never check an opening record,
and never check a recovered value against anything. The hidden verifier does all four, one
checkpoint at a time -- in a separate image this one cannot read (see ../../Dockerfile).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "starter"))

from participant.mpc import CLASSES  # noqa: E402
from participant.lab import (  # noqa: E402
    Scenario,
    deployment,
    probe_factory,
    run_on,
    serialized,
    value_catalog,
)
from participant.specimens import SPECIMEN_IDS  # noqa: E402
import prover  # noqa: E402

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")
# Issue 537/538 (Issue 543 option B2): the setting and the row come from the verifier's
# `GET /public` over the Compose-internal network now, not from `fixtures/generate.py`, which
# does not ship in the participant image any more. See ../../participant/lab.py.
CFG, ROW = deployment(SEED, "dense")


def _evidence(specimen_id: str = "S1"):
    return run_on(Scenario(SEED, "public", "dense"), specimen_id)


def test_classify_answers_with_one_of_the_six_classes() -> None:
    entry = value_catalog(SEED, "public", ROW)[0]
    assert prover.classify(dict(entry), dict(ROW)) in CLASSES


def test_capability_audit_returns_capability_names() -> None:
    probe = probe_factory(SEED, "public")
    reached = prover.capability_audit(probe, SPECIMEN_IDS[0])
    assert all(isinstance(name, str) for name in reached)


def test_open_set_audit_returns_opening_records() -> None:
    records = prover.open_set_audit(_evidence())
    assert all(isinstance(record, dict) for record in records)


def test_cross_party_audit_answers_every_field() -> None:
    report = prover.cross_party_audit(_evidence())
    for key in ("peeks", "parties", "crossed"):
        assert key in report


def test_leakage_audit_returns_channel_and_name_pairs() -> None:
    pairs = prover.leakage_audit(_evidence())
    assert all(len(pair) == 2 for pair in pairs)


def test_leakage_evidence_returns_nothing_or_a_finding() -> None:
    evidence = _evidence()
    found = prover.leakage_evidence(serialized(evidence.disclosure), dict(CFG))
    assert found is None or isinstance(found, dict)


def test_private_prover_returns_every_field() -> None:
    scenario = Scenario(SEED, "public", "dense")
    proof = prover.private_prover(
        scenario.audit, dict(scenario.row), scenario.halves, scenario.triple, scenario.sink
    )
    for key in ("A", "B", "C", "d", "e", "tripleId", "roundId"):
        assert key in proof


def main() -> int:
    only = ""
    if "--only" in sys.argv:
        index = sys.argv.index("--only")
        only = sys.argv[index + 1] if index + 1 < len(sys.argv) else ""
    failures = 0
    selected = 0
    for name, function in sorted(globals().items()):
        if not name.startswith("test_") or not callable(function):
            continue
        if only and only not in name:
            continue
        selected += 1
        try:
            function()
            print(f"PASS {name}")
        except AssertionError as error:
            failures += 1
            print(f"FAIL {name}: {str(error) or 'assertion failed'}")
        except Exception as error:  # noqa: BLE001
            failures += 1
            print(f"FAIL {name}: raised {type(error).__name__}")
    print()
    if selected == 0:
        print(f"no public test matched --only {only!r}")
        return 1
    print("public tests:", "all passed" if failures == 0 else f"{failures} failed")
    print()
    print("Note what is missing above: nothing says which specimens leak, nothing checks a")
    print("channel, nothing reads an opening record, and nothing checks a recovered value.")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
