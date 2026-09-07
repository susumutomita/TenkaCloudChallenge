"""`make inspect` — your curve, its points, and a double-and-add trace.

    make inspect          your fixture's curve and a default scalar
    make inspect K=13     the trace for any scalar

The trace branches on the scalar's bits and its work depends on them. That is the
opposite of what a constant-time implementation does, and it is why real libraries do
not multiply this way. It is here so the algorithm is legible.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def public_evidence() -> dict:
    """This deployment's public half -- the same values `verifier/server.py`'s
    `GET /public` serves, and the same ones this file has always printed.

    Issue 537/538 (Issue 543 option B2): `fixtures/generate.py` does not ship in the
    `participant` Docker stage any more (see local/Dockerfile). It derives the curve,
    the sample points and the scalars every checkpoint is graded against, and it shipped
    beside `tests/hidden/check_curve.py`, whose `_ReferenceCurve` is a complete group
    law -- the identity, the inverse, doubling, the vertical tangent and double-and-add.
    `make inspect` now runs through Compose (see the Makefile) so this process can reach
    the verifier over the network instead.
    """
    injected = os.environ.get("PUBLIC_EVIDENCE_JSON")
    if injected:
        return json.loads(injected)
    verifier_public_url = os.environ.get("VERIFIER_PUBLIC_URL")
    if verifier_public_url:
        from urllib.error import HTTPError, URLError
        from urllib.request import urlopen

        try:
            with urlopen(verifier_public_url, timeout=10) as response:  # noqa: S310
                return json.loads(response.read().decode("utf-8"))
        except (HTTPError, URLError, TimeoutError, OSError, ValueError) as error:
            # Compose health-gates the workbench on the verifier, so this normally
            # cannot happen. When it does -- a `docker compose run` against a torn-down
            # deployment -- say which service is missing instead of printing a urllib
            # traceback at somebody trying to read their fixtures.
            raise SystemExit(
                "cannot reach this deployment's verifier "
                f"({verifier_public_url}): {type(error).__name__}.\n"
                "The public evidence lives there since Issue 537/538. "
                "Start it with `make verifier-up` and try again."
            ) from error
    # Neither is set: this resolves only where `fixtures/` is actually on disk -- a
    # checkout, or the verifier/author Docker stage -- and never inside a built
    # `participant` image, so this branch does not reopen the leak above.
    from fixtures.generate import public_payload

    return public_payload(SEED)


def main() -> None:
    payload = public_evidence()
    params = payload["params"]
    p, a, b = params["p"], params["a"], params["b"]
    every = [tuple(coords) for coords in payload["points"]]
    order_two = [tuple(coords) for coords in payload["orderTwoPoints"]]
    scalar = int(os.environ.get("K") or 0) or 13

    print("検査用の値（提出しない） / health check value:", payload["healthToken"])
    print(f"曲線 / curve: y^2 = x^3 + {a}x + {b}  ({p}で割った余り / remainders under {p})")
    print(f"座標を持つ点 / coordinate pairs: {len(every)}  (Oを含めると / including O: {len(every) + 1})")
    print("2倍するとOになるy=0の点 / points with y=0:", order_two or "なし / none")
    print()
    print("最初の数個の点 / first coordinate pairs:")
    for coords in every[:8]:
        print(f"  {coords}")
    if (0, 0) in every:
        print()
        print("  (0,0)は座標を持つ点で、2倍するとOです。Oとは違います。")
        print("  (0,0) is an ordinary point; doubling it gives O. It is not O.")
    print()
    bits = [(scalar >> index) & 1 for index in range(max(scalar.bit_length(), 1))]
    print(f"2倍と足し算の記録 / double-and-add for k = {scalar}:")
    print(f"  2進表記 / binary: {scalar} = {scalar:b}; {len(bits)}桁 / steps")
    print(f"  2で割った余りを下の桁から / bits from repeated division by 2: {bits}")
    print()
    print("  1段階につき1行 / return one row per step:")
    print("    {'index', 'bit', 'accumulator_before', 'addend_before',")
    print("     'added', 'accumulator_after', 'addend_after', 'on_curve'}")
    print("  with points rendered as 'O' for the identity and '(x, y)' otherwise.")
    print()
    print("The values are not printed here -- producing them is the checkpoint. Run")
    print("`make inspect K=<n>` to see the step count and bits for another scalar.")


if __name__ == "__main__":
    main()
