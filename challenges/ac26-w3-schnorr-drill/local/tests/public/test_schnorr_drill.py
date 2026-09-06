"""Public tests — readable, and deliberately not the grader.

Two parts. Part 1 checks the scratchpad functions on the one-digit example from the free statement, whose
answers are printed in the statement — so it can say PASS / FAIL. Part 2 prints what
your functions return on THIS deployment's numbers, which is exactly what your own
python3 would print for each drill line. Those are the values you paste into the answer
fields. Nothing here knows whether they are right; the Portal does.

Run with `make test`, or press "run the public tests" in the Portal editor.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve()
ROOT = HERE.parents[2]
sys.path.insert(0, str(ROOT / "starter"))
sys.path.insert(0, str(ROOT))

import schnorr_drill as drill  # noqa: E402

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def _public_payload() -> dict:
    """This deployment's public numbers, from the verifier rather than from `fixtures/`.

    Issue 543 option B2: this file used to `from fixtures.generate import LINES,
    setting`. `fixtures/generate.py` does not ship in the `participant` Docker stage any
    more (see ../../Dockerfile), because it must define working `ec_add`, `ec_mul` and
    `order_of` -- the drill's own subject -- to derive these numbers. An import from here
    handed over `add-points`, `double` and `order` outright, and with them the three
    lines built on the order. `PUBLIC_EVIDENCE_JSON` is set when the Portal already
    fetched the payload; `VERIFIER_PUBLIC_URL` is fetched directly otherwise.
    """
    injected = os.environ.get("PUBLIC_EVIDENCE_JSON")
    if injected:
        return json.loads(injected)
    verifier_public_url = os.environ.get("VERIFIER_PUBLIC_URL")
    if verifier_public_url:
        from urllib.request import urlopen

        with urlopen(verifier_public_url, timeout=10) as response:  # noqa: S310
            return json.loads(response.read().decode("utf-8"))
    # Resolves only against a checkout or the verifier/author stage, where `fixtures/`
    # is on disk; never inside a built `participant` image.
    from fixtures.generate import public_payload

    return public_payload(SEED)


def _points_restored(payload: dict) -> dict:
    """The payload's public dict with `G`, `Q`, `P1`, `P2` back as tuples (JSON has no
    tuple, and the drill's own functions compare and print points)."""
    point_keys = frozenset(payload.get("pointKeys", ()))
    return {
        key: (tuple(value) if key in point_keys else value)
        for key, value in payload["public"].items()
    }


# Independent one-digit example from the free statement (not a deployment answer).
EXAMPLE = dict(p=5, a=3, b=2, G=(1, 1), n=5)


def _only(name: str) -> bool:
    if "--only" not in sys.argv:
        return True
    return sys.argv[sys.argv.index("--only") + 1] in name


def _check(name: str, got, expected) -> bool:
    if not _only(name):
        return True
    if isinstance(got, list):
        got = tuple(got)
    ok = got == expected
    print(f"{'PASS' if ok else 'FAIL'}  {name}: got {got!r}, expected {expected!r}")
    return ok


def part1() -> bool:
    p, a, G, n = EXAMPLE["p"], EXAMPLE["a"], EXAMPLE["G"], EXAMPLE["n"]
    ok = True
    ok &= _check("field_neg(2, 5)", drill.field_neg(2, 5), 3)
    ok &= _check("field_inv(3, 7)", drill.field_inv(3, 7), 5)
    ok &= _check("lambda_chord((1,1),(2,1), 5)", drill.lambda_chord(G, (2, 1), p), 0)
    ok &= _check("add_points((1,1),(2,1), 5)", drill.add_points(G, (2, 1), p), (2, 4))
    ok &= _check("double((1,1), 5, 3)", drill.double(G, p, a), (2, 1))
    ok &= _check("order((1,1), 5, 3)", drill.order(G, p, a), n)
    ok &= _check("pubkey(2, G)", drill.pubkey(2, G, p, a), (2, 1))
    ok &= _check("commit(2, G)", drill.commit(2, G, p, a), (2, 1))
    ok &= _check("response(r=2, e=3, x=2, n=5)", drill.response(2, 3, 2, n), 3)
    ok &= _check("verify_left(3, G)", drill.verify_left(3, G, p, a), (2, 4))
    ok &= _check("nonce_reuse(s1=0,s2=1,e1=1,e2=3,n=5)", drill.nonce_reuse(0, 1, 1, 3, n), 3)
    record = drill.transfer((2, 1), 1, G, p, a)
    # Four possible records for this PUBLIC example, from R=(s-2)*G.
    passes = isinstance(record, (list, tuple)) and tuple(record) in {(2, 4, 0), (1, 4, 1), (1, 1, 3), (2, 1, 4)}
    ok &= _check("transfer: public example equation", passes, True)
    return bool(ok)


def part2() -> None:
    payload = _public_payload()
    pub = _points_restored(payload)
    lines = payload["lines"]
    p, a, G = pub["p"], pub["a"], pub["G"]
    calls = {
        "field-neg": lambda: drill.field_neg(pub["t"], p),
        "field-inv": lambda: drill.field_inv(pub["t"], p),
        "lambda-chord": lambda: drill.lambda_chord(G, pub["Q"], p),
        "add-points": lambda: drill.add_points(G, pub["Q"], p),
        "double": lambda: drill.double(G, p, a),
        "order": lambda: drill.order(G, p, a),
        "pubkey": lambda: drill.pubkey(pub["x"], G, p, a),
        "commit": lambda: drill.commit(pub["r"], G, p, a),
        "response": lambda: drill.response(pub["r"], pub["e"], pub["x"], drill.order(G, p, a)),
        "verify": lambda: drill.verify_left(
            drill.response(pub["r"], pub["e"], pub["x"], drill.order(G, p, a)), G, p, a
        ),
        "nonce-reuse": lambda: drill.nonce_reuse(
            pub["s1"], pub["s2"], pub["e1"], pub["e2"], drill.order(G, p, a)
        ),
        "transfer": lambda: drill.transfer(
            pub["P2"], pub["ef"], G, p, a
        ),
    }
    print()
    print("== your values on THIS deployment (paste each into its answer field) ==")
    for line in lines:
        try:
            value = calls[line]()
        except Exception as error:  # noqa: BLE001 - show the learner what broke
            value = f"(error: {type(error).__name__})"
        if value is None:
            value = "(not implemented yet)"
        print(f"  {line:13s} -> {value}")


def main() -> int:
    print("== part 1: the public example (p=5, a=3, b=2, G=(1,1), n=5) ==")
    ok = part1()
    part2()
    print()
    print("public tests:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
