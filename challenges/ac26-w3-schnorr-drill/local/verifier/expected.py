"""Private author expectations, never copied into the participant image.

The first seven graded values are unique. The final triple here is one reference
construction only; the verifier accepts every well-formed construction satisfying
the public point equation, independently of this particular triple.
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
    for sf in range(n):
        B = ec_mul(pub["ef"], pub["P2"], p, a)
        negB = None if B is None else (B[0], -B[1] % p)
        Rf = ec_add(ec_mul(sf, G, p, a), negB, p, a)
        if Rf is not None:
            construction = (Rf[0], Rf[1], sf)
            break
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
        "transfer": construction,
    }


def valid_construction(pub: dict, raw: object) -> bool:
    """Check the public relation without selecting one privileged construction."""
    import json
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except (json.JSONDecodeError, ValueError):
            return False
    if not isinstance(raw, (list, tuple)) or len(raw) != 3:
        return False
    if any(type(value) is not int for value in raw):
        return False
    rx, ry, s = raw
    p, a, b, G = pub["p"], pub["a"], pub["b"], pub["G"]
    n = order_of(G, p, a)
    if not (0 <= rx < p and 0 <= ry < p and 0 <= s < n):
        return False
    R = (rx, ry)
    if (ry * ry - (rx ** 3 + a * rx + b)) % p:
        return False
    return ec_mul(s, G, p, a) == ec_add(R, ec_mul(pub["ef"], pub["P2"], p, a), p, a)
