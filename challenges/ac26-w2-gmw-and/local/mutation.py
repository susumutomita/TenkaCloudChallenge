"""Mutation suite: break the reference on purpose, assert the hidden tests notice.

Each mutation is a real way this protocol gets implemented wrong, and each maps to
the checkpoint that must catch it. The last two aim at the verifier itself: a grader
that accepts half of the choice-leak answer, or an audit verdict copied from another
deployment, would be handing out points for pattern-matching.
"""

from __future__ import annotations

import json
import os
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tests.hidden.check_gmw import check_round_trip, check_wrong_branch, run

SEED = "mutation-suite-seed"
REFERENCE = (Path(__file__).resolve().parent / "reference" / "gmw.py").read_text("utf-8")

#: The one implementation shape whose every happy-path test is green: the request
#: never encodes the choice, and the sender keys both branches off the request. The
#: chosen branch opens for both choice values -- and so does the other one. Only the
#: wrong-branch probe sees it, which is what this suite pins below.
BOTH_BRANCHES_OPEN = REFERENCE.replace(
    """    request = pow(g, b, p)
    if choice == 1:
        request = (a_pub * request) % p
    return request""",
    "    return pow(g, b, p)",
).replace(
    "    key1 = pow((request * pow(a_pub, p - 2, p)) % p, a, p)",
    "    key1 = key0",
)

MUTATIONS: list[tuple[str, str]] = [
    (
        "the request ignores the choice, so branch 1 never opens",
        REFERENCE.replace(
            """    request = pow(g, b, p)
    if choice == 1:
        request = (a_pub * request) % p
    return request""",
            "    return pow(g, b, p)",
        ),
    ),
    (
        "the receiver secret range quietly forbids 0",
        REFERENCE.replace(
            "if not isinstance(b, int) or isinstance(b, bool) or not 0 <= b < q:",
            "if not isinstance(b, int) or isinstance(b, bool) or not 1 <= b < q:",
        ),
    ),
    (
        "both branches are encrypted under one key",
        REFERENCE.replace(
            "    key1 = pow((request * pow(a_pub, p - 2, p)) % p, a, p)",
            "    key1 = key0",
        ),
    ),
    (
        "gmw_and skips the OTs and ANDs locally",
        REFERENCE.replace(
            """    # Session 01: P0 -> P1, carrying x0 & y1 under mask0.
    a01_pub = pow(g, a01, p)
    request01 = ot_request(a01_pub, y1, b01, p, q, g)
    cts01 = ot_encrypt(a01, request01, mask0 ^ (x0 & 0), mask0 ^ (x0 & 1), p, q, g)
    t01 = ot_decrypt(b01, y1, a01_pub, cts01, p, q, g)

    # Session 10: P1 -> P0, carrying x1 & y0 under mask1.
    a10_pub = pow(g, a10, p)
    request10 = ot_request(a10_pub, y0, b10, p, q, g)
    cts10 = ot_encrypt(a10, request10, mask1 ^ (x1 & 0), mask1 ^ (x1 & 1), p, q, g)
    t10 = ot_decrypt(b10, y0, a10_pub, cts10, p, q, g)

    z0 = (x0 & y0) ^ mask0 ^ t10
    z1 = (x1 & y1) ^ mask1 ^ t01
    return (z0, z1)""",
            "    return (x0 & y0, x1 & y1)",
        ),
    ),
    (
        "each mask is cancelled in the other party's output share",
        REFERENCE.replace(
            """    z0 = (x0 & y0) ^ mask0 ^ t10
    z1 = (x1 & y1) ^ mask1 ^ t01""",
            """    z0 = (x0 & y0) ^ mask1 ^ t10
    z1 = (x1 & y1) ^ mask0 ^ t01""",
        ),
    ),
    (
        "the receiver forgets its own mask, trusting the OT output to be clean",
        REFERENCE.replace(
            """    z0 = (x0 & y0) ^ mask0 ^ t10
    z1 = (x1 & y1) ^ mask1 ^ t01""",
            """    z0 = (x0 & y0) ^ t10
    z1 = (x1 & y1) ^ mask1 ^ t01""",
        ),
    ),
    (
        "the shares are added where they should be XORed",
        REFERENCE.replace(
            """    z0 = (x0 & y0) ^ mask0 ^ t10
    z1 = (x1 & y1) ^ mask1 ^ t01""",
            """    z0 = (x0 & y0) + mask0 + t10
    z1 = (x1 & y1) + mask1 + t01""",
        ),
    ),
]


