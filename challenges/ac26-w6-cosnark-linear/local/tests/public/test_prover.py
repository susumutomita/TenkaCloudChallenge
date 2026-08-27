"""Public tests: shapes and one honest round trip. Nothing here is hard to satisfy.

They never contrast a right answer with the plausible wrong one, never look at a
coefficient's canonical form, and never look at the log at all. The hidden verifier does all
three, and two of the eight checkpoints cannot be reached by looking at `A` and `B`.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "starter"))

from participant.mpc import ParticipantRuntime, Runtime  # noqa: E402
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
    # for a checkout (this file run directly, e.g. by scripts/ac26-w6-cosnark-linear.test.ts)
    # and the verifier/author Docker stages, and never inside a built `participant` image --
    # so this branch does not reopen the leak above.
    from fixtures.generate import public_payload

    return public_payload(SEED)


PUBLIC = _load_public_evidence()
CFG = PUBLIC["setting"]


def _fresh():
    runtime = Runtime(CFG)
    shares = runtime.deal_witness(SEED, PUBLIC["witness"], label="pw")
    row = {
        key: tuple(value) if isinstance(value, list) else value
        for key, value in PUBLIC["rows"]["dense"].items()
    }
    return runtime, shares, row


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
