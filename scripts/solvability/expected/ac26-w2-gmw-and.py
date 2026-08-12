"""Mirrors for ac26-w2-gmw-and's two direct-answer checkpoints.

`choice-leak` wants the pair of request values that decide the choice once the
receiver's b is narrowed to 1..q-1: choice 0 can no longer send the identity, choice 1
can no longer send A, so observing A decides choice 0 and observing 1 decides choice 1.

`cross-term-audit` wants the six share patterns on which the OT-skipping local AND
disagrees with the real AND, plus the verdict on this deployment's recorded run --
which is what ties the answer to the seed.
"""


def _choice_leak(server, seed):
    cfg = server.ot_setting(seed)
    a_pub = pow(cfg["g"], cfg["a"], cfg["p"])
    return {"requestRevealingChoiceZero": a_pub, "requestRevealingChoiceOne": 1}


def _cross_term_audit(server, seed):
    failing = [
        [x0, x1, y0, y1]
        for x0 in (0, 1)
        for x1 in (0, 1)
        for y0 in (0, 1)
        for y1 in (0, 1)
        if ((x0 & y0) ^ (x1 & y1)) != ((x0 ^ x1) & (y0 ^ y1))
    ]
    bits = server.audit_bits(seed)
    x0, x1, y0, y1 = bits["x0"], bits["x1"], bits["y0"], bits["y1"]
    return {
        "failingPatterns": failing,
        "thisRun": {
            **bits,
            "broken": (x0 & y0) ^ (x1 & y1),
            "correct": (x0 ^ x1) & (y0 ^ y1),
        },
    }


EXPECTED = {"choice-leak": _choice_leak, "cross-term-audit": _cross_term_audit}


# Both answers are objects, and the fixture-field probe compares a declared field
# against the answer as a whole, so no single on-screen value could ever equal it.
# `requestRevealingChoiceZero` alone *is* the printed A, and `thisRun` echoes the
# printed share bits -- but the graders accept them only alongside the half that
# cannot be copied: the second direction with the right orientation, and the full
# failing-pattern set. Declaring the printed fields here would read as a measurement
# while measuring nothing.
VISIBLE = {
    "choice-leak": lambda _server, _seed: {},
    "cross-term-audit": lambda _server, _seed: {},
}
