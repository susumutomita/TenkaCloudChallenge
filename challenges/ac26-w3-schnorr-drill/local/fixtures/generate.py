"""This deployment's numbers, and the twelve values the drill expects.

Everything the learner types is decided here from FLAG_SEED: a small prime-order curve,
a trial field element, a second point, a key pair, a nonce, a challenge, a *second* key
that signed twice with one nonce, and a second curve for the transfer line. The learner
never sees the expected values — they see the assignment statements (``show.py``) and
produce the values with their own Python, one line at a time.

The curves are the same verified prime-order toy curves used by ac26-w3-schnorr: the
generator's order is prime, so every non-zero scalar is usable and ``s = r + e*x mod n``
behaves like the real thing. They are deliberately not the course assignment's test
curve (the independent-reimplementation rule): the procedure is the same, the numbers
are not.

Nothing here is constant-time or random in the cryptographic sense. Toy parameters are
for observability.

This module hands back the PUBLIC state only (what ``show.py`` prints). It no longer
computes or exports the twelve lines' expected values as their own callable result:
before #537, that dict shipped here and could be read back with one import, which was
the entire drill for free. ``verifier/expected.py`` recomputes each checkpoint's value
from this public state at grading time instead.

Issue 543/537, second half: this module does not ship in the ``participant`` Docker
stage any more either (see ../Dockerfile). Moving the expected values out was not
enough, because the drill *is* ``ec_add`` / ``ec_mul`` / ``order_of`` and this module
needs working implementations of exactly those to derive the deployment's public
numbers -- so shipping it handed a learner ``add-points``, ``double`` and ``order``
outright for the price of one import, and with ``order_of`` the three lines built on
the order, all with no comparison anywhere near them. ``show.py`` and the public tests
now read :func:`public_payload` from the verifier's ``GET /public`` over the
Compose-internal network instead. See #543 (option B2) and
scripts/ac26-w3-schnorr-drill.test.ts for the regression test pinning both the values
this move must not change and the stage the file may not re-enter.
"""

from __future__ import annotations

import hashlib

# (p, a, b, gx, gy, n): the listed generator has exactly the stated PRIME order. A test
# recomputes all of that from scratch rather than trusting this table.
TOY_GROUPS = (
    (23, 1, 4, 0, 2, 29),
    (23, 5, 1, 0, 1, 31),
    (29, 5, 7, 0, 6, 37),
    (31, 0, 3, 1, 2, 43),
    (31, 1, 3, 1, 6, 41),
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
    e = _draw(seed, "e", 2, n - 2)
    # s = r + e*x must not be 0 mod n (line 10 would print None, s*G = O — true but useless
    # to paste), and must not coincide with a number already on the screen (x, r, e), so
    # that the pasted value is always one the learner computed. Moving e by one keeps
    # every other line.
    while (r + e * x) % n in (0, x, r, e):
        e = e + 1 if e < n - 2 else 2

    # A different key that reused its nonce: two challenges, two responses, secret hidden.
    x_attack = _draw(seed, "x-attack", 2, n - 2)
    if x_attack == x:
        x_attack = (x_attack % (n - 3)) + 2
    r_attack = _draw(seed, "r-attack", 2, n - 2)
    e1 = _draw(seed, "e1", 1, n - 1)
    e2 = _draw(seed, "e2", 1, n - 1)
    if e2 == e1:
        e2 = (e1 % (n - 1)) + 1
    s1 = (r_attack + e1 * x_attack) % n
    s2 = (r_attack + e2 * x_attack) % n
    P_attack = ec_mul(x_attack, G, p, a)

    # The transfer curve: a different entry of the table, and its own x, r, e.
    j = (i + 1 + _draw(seed, "curve-2", 0, len(TOY_GROUPS) - 2)) % len(TOY_GROUPS)
    p2, a2, b2, gx2, gy2, n2 = TOY_GROUPS[j]
    G2 = (gx2, gy2)
    x2 = _draw(seed, "x2", 2, n2 - 2)
    r2 = _draw(seed, "r2", 2, n2 - 2)
    e2p = _draw(seed, "e2p", 2, n2 - 2)
    while (r2 + e2p * x2) % n2 in (0, x2, r2, e2p):
        e2p = e2p + 1 if e2p < n2 - 2 else 2

    public = {
        "p": p, "a": a, "b": b, "G": G, "Gx": gx, "Gy": gy,
        "t": t, "Q": Q, "Qx": Q[0], "Qy": Q[1],
        "x": x, "r": r, "e": e,
        "P1": P_attack, "e1": e1, "s1": s1, "e2": e2, "s2": s2,
        "p2": p2, "a2": a2, "b2": b2, "G2": G2, "x2": x2, "r2": r2, "e2p": e2p,
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
        f"p2, a2, b2 = {pub['p2']}, {pub['a2']}, {pub['b2']}",
        f"G2 = ({pub['G2'][0]}, {pub['G2'][1]})",
        f"x2, r2, e2p = {pub['x2']}, {pub['r2']}, {pub['e2p']}",
    ]
    return "\n".join(lines)


#: The keys of :func:`setting`'s ``public`` dict whose value is a curve point. JSON has
#: no tuple, so a payload that has been through the verifier's ``GET /public`` hands
#: these back as two-element lists; consumers turn them back into tuples with this list
#: rather than restating it, so adding a public point cannot leave one of them behind.
PUBLIC_POINT_KEYS = ("G", "Q", "P1", "G2")


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
        "lines": list(LINES),
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
