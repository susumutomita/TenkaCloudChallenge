"""Private generator for tiny, hand-computable Schnorr instances.

Only public_payload crosses to the participant process. Arithmetic, seed and private
keys stay here. Coordinate primes and generator orders are small so the point table
can be computed by hand; these groups offer no cryptographic security.
"""

from __future__ import annotations

import hashlib

# (p, a, b, gx, gy, n): the listed generator has exactly the stated PRIME order. A test
# recomputes all of that from scratch rather than trusting this table.
TOY_GROUPS = (
    (5, 2, 1, 0, 1, 7),
    (7, 1, 1, 0, 1, 5),
)

# The checkpoint ids, in drill order. server.py, show.py, the tests and metadata.json all
# read this tuple, so the order of the drill is defined in exactly one place.
LINES = (
    "field-neg",
    "field-inv",
    "lambda-chord",
    "add-points",
    "double",
    "order",
    "pubkey",
    "commit",
    "response",
    "verify",
    "nonce-reuse",
    "transfer",
)
POINT_LINES = frozenset({"add-points", "double", "pubkey", "commit", "verify"})

# The lines that have an answer field. The platform allows at most eight checkpoints per
# problem, so four lines (1, 3, 7, 8) are ungraded material for the line that follows: a
# wrong line 1 shows on line 2, a wrong λ on line 4, a wrong P or R on line 10.
GRADED = (
    "field-inv",
    "add-points",
    "double",
    "order",
    "response",
    "verify",
    "nonce-reuse",
    "transfer",
)


def _stream(seed: str, label: str) -> "hashlib._Hash":
    return hashlib.sha256(f"{seed}:{label}".encode("utf-8"))


def _draw(seed: str, label: str, low: int, high: int) -> int:
    """A deterministic integer in [low, high], derived from the seed and a label."""
    digest = _stream(seed, label).digest()
    return low + int.from_bytes(digest[:8], "big") % (high - low + 1)


# --- curve arithmetic, written out longhand because the drill is about these lines ---


def inv(value: int, p: int) -> int:
    return pow(value % p, p - 2, p)


def ec_add(P, Q, p: int, a: int):
    if P is None:
        return Q
    if Q is None:
        return P
    if P[0] == Q[0] and (P[1] + Q[1]) % p == 0:
        return None
    if P == Q:
        lam = ((3 * P[0] * P[0] + a) * inv(2 * P[1], p)) % p
    else:
        lam = ((Q[1] - P[1]) * inv(Q[0] - P[0], p)) % p
    x3 = (lam * lam - P[0] - Q[0]) % p
    return (x3, (lam * (P[0] - x3) - P[1]) % p)


def ec_mul(k: int, P, p: int, a: int):
    R = None
    for _ in range(k):
        R = ec_add(R, P, p, a)
    return R


def order_of(G, p: int, a: int) -> int:
    R, k = G, 1
    while R is not None:
        R = ec_add(R, G, p, a)
        k += 1
    return k


def on_curve(P, p: int, a: int, b: int) -> bool:
    return P is not None and (P[1] * P[1] - (P[0] ** 3 + a * P[0] + b)) % p == 0


# --- the deployment ---


def setting(seed: str) -> dict:
    """Everything public — what show.py prints. See the module docstring: the expected
    value of each graded line is computed only by verifier/expected.py, from this
    return value, and is not part of it."""
    i = _draw(seed, "curve", 0, len(TOY_GROUPS) - 1)
    p, a, b, gx, gy, n = TOY_GROUPS[i]
    G = (gx, gy)

    t = _draw(seed, "t", 2, p - 2)
    # Q = k*G with Q not equal to G or -G, so the chord slope is defined (Qx != Gx).
    k = _draw(seed, "k", 2, n - 2)
    Q = ec_mul(k, G, p, a)
    if Q[0] == G[0]:
        Q = ec_mul(k + 1, G, p, a)
    x = _draw(seed, "x", 2, n - 2)
    r = _draw(seed, "r", 2, n - 2)
    # Select a practice record whose verification point has coordinates.
    choices = [candidate for candidate in range(1, n) if (r + candidate * x) % n != 0]
    e = choices[_draw(seed, "e", 0, len(choices) - 1)]

    # A different key that reused its nonce: two challenges, two responses, secret hidden.
    x_attack = _draw(seed, "x-attack", 2, n - 2)
    if x_attack == x:
        x_attack = x_attack + 1 if x_attack < n - 2 else 2
    r_attack = _draw(seed, "r-attack", 2, n - 2)
    e1 = _draw(seed, "e1", 1, n - 1)
    e2 = _draw(seed, "e2", 1, n - 1)
    if e2 == e1:
        e2 = (e1 % (n - 1)) + 1
    s1 = (r_attack + e1 * x_attack) % n
    s2 = (r_attack + e2 * x_attack) % n
    P_attack = ec_mul(x_attack, G, p, a)

    # A fresh key for the challenge-first construction; its secret is not projected.
    final_keys = [key for key in range(1, n) if key not in (x, x_attack)]
    x_final = final_keys[_draw(seed, "final-key", 0, len(final_keys) - 1)]
    P_final = ec_mul(x_final, G, p, a)
    ef = _draw(seed, "final-challenge", 1, n - 1)

    public = {
        "p": p, "a": a, "b": b, "G": G, "Gx": gx, "Gy": gy,
        "t": t, "Q": Q, "Qx": Q[0], "Qy": Q[1],
        "x": x, "r": r, "e": e,
        "P1": P_attack, "e1": e1, "s1": s1, "e2": e2, "s2": s2,
        "P2": P_final, "ef": ef,
    }
    return {"public": public}


