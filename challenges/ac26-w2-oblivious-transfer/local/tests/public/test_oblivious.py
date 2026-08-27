"""Public tests: shape, and one successful transfer.

They check that a message arrives and that the gate returns bits. They do not check
that the sender kept anything, and they do not check that the gate hid anything.
Both of those are properties of a distribution, not of one run -- which is exactly
why a protocol can pass every test here and still be broken.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "starter"))

import oblivious  # noqa: E402

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def _load_public_evidence() -> dict:
    """This deployment's group, sender key, session and gate shares -- what `show.py`
    prints, plus the sender's exponent, which this file has always needed to call
    `encrypt` at all. A learner implements both roles here, so the sender's step is
    theirs to run; `show.py` still does not print it, because the transfer's privacy
    claim is about the receiver.

    Issue 537/538 (Issue 543 option B2): this file used to import `fixtures.generate`
    directly. That module shipped in the same image as
    `tests/hidden/check_oblivious.py`, whose assertions decide all six checkpoints, so
    it does not ship in the `participant` Docker stage at all any more (see
    ../../Dockerfile). This deployment's own verifier is the only source for the public
    half now: `PUBLIC_EVIDENCE_JSON` when the Portal has already fetched it, or
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
    # Neither is set: this only resolves when `fixtures/` is actually on disk, which is
    # true for a checkout (this file run directly, e.g. by
    # scripts/ac26-w2-oblivious-transfer.test.ts) and the verifier/author Docker stages,
    # and never inside a built `participant` image -- so this branch does not reopen the
    # leak above.
    from fixtures.generate import public_payload

    return public_payload(SEED)


PUBLIC = _load_public_evidence()
GRP = PUBLIC["group"]
KEY = PUBLIC["senderKey"]
SES = PUBLIC["session"]


def test_request_is_in_the_group() -> None:
    req = oblivious.request(GRP, KEY["public"], SES["choice"], SES["blind"])
    assert isinstance(req, int)
    assert 0 <= req < GRP["p"]


def test_blind_range_returns_two_bounds() -> None:
    low, high = oblivious.blind_range(GRP)
    assert isinstance(low, int) and isinstance(high, int)
    assert low <= high


def test_encrypt_returns_two_ciphertexts() -> None:
    req = oblivious.request(GRP, KEY["public"], SES["choice"], SES["blind"])
    cts = oblivious.encrypt(
        GRP, KEY["secret"], KEY["public"], req, SES["message_0"], SES["message_1"]
    )
    assert len(cts) == 2


def test_the_chosen_message_comes_back() -> None:
    choice = SES["choice"]
    req = oblivious.request(GRP, KEY["public"], choice, SES["blind"])
    cts = oblivious.encrypt(
        GRP, KEY["secret"], KEY["public"], req, SES["message_0"], SES["message_1"]
    )
    got = oblivious.unwrap(GRP, KEY["public"], choice, SES["blind"], cts)
    assert got == (SES["message_0"] if choice == 0 else SES["message_1"])


def test_gate_masks_returns_two_bits() -> None:
    masks = oblivious.gate_masks((0, 1))
    assert len(masks) == 2
    assert all(m in (0, 1) for m in masks)


def test_offer_returns_two_messages() -> None:
    assert len(oblivious.offer(1, 0)) == 2


def test_output_share_returns_a_bit() -> None:
    assert oblivious.output_share(1, 1, 0, 0) in (0, 1)


def test_needs_transfer_returns_a_boolean() -> None:
    assert isinstance(oblivious.needs_transfer("and"), bool)


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
        except Exception as error:  # noqa: BLE001
            failures += 1
            print(f"FAIL {name}: raised {type(error).__name__}")
    print()
    if selected == 0:
        print(f"no public test matched --only {only!r}")
        return 1
    print("public tests:", "all passed" if failures == 0 else f"{failures} failed")
    print()
    print("Nothing above checks that the sender kept a message, or that the gate hid")
    print("a bit. Those are the two things this problem is actually about.")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
