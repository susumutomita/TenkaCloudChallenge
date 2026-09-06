"""`make inspect` / the Portal's inspect button — this deployment's numbers, as Python.

Assignments support an optional Python scratchpad. Paper solvers read the same numbers. The expected values are NOT printed:
they are what the learner calculates. The other person's secret is not printed.
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
    `P2` back as lists. Which keys those are is carried by the payload itself rather
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
    print("== この問題の公開値 / Public values for this problem ==")
    print("紙で計算できます。Pythonを使う場合だけ、この代入文をコピーできます。 / Copy these assignments only if using Python.")
    print()
    print(payload["assignments"])
    print()
    print("== 名前 / Names ==")
    print("p,a,b: Y² と X³+aX+b をpで割った余りが等しい点を使います / points where Y² and X³+aX+b have the same remainder after division by p")
    print("G: 繰り返し足す点 / point to add repeatedly; Gx,Gy: 横と縦 / horizontal and vertical values")
    print("t: 掛けてpで割ると1余る相手を探す数 / find a number that multiplies with t to leave remainder 1 after division by p")
    print("Q: 違う点の足し算に使う点 / second point for addition")
    print("x,r,e: 練習する人の秘密・使い捨ての数・質問 / practice secret, one-time random number, question number")
    print("P1,e1,s1,e2,s2: 別の人が同じrで違う質問へ返した2応答 / two responses to different questions using the same random number r")
    print("P2,ef: 別の秘密から作った公開する点・先に見える質問 / a public point made from another secret, and the question number shown early")
    print("欄4でGの倍数表を作り、nを求めて後の欄でも使います。")
    print("O is the special point acting as zero. In field 4, count additions of G until O; call the count n and keep that table.")



if __name__ == "__main__":
    main()
