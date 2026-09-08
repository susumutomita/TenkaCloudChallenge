"""Public tests: selected shapes and one participant-constructed counterexample.

The counterexample test compares the original and compacted coefficient positions.
These tests do not establish relation normalization, A/B reconstruction or truthful
log reporting for all inputs; submit the relevant checkpoint for those properties.
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


def test_sparse_counterexample_exposes_a_position_change() -> None:
    # Public construction, independent of deployment secrets. Many answers are valid.
    prime, width = 7, 3
    result = prover.sparse_counterexample(prime, width)
    assert isinstance(result, dict), "return a dictionary with a and w"
    coefficients, values = result.get("a"), result.get("w")
    for vector in (coefficients, values):
        assert isinstance(vector, (list, tuple)) and len(vector) == width, "match width"
        assert all(
            type(value) is int and 0 <= value < prime for value in vector
        ), "use canonical integers"
    assert any(
        coefficients[j] == 0 and any(coefficients[j + 1:]) for j in range(width)
    ), "include a zero before a nonzero coefficient"
    correct = sum(c * value for c, value in zip(coefficients, values)) % prime
    compact = [c for c in coefficients if c != 0]
    shifted = sum(c * value for c, value in zip(compact, values)) % prime
    assert correct != shifted, "your constructed input does not expose the position change"


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
    print("These tests check some shapes and one public counterexample construction.")
    print("They do not establish A/B reconstruction, relation normalization or log auditing")
    print("for all inputs; submit the corresponding checkpoint for those properties.")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
