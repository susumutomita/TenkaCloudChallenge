"""Public tests: shapes and one honest round trip. Nothing here is hard to satisfy.

They never check what `C` reconstructs to, never look at how many rounds the step cost, and
never look at an opening record. The hidden verifier does all three, and the checkpoint that
separates a private prover from a correct one is the last of them.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "starter"))

from participant.mpc import ParticipantRuntime, Runtime, linear_halves  # noqa: E402
import prover  # noqa: E402

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def _load_public_evidence() -> dict:
    """This deployment's setting, row and witness -- what `show.py` prints, and what this
    file has always built its runtime from.

    Issue 537/538 (Issue 543 option B2): this file used to import `fixtures.generate`
    directly. That module carries `setting`, `coefficients`, `witness` and `relation` -- the
    four derivations the hidden labels `h0`..`h3` are drawn from, and therefore the four
    every checkpoint is graded on -- and it shipped in the same image as
    `tests/hidden/check_prover.py`, which states phase by phase what each of those
    checkpoints accepts. So it does not ship in the `participant` Docker stage at all any
    more (see ../../Dockerfile). This deployment's own verifier is the only source for the
    public half now: `PUBLIC_EVIDENCE_JSON` when the Portal has already fetched it, or
    `VERIFIER_PUBLIC_URL` fetched directly when it has not.
    """
    injected = os.environ.get("PUBLIC_EVIDENCE_JSON")
    if injected:
        return json.loads(injected)
    verifier_public_url = os.environ.get("VERIFIER_PUBLIC_URL")
    if verifier_public_url:
        from urllib.request import urlopen

        with urlopen(verifier_public_url, timeout=10) as response:  # noqa: S310
            return json.loads(response.read().decode("utf-8"))
    # Neither is set: this only resolves when `fixtures/` is actually on disk, which is true
    # for a checkout (this file run directly, e.g. by scripts/ac26-w6-cosnark-beaver.test.ts)
    # and the verifier/author Docker stages, and never inside a built `participant` image --
    # so this branch does not reopen the leak above.
    from fixtures.generate import public_payload

    return public_payload(SEED)


PUBLIC = _load_public_evidence()
CFG = PUBLIC["setting"]


def _fresh():
    runtime = Runtime(CFG)
    shares = runtime.deal_witness(SEED, PUBLIC["witness"], label="pw")
    row = PUBLIC["rows"]["dense"]
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
