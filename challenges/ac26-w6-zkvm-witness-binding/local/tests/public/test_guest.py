"""Public tests: shapes, plus the one answer the fixtures already handed you.

They check that a statement encodes to some bytes and encodes the same whichever order its keys
were inserted in, that a digest looks like one, that the runner ends up loaded, that a run and a
journal carry their declared fields, and that a receipt you sealed yourself verifies against the
statement you sealed it under. That last one is not a spoiler — it is the happy path, stated in
the problem text, and every guest gets it right.

What is missing is everything else. Nothing here offers a receipt against a statement one field
away from the one that sealed it, nothing hands the guest a host hint that is confidently wrong,
nothing runs the image under a semantics where the claim has no witness, nothing offers the two
accounts a length-free encoder cannot tell apart, and nothing audits a run that published an
approved name carrying the machine's own total. The hidden verifier does all five, one
checkpoint at a time.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "starter"))

from participant.lab import (  # noqa: E402
    DIGEST_HEX_LENGTH,
    JOURNAL_FIELDS,
    RUN_FIELDS,
    STATEMENT_FIELDS,
    Env,
    shuffled,
)
from show import (  # noqa: E402
    disclosure_record,
    image_record,
    public_evidence,
    witness_record,
)
import guest  # noqa: E402

# Issue 537/538 (Issue 543 option B2): `fixtures/generate.py` does not ship in the participant
# image any more -- it holds `_machine` (the whole of `run_guest`), `replay_truth` and
# `disclosure_truth`. `show.public_evidence` reads `GET /public` over the Compose-internal
# network (or `PUBLIC_EVIDENCE_JSON`, or the checkout's own fixtures when neither is set), and
# this deployment's statement, image, witness and audited runs come from there.
EVIDENCE = public_evidence()
IMAGE = image_record(EVIDENCE["image"])
STATEMENT = EVIDENCE["statement"]
WITNESS = witness_record(EVIDENCE["witness"])
DISCLOSURES = [disclosure_record(entry["disclosure"]) for entry in EVIDENCE["disclosures"]]


def _loaded() -> Env:
    env = Env()
    guest.guest_input(env, dict(STATEMENT), dict(WITNESS))
    return env


def test_encode_statement_returns_bytes() -> None:
    encoded = guest.encode_statement(dict(STATEMENT))
    assert isinstance(encoded, (bytes, bytearray))
    assert len(encoded) > 0


def test_encode_statement_does_not_depend_on_the_order_the_dict_was_built_in() -> None:
    # Two dicts that compare equal are the same statement, so they are the same bytes.
    assert guest.encode_statement(shuffled(STATEMENT)) == guest.encode_statement(dict(STATEMENT))


def test_image_digest_looks_like_a_digest_and_is_deterministic() -> None:
    digest = guest.image_digest(dict(IMAGE))
    assert isinstance(digest, str)
    assert len(digest) == DIGEST_HEX_LENGTH
    assert digest == guest.image_digest(dict(IMAGE))


def test_guest_input_publishes_the_statement_and_uses_the_private_channel() -> None:
    env = _loaded()
    assert set(env.public_inputs()) == set(STATEMENT_FIELDS)
    assert env.writes() == 1


def test_run_guest_reports_every_field_a_run_reports() -> None:
    assert set(guest.run_guest(dict(IMAGE), _loaded())) == set(RUN_FIELDS)


def test_seal_journal_publishes_every_field_a_journal_carries() -> None:
    run = guest.run_guest(dict(IMAGE), _loaded())
    assert set(guest.seal_journal(dict(STATEMENT), run)) == set(JOURNAL_FIELDS)


def test_accept_receipt_answers_rather_than_raises_on_a_receipt_that_is_not_one() -> None:
    # The verifier is called on whatever a prover sends. One that crashes on a malformed
    # receipt has turned a decision it owed its caller into an exception.
    assert isinstance(guest.accept_receipt({"journal": "..."}, dict(STATEMENT)), bool)


def test_accept_receipt_takes_a_receipt_sealed_under_this_statement() -> None:
    # The happy path, and the only one of the categories the problem text states outright.
    # A guest that gets this and nothing else clears no checkpoint.
    run = guest.run_guest(dict(IMAGE), _loaded())
    receipt = {"journal": guest.seal_journal(dict(STATEMENT), run)}
    assert guest.accept_receipt(receipt, dict(STATEMENT)) is True


def test_leak_report_returns_channel_and_name_pairs() -> None:
    reported = guest.leak_report(DISCLOSURES[0], dict(STATEMENT), dict(IMAGE))
    assert isinstance(reported, (list, tuple))
    for pair in reported:
        assert isinstance(pair, (list, tuple)) and len(pair) == 2


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
    print("Note what is missing above: nothing offers a receipt against a statement one field")
    print("away from the one that sealed it, nothing hands the guest a host hint that is")
    print("confidently wrong, nothing runs the image on a machine where the claim has no")
    print("witness, and nothing audits a run that published an approved name carrying a value")
    print("it was never approved for.")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
