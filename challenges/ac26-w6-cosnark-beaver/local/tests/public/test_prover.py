"""Public tests: shapes and one honest round trip. Nothing here is hard to satisfy.

They never check what `C` reconstructs to, never look at how many rounds the step cost, and
never look at an opening record. The hidden verifier does all three, and the checkpoint that
separates a private prover from a correct one is the last of them.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "starter"))

from fixtures.generate import (  # noqa: E402
    ParticipantRuntime,
    Runtime,
    linear_halves,
    relation,
    setting,
    witness,
)
import prover  # noqa: E402

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")
CFG = setting(SEED)


def _fresh():
    runtime = Runtime(CFG)
    shares = runtime.deal_witness(SEED, witness(SEED, "public", CFG), label="pw")
    row = relation(SEED, "public", CFG, "dense")
    halves = linear_halves(runtime, row, shares)
    triple = runtime.deal_triple(SEED, "public")
    return runtime, row, halves, triple


def test_multiplication_plan_answers_every_field() -> None:
    _, row, _, _ = _fresh()
    plan = prover.multiplication_plan(dict(row))
    for key in ("products", "triples", "opens", "rounds", "messages", "local"):
        assert key in plan


def test_reserve_fresh_triple_accepts_the_triple_it_was_dealt() -> None:
    runtime, row, _, triple = _fresh()
    report = prover.reserve_fresh_triple(ParticipantRuntime(runtime), dict(row), triple)
    assert report["tripleId"] == triple.id


def test_masked_operands_returns_two_sharings() -> None:
    runtime, _, halves, triple = _fresh()
    participant = ParticipantRuntime(runtime)
    participant.reserve_triple(triple)
    masked = prover.masked_operands(participant, triple, halves)
    assert len(masked["d"]) == CFG["parties"]
    assert len(masked["e"]) == CFG["parties"]


def test_open_masks_returns_two_public_values() -> None:
    runtime, _, halves, triple = _fresh()
    participant = ParticipantRuntime(runtime)
    participant.reserve_triple(triple)
    masked = prover.masked_operands(participant, triple, halves)
    opened = prover.open_masks(participant, "public-round", masked)
    assert isinstance(opened["d"], int)
    assert isinstance(opened["e"], int)


def test_shared_product_returns_one_share_per_party() -> None:
    runtime, _, halves, triple = _fresh()
    participant = ParticipantRuntime(runtime)
    participant.reserve_triple(triple)
    masked = prover.masked_operands(participant, triple, halves)
    opened = prover.open_masks(participant, "public-round", masked)
    product = prover.shared_product(participant, triple, opened["d"], opened["e"])
    assert len(product) == CFG["parties"]


def test_prove_product_returns_every_field() -> None:
    runtime, row, halves, triple = _fresh()
    proof = prover.prove_product(ParticipantRuntime(runtime), dict(row), halves, triple)
    for key in ("A", "B", "C", "d", "e", "tripleId", "roundId", "rounds"):
        assert key in proof


def test_proof_artifact_carries_the_three_sharings() -> None:
    runtime, row, halves, triple = _fresh()
    artifact = prover.proof_artifact(ParticipantRuntime(runtime), dict(row), halves, triple)
    for key in ("A", "B", "C"):
        assert key in artifact


def test_privacy_audit_answers_every_field() -> None:
    runtime, row, halves, triple = _fresh()
    report = prover.privacy_audit(ParticipantRuntime(runtime), dict(row), halves, triple)
    for key in (
        "opened",
        "rounds",
        "unmasked",
        "violations",
        "triplesConsumed",
        "reconstructAvailable",
    ):
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
    print("Note what is missing above: nothing checks what C reconstructs to, nothing counts")
    print("the rounds, and nothing looks at an opening record.")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