def _load(source: str) -> types.ModuleType:
    module = types.ModuleType("mut_gmw")
    exec(compile(source, "<mutation>", "exec"), module.__dict__)  # noqa: S102 - our own fixtures
    return module


def main() -> int:
    for name, source in MUTATIONS:
        if source == REFERENCE:
            print(f"BROKEN mutation did not change the reference: {name}")
            return 1

    if run(_load(REFERENCE), SEED):
        print("FAIL reference implementation does not pass the hidden tests")
        return 1
    print("PASS reference implementation passes the hidden tests")

    # The wrong-branch probe must be the thing standing between "it round-trips" and
    # "it is an OT". This mutant's round trip is green on both choices; if the probe
    # ever stops seeing it, a chosen-message check has silently replaced the promise.
    both_open = _load(BOTH_BRANCHES_OPEN)
    if check_round_trip(both_open, SEED):
        print("BROKEN the both-branches-open mutant no longer round-trips; the pin is stale")
        return 1
    if check_wrong_branch(both_open, SEED):
        print("KILLED both branches open under the receiver's key (round trip alone is green)")
    else:
        print("SURVIVED both branches open under the receiver's key")
        return 1

    survivors: list[str] = []
    for name, source in MUTATIONS:
        failures = run(_load(source), SEED)
        if failures:
            print(f"KILLED {name} ({failures[0]})")
        else:
            survivors.append(name)
            print(f"SURVIVED {name}")

    from fixtures.generate import audit_bits, ot_setting  # noqa: PLC0415
    from verifier.server import evaluate  # noqa: PLC0415 - imported after sys.path

    # The verifier itself, under whatever seed this process runs with.
    verifier_seed = os.environ.get("FLAG_SEED", "local-dev-seed")
    cfg = ot_setting(verifier_seed)
    a_pub = pow(cfg["g"], cfg["a"], cfg["p"])

    # Naming only one of the two deciding request values demonstrates half the leak.
    half_answer = json.dumps({"requestRevealingChoiceZero": a_pub})
    if evaluate("choice-leak", half_answer):
        survivors.append("verifier accepts a choice-leak answer with one direction missing")
        print("SURVIVED verifier accepts a choice-leak answer with one direction missing")
    else:
        print("KILLED verifier accepts a choice-leak answer with one direction missing")

    # The two directions swapped: the values are right, the understanding is not.
    swapped = json.dumps({"requestRevealingChoiceZero": 1, "requestRevealingChoiceOne": a_pub})
    if evaluate("choice-leak", swapped):
        survivors.append("verifier accepts the choice-leak directions swapped")
        print("SURVIVED verifier accepts the choice-leak directions swapped")
    else:
        print("KILLED verifier accepts the choice-leak directions swapped")

    # The right failing set with another deployment's recorded run pasted in.
    bits = audit_bits(verifier_seed)
    foreign = {name: value ^ 1 for name, value in bits.items()}
    failing = [
        [x0, x1, y0, y1]
        for x0 in (0, 1)
        for x1 in (0, 1)
        for y0 in (0, 1)
        for y1 in (0, 1)
        if ((x0 & y0) ^ (x1 & y1)) != ((x0 ^ x1) & (y0 ^ y1))
    ]
    pasted = json.dumps(
        {
            "failingPatterns": failing,
            "thisRun": {
                **foreign,
                "broken": (foreign["x0"] & foreign["y0"]) ^ (foreign["x1"] & foreign["y1"]),
                "correct": (foreign["x0"] ^ foreign["x1"]) & (foreign["y0"] ^ foreign["y1"]),
            },
        }
    )
    if evaluate("cross-term-audit", pasted):
        survivors.append("verifier accepts an audit verdict for another deployment's run")
        print("SURVIVED verifier accepts an audit verdict for another deployment's run")
    else:
        print("KILLED verifier accepts an audit verdict for another deployment's run")

    print()
    if survivors:
        print(f"{len(survivors)} mutation(s) survived:")
        for name in survivors:
            print(f"  - {name}")
        return 1
    print(f"All {len(MUTATIONS) + 4} mutations killed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
