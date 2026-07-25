"""Public tests: shapes and one honest round trip. Nothing here is hard to satisfy.

They never contrast a right answer with the plausible wrong one, never look at a
coefficient's canonical form, and never look at the log at all. The hidden verifier does all
three, and two of the eight checkpoints cannot be reached by looking at `A` and `B`.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "starter"))

from fixtures.generate import ParticipantRuntime, Runtime, relation, setting, witness  # noqa: E402
import prover  # noqa: E402

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")
CFG = setting(SEED)


def _fresh():
    runtime = Runtime(CFG)
    values = witness(SEED, "public", CFG)
    shares = runtime.deal_witness(SEED, values, label="pw")
    return runtime, shares, relation(SEED, "public", CFG, "dense")


def test_parse_relation_returns_the_declared_width() -> None:
    _, _, row = _fresh()
    parsed = prover.parse_relation(dict(row))
    assert len(parsed["a"]) == CFG["width"]
    assert len(parsed["b"]) == CFG["width"]


def test_validate_shared_witness_accepts_the_witness_it_was_dealt() -> None:
    runtime, shares, row = _fresh()
    summary = prover.validate_shared_witness(ParticipantRuntime(runtime), dict(row), shares)
    assert summary["parties"] == CFG["parties"]


def test_shared_linear_combination_returns_one_share_per_party() -> None:
    runtime, shares, row = _fresh()
    result = prover.shared_linear_combination(ParticipantRuntime(runtime), row["a"], shares)
    assert len(result) == CFG["parties"]


def test_prove_linear_returns_both_halves() -> None:
    runtime, shares, row = _fresh()
    proof = prover.prove_linear(ParticipantRuntime(runtime), dict(row), shares)
    assert set(proof) == {"A", "B"}


def test_communication_report_answers_every_field() -> None:
    runtime, shares, row = _fresh()
    report = prover.communication_report(ParticipantRuntime(runtime), dict(row), shares)
    for key in ("operations", "rounds", "messages", "parties", "localOnly"):
        assert key in report


def test_no_reconstruction_report_answers_every_field() -> None:
    runtime, shares, row = _fresh()
    report = prover.no_reconstruction_report(ParticipantRuntime(runtime), dict(row), shares)
    for key in ("issued", "singleParty", "violations", "reconstructAvailable", "width"):
        assert key in report


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
    print("Note what is missing above: nothing checks what A and B reconstruct to, nothing")
    print("checks a coefficient's canonical form, and nothing reads the log.")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
