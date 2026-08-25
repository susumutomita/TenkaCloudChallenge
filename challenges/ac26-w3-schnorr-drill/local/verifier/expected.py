"""The drill's ground truth for the twelve lines, computed from public state alone.

`fixtures/generate.py` hands back only what `show.py` prints: `setting(seed)["public"]`.
This module is the only place that turns those public numbers into the value each
graded line is checked against. It is not exported from `fixtures/generate.py` and
nothing on the participant's reading path (`show.py`, the public tests) imports it —
see #537 and docs/curricula/advanced-cryptography-2026/TEMPLATE.md "Assurance scope".

Before #537, `fixtures/generate.py::setting()` returned this same dict directly, so
`from fixtures.generate import setting; setting(FLAG_SEED)["expected"]` handed back
every graded answer with no cryptography at all. Every value below is a pure function
of the public dict — the same arithmetic the drill statement asks the learner to type —
so recomputing it here, instead of shipping a precomputed table, costs nothing except
the one-import shortcut.

Same standing as `verifier/server.py` itself: this module still ships inside the
participant's own image (see the AC26 template's Assurance scope). That is misdelivery
prevention, not confidentiality — the difference #537 closes is that the answer is no
longer sitting behind a single, argument-free, participant-facing function call.
"""

from __future__ import annotations

from fixtures.generate import ec_add, ec_mul, inv, order_of, setting


def expected_for(seed: str) -> dict[str, object]:
    """Every drill line's value, recomputed from `setting(seed)["public"]`."""
    pub = setting(seed)["public"]
    p, a, G, Q, t = pub["p"], pub["a"], pub["G"], pub["Q"], pub["t"]
    x, r, e = pub["x"], pub["r"], pub["e"]
    n = order_of(G, p, a)
    lam = ((Q[1] - G[1]) * inv(Q[0] - G[0], p)) % p
    P = ec_mul(x, G, p, a)
    R = ec_mul(r, G, p, a)
    s = (r + e * x) % n
    e1, s1, e2, s2 = pub["e1"], pub["s1"], pub["e2"], pub["s2"]
    # Nonce-reuse recovery: s1 - s2 = (e1 - e2)*x_attack (mod n), so this is the exact
    # algebra line 11 asks the learner to perform themselves on the shown e1,s1,e2,s2.
    x_attack = ((s1 - s2) * inv(e1 - e2, n)) % n
    p2, a2, G2 = pub["p2"], pub["a2"], pub["G2"]
    x2, r2, e2p = pub["x2"], pub["r2"], pub["e2p"]
    n2 = order_of(G2, p2, a2)
    return {
        "field-neg": (-t) % p,
        "field-inv": inv(t, p),
        "lambda-chord": lam,
        "add-points": ec_add(G, Q, p, a),
        "double": ec_add(G, G, p, a),
        "order": n,
        "pubkey": P,
        "commit": R,
        "response": s,
        "verify": ec_mul(s, G, p, a),
        "nonce-reuse": x_attack,
        "transfer": (r2 + e2p * x2) % n2,
    }