def assignments(seed: str) -> str:
    """The public values as Python assignment statements, ready to paste into a REPL."""
    pub = setting(seed)["public"]
    lines = [
        f"p, a, b = {pub['p']}, {pub['a']}, {pub['b']}",
        f"G = ({pub['Gx']}, {pub['Gy']}); Gx, Gy = G",
        f"t = {pub['t']}",
        f"Q = ({pub['Qx']}, {pub['Qy']}); Qx, Qy = Q",
        f"x, r, e = {pub['x']}, {pub['r']}, {pub['e']}",
        f"P1 = ({pub['P1'][0]}, {pub['P1'][1]})",
        f"e1, s1, e2, s2 = {pub['e1']}, {pub['s1']}, {pub['e2']}, {pub['s2']}",
        f"P2 = ({pub['P2'][0]}, {pub['P2'][1]})",
        f"ef = {pub['ef']}",
    ]
    return "\n".join(lines)


#: The keys of :func:`setting`'s ``public`` dict whose value is a curve point. JSON has
#: no tuple, so a payload that has been through the verifier's ``GET /public`` hands
#: these back as two-element lists; consumers turn them back into tuples with this list
#: rather than restating it, so adding a public point cannot leave one of them behind.
PUBLIC_POINT_KEYS = ("G", "Q", "P1", "P2")


def public_payload(seed: str) -> dict:
    """The public half of this deployment, JSON-safe, for the participant image.

    This is everything ``show.py`` prints and everything the public tests need to call
    the learner's twelve functions on this deployment's numbers -- and nothing else.
    None of the eight graded lines' values are in here, and neither is the order ``n``
    of ``G`` (line 6 is to count it) or the attack signer's secret (line 11 is to
    extract it). Both are derived only in ``verifier/expected.py``, which lives in the
    verifier image alone.

    Serving this over ``GET /public`` is what lets ``fixtures/`` stay out of the
    participant stage: the values below are the ones a learner is shown anyway, while
    the ``ec_add`` / ``ec_mul`` / ``order_of`` implementations that produce them -- the
    same names ``starter/schnorr_drill.py`` asks the learner to write -- stay on the
    verifier side of the boundary.
    """
    public = setting(seed)["public"]
    return {
        "public": {
            key: (list(value) if key in PUBLIC_POINT_KEYS else value)
            for key, value in public.items()
        },
        "pointKeys": list(PUBLIC_POINT_KEYS),
        "assignments": assignments(seed),
        "lines": list(GRADED),
    }


def normalize_answer(line: str, raw: object):
    """Turn whatever the learner pasted into the shape the expected value has.

    Integers may arrive as int or as a digit string. Points may arrive as a JSON list,
    a tuple-looking string "(x, y)", or "x, y". Anything else is simply wrong.
    """
    if line in POINT_LINES:
        if isinstance(raw, str):
            cleaned = raw.strip().strip("()[]")
            parts = [part.strip() for part in cleaned.split(",")]
        elif isinstance(raw, (list, tuple)):
            parts = list(raw)
        else:
            return None
        if len(parts) != 2:
            return None
        if any(type(part) is not int and not isinstance(part, str) for part in parts):
            return None
        try:
            return (int(parts[0]), int(parts[1]))
        except (TypeError, ValueError):
            return None
    if isinstance(raw, bool):
        return None
    if isinstance(raw, int):
        return raw
    if isinstance(raw, str):
        try:
            return int(raw.strip())
        except ValueError:
            return None
    return None
