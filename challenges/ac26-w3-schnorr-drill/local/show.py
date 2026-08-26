"""`make inspect` / the Portal's inspect button — this deployment's numbers, as Python.

Everything is printed as assignment statements so the learner can paste the whole block
into `python3` and start typing the twelve lines. The expected values are NOT printed:
they are what the learner's own lines produce. The secret of the attack key is not
printed either — extracting it is line 11.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def _public_payload() -> dict:
    """This deployment's public numbers and the block to paste.

    Issue 543 option B2: `fixtures/generate.py` does not ship in the `participant`
    Docker stage any more (see local/Dockerfile). It has to define working `ec_add`,
    `ec_mul` and `order_of` to derive the numbers below -- exactly the functions
    `starter/schnorr_drill.py` asks the learner to write -- so leaving it reachable here
    handed over the point lines for the price of one import. The verifier, which is the
    only image that still carries `fixtures/`, serves the public half over
    `GET /public`: `PUBLIC_EVIDENCE_JSON` when the Portal has already fetched it,
    `VERIFIER_PUBLIC_URL` when this process must fetch it itself.
    """
    injected = os.environ.get("PUBLIC_EVIDENCE_JSON")
    if injected:
        return json.loads(injected)
    verifier_public_url = os.environ.get("VERIFIER_PUBLIC_URL")
    if verifier_public_url:
        from urllib.request import urlopen

        with urlopen(verifier_public_url, timeout=10) as response:  # noqa: S310
            return json.loads(response.read().decode("utf-8"))
    # Neither is set: this resolves only where `fixtures/` is actually on disk -- a
    # checkout, or the verifier/author Docker stage -- and never inside a built
    # `participant` image, so this branch does not reopen the leak above.
    from fixtures.generate import public_payload

    return public_payload(SEED)


def _points_restored(payload: dict) -> dict:
    """The payload's public dict with its curve points back as tuples.

    JSON has no tuple, so a payload fetched over `GET /public` hands `G`, `Q`, `P1` and
    `G2` back as lists. Which keys those are is carried by the payload itself rather
    than restated here.
    """
    point_keys = frozenset(payload.get("pointKeys", ()))
    return {
        key: (tuple(value) if key in point_keys else value)
        for key, value in payload["public"].items()
    }


def main() -> None:
    payload = _public_payload()
    pub = _points_restored(payload)
    print("== この deploy の数（そのまま Python に貼る） ==")
    print("== paste this block into python3 first ==")
    print()
    print(payload["assignments"])
    print()
    print("== what each name is ==")
    print(f"  curve      : y^2 = x^3 + {pub['a']}x + {pub['b']}  (mod {pub['p']}),  G = {pub['G']}")
    print("  t          : a trial field element for lines 1-2")
    print(f"  Q          : another point on the curve, {pub['Q']}, for lines 3-4")
    print("  x, r, e    : your secret key, your nonce, the verifier's challenge (lines 7-10)")
    print("  P1         : a DIFFERENT signer's public key, who reused one nonce for two")
    print("               challenges: (e1, s1) and (e2, s2). Its secret is not shown (line 11).")
    print("  p2, a2, b2, G2, x2, r2, e2p : the transfer curve and its key/nonce/challenge (line 12)")
    print()
    print("== what is NOT shown ==")
    print("  the order n of G (line 6 counts it), the attack signer's secret (line 11),")
    print("  and the value any line prints — those are yours to produce.")


if __name__ == "__main__":
    main()
