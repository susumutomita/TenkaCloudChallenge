"""This deployment's numbers, and the fourteen values the co-SNARK drill expects.

Everything the learner types is decided here from FLAG_SEED: the field modulus, the
two-wire witness, the per-wire share randomness, the two public coefficient vectors, and
a Beaver triple's two factors with their own share randomness. The learner never sees the
expected values -- they see the assignment statements (``show.py``) and produce every
value with their own Python, one line at a time.

The procedure is the Week 6 lecture's co-SNARK prover (README: "SNARK 証明者の主計算
（MSM・FFT）は体 F 上の線形演算であり、線形演算は秘密分散された値の上で各 party がローカルに、
通信なしで計算できる。secret × secret の乗算だけが通信...を要する") reduced to the assignment
`co-snark-prove`'s toy shape: A = coeffs_a . w, B = coeffs_b . w (both share-local, no
communication), C = A * B (one Beaver-multiplication round). The numbers are this
deployment's own (the independent-reimplementation rule): the assignment's own worked
example and every (modulus, witness) / Beaver (a, b) pair appearing in its README or
`tests/public.py` is excluded below, so no deployment can be solved by copying the course
material.

Nothing here is cryptographic. Toy parameters are for observability, not for security.
"""

from __future__ import annotations

import hashlib

#: Candidate field moduli. All six are prime; none is a modulus the assignment's README
#: or test suite ever uses (see EXCLUDED_PRIMES / EXCLUDED_WITNESS below for what those
#: were).
PRIMES = (83, 103, 107, 109, 113, 127)

#: The assignment `co-snark-prove`'s own moduli (README worked example: modulus 97; the
#: `python/tests/public.py` suite: 97, 101, 89, 101). None of these six is drawable from
#: PRIMES above -- listed anyway, so the exclusion is a fact checked in code, not a claim
#: living only in a comment.
EXCLUDED_PRIMES = (97, 101, 89)

#: Every (modulus, witness) pair that appears in the assignment's README or
#: `python/tests/public.py`, verbatim. This drill only ever draws a 2-wire witness, so
#: the two 3-wire pairs below can never collide by shape -- they are still listed here
#: for the same reason as EXCLUDED_PRIMES.
EXCLUDED_WITNESS = (
    (97, (3, 5)),  # README worked example: A = 1*3+2*5=13, B=4*3+1*5=17, C=13*17=27.
    (101, (12, 7, 4)),  # tests/public.py: test_linear_combination_three_parties
    (89, (6, 6)),  # tests/public.py: test_mpc_prove_with_zero_linear_form
    (101, (2, 9, 1)),  # tests/public.py: test_mpc_prove_three_parties
)

#: Every Beaver triple (a, b) the assignment's README or tests draw a * b from, verbatim
#: (a=5,b=9,c=45 in the README and test_mpc_prove_matches_single_prover; a=4,b=20,c=80 in
#: test_mpc_prove_three_parties; a=3,b=6,c=18 in test_mpc_prove_with_zero_linear_form).
EXCLUDED_BEAVER_AB = ((5, 9), (4, 20), (3, 6))

#: The fourteen lines, in drill order. Six have no answer field: `witness` and
#: `reconstruct` only look at values already on screen, `noleak` and `nolink` are
#: cross-checks about what a single share or an opened value can and cannot reveal, and
#: `triple` and `expand` are the Beaver bookkeeping / textbook-identity steps the later
#: graded lines are built from.
LINES = (
    "witness",
    "shares",
    "reconstruct",
    "noleak",
    "ashares",
    "aopen",
    "bshares",
    "crossmul",
    "triple",
    "beaveropen",
    "cshares",
    "csum",
    "expand",
    "nolink",
)

#: The lines that have an answer field. The platform allows at most eight checkpoints.
GRADED = (
    "shares",
    "ashares",
    "aopen",
    "bshares",
    "crossmul",
    "beaveropen",
    "cshares",
    "csum",
)

#: Every graded line's answer shape: a scalar kind, or (kind, width) for a fixed-width
#: tuple of that kind. This drill only produces "int" and ("int", width) -- no line here
#: prints a boolean, a hex digest, or a string -- but the shape grammar is shared with
#: the sibling drills ac26-w6-zkvm-trace-drill (bool / bool-tuple) and
#: ac26-w6-nullifier-drill (hex / hex-tuple), and `normalize_scalar` below implements
#: every kind so the three drills' value graders agree on one contract.
SHAPES: dict[str, str | tuple[str, int]] = {
    "shares": ("int", 2),
    "ashares": ("int", 2),
    "aopen": ("int", 2),
    "bshares": ("int", 3),
    "crossmul": ("int", 2),
    "beaveropen": ("int", 2),
    "cshares": ("int", 2),
    "csum": "int",
}


def _draw(seed: str, label: str, low: int, high: int) -> int:
    digest = hashlib.sha256(f"{seed}:{label}".encode("utf-8")).digest()
    return low + int.from_bytes(digest[:8], "big") % (high - low + 1)


def setting(seed: str) -> dict:
    """Everything public (shown by show.py) and everything expected (kept by server.py).

    Draws are re-rolled as a whole (under a `#retry<k>` suffix on every label) whenever
    a structural constraint fails (w0 == w1, r_i == w_i, a == b), whenever the draw lands
    on an excluded course value, or whenever a graded value would equal one of this
    deployment's own public numbers or land on None / an empty sequence / -1 -- the
    answer-on-screen guard every drill in this group applies.
    """
    attempt = 0
    while True:
        eff = seed if attempt == 0 else f"{seed}#retry{attempt}"

        p = PRIMES[_draw(eff, "prime", 0, len(PRIMES) - 1)]
        w0 = _draw(eff, "w0", 2, p - 2)
        w1 = _draw(eff, "w1", 2, p - 2)
        if w1 == w0:
            attempt += 1
            continue
        w = (w0, w1)

        r0 = _draw(eff, "r0", 1, p - 1)
        r1 = _draw(eff, "r1", 1, p - 1)
        if r0 == w0 or r1 == w1:
            attempt += 1
            continue

        ca0 = _draw(eff, "ca0", 1, p - 1)
        ca1 = _draw(eff, "ca1", 1, p - 1)
        cb0 = _draw(eff, "cb0", 1, p - 1)
        cb1 = _draw(eff, "cb1", 1, p - 1)
        ca = (ca0, ca1)
        cb = (cb0, cb1)

        beaver_a = _draw(eff, "beaver-a", 2, p - 2)
        beaver_b = _draw(eff, "beaver-b", 2, p - 2)
        if beaver_a == beaver_b:
            attempt += 1
            continue
        if (p, w) in EXCLUDED_WITNESS or p in EXCLUDED_PRIMES:
            attempt += 1
            continue
        if (beaver_a, beaver_b) in EXCLUDED_BEAVER_AB:
            attempt += 1
            continue

        ra = _draw(eff, "ra", 1, p - 1)
        rb = _draw(eff, "rb", 1, p - 1)
        rc = _draw(eff, "rc", 1, p - 1)

        # Line 2: each wire's two-party share. w0_sh[0] is just r0, already on screen;
        # only the second entry is new information, so only it is graded.
        w0_sh = [r0, (w[0] - r0) % p]
        w1_sh = [r1, (w[1] - r1) % p]

        # Lines 5-6: A is a public linear form of the witness, computed on shares alone.
        a_sh = [(ca[0] * x + ca[1] * y) % p for x, y in zip(w0_sh, w1_sh)]
        A = sum(a_sh) % p
        a_direct = (ca[0] * w[0] + ca[1] * w[1]) % p

        # Line 7: same for B.
        b_sh = [(cb[0] * x + cb[1] * y) % p for x, y in zip(w0_sh, w1_sh)]
        B = sum(b_sh) % p

        # Line 8: the share-wise product is NOT A * B -- the cross terms are missing.
        naive_product = sum(x * y for x, y in zip(a_sh, b_sh)) % p
        correct_product = (A * B) % p

        # Line 9 (ungraded): the Beaver triple itself, c = a * b, shared like any wire.
        triple_a_sh = [ra, (beaver_a - ra) % p]
        triple_b_sh = [rb, (beaver_b - rb) % p]
        beaver_c = (beaver_a * beaver_b) % p
        triple_c_sh = [rc, (beaver_c - rc) % p]

        # Line 10: the only communication round -- open d = A - a, e = B - b.
        d = (A - sum(triple_a_sh)) % p
        e = (B - sum(triple_b_sh)) % p

        # Line 11: each party's share of C, from d, e and their own triple shares.
        z = [(triple_c_sh[i] + d * triple_b_sh[i] + e * triple_a_sh[i]) % p for i in range(2)]
        z[0] = (z[0] + d * e) % p

        # Line 12: reconstruct C.
        C = sum(z) % p

        graded_expected = {
            "shares": (w0_sh[1], w1_sh[1]),
            "ashares": tuple(a_sh),
            "aopen": (A, a_direct),
            "bshares": (b_sh[0], b_sh[1], B),
            "crossmul": (naive_product, correct_product),
            "beaveropen": (d, e),
            "cshares": tuple(z),
            "csum": C,
        }

        public_scalars = {p, w0, w1, r0, r1, ca0, ca1, cb0, cb1, beaver_a, beaver_b, ra, rb, rc}
        graded_scalars: list[object] = []
        for value in graded_expected.values():
            if isinstance(value, tuple):
                graded_scalars.extend(value)
            else:
                graded_scalars.append(value)
        bad = any(v is None for v in graded_scalars)
        bad = bad or any(isinstance(v, (list, tuple)) and len(v) == 0 for v in graded_scalars)
        bad = bad or any(v == -1 for v in graded_scalars if isinstance(v, int))
        bad = bad or any(v in public_scalars for v in graded_scalars if isinstance(v, int))
        if bad:
            attempt += 1
            if attempt > 200:  # unreachable in practice; keeps the loop total
                break
            continue
        break

    # The six ungraded lines' values. Never checked against the answer-on-screen guard
    # above -- `reconstruct` is SUPPOSED to equal the public `w`, and `noleak` / `nolink`
    # are demonstrations over a handful of candidate values, not a single secret answer.
    ungraded_expected = {
        "witness": (p, tuple(w)),
        "reconstruct": (sum(w0_sh) % p, sum(w1_sh) % p),
        "noleak": [(r0, (s - r0) % p) for s in (w[0], p // 2, p - 1)],
        "triple": (
            sum(triple_a_sh) % p,
            sum(triple_b_sh) % p,
            sum(triple_c_sh) % p,
            (beaver_a * beaver_b) % p,
        ),
        "expand": (d * e + d * beaver_b + e * beaver_a + beaver_a * beaver_b) % p,
        "nolink": [
            (cand, (cand - d) % p) for cand in (A, (A + p // 3) % p, (A + 2 * (p // 3)) % p)
        ],
    }
    expected = {**graded_expected, **ungraded_expected}

    public = {
        "p": p,
        "w": list(w),
        "r0": r0,
        "r1": r1,
        "ca": list(ca),
        "cb": list(cb),
        "a": beaver_a,
        "b": beaver_b,
        "ra": ra,
        "rb": rb,
        "rc": rc,
    }
    return {"public": public, "expected": expected}


def assignments(seed: str) -> str:
    """The public values as Python assignment statements, ready to paste into a REPL."""
    pub = setting(seed)["public"]
    return "\n".join(
        [
            f"p = {pub['p']}",
            f"w = {list(pub['w'])}",
            f"r0, r1 = {pub['r0']}, {pub['r1']}",
            f"ca = {list(pub['ca'])}",
            f"cb = {list(pub['cb'])}",
            f"a, b = {pub['a']}, {pub['b']}",
            f"ra, rb, rc = {pub['ra']}, {pub['rb']}, {pub['rc']}",
        ]
    )


def _clean_token(token: str) -> str:
    """Strip surrounding whitespace and a single layer of quotes Python's own repr adds."""
    token = token.strip()
    if len(token) >= 2 and token[0] == token[-1] and token[0] in "'\"":
        token = token[1:-1]
    return token.strip()


def normalize_scalar(kind: str, raw: object):
    """Normalize one scalar of the given kind, or return None if it does not fit.

    Implements every kind the shared shape grammar defines (int / bool / hex / str),
    not only the ones this drill's own SHAPES table uses, so the three sibling drills'
    value graders share one normalizer contract.
    """
    if kind == "int":
        if isinstance(raw, bool):
            return None
        if isinstance(raw, int):
            return raw
        if isinstance(raw, str):
            try:
                return int(_clean_token(raw))
            except ValueError:
                return None
        return None
    if kind == "bool":
        if isinstance(raw, bool):
            return raw
        if isinstance(raw, str) and _clean_token(raw).lower() in ("true", "false"):
            return _clean_token(raw).lower() == "true"
        return None
    if kind == "hex":
        if not isinstance(raw, str):
            return None
        token = _clean_token(raw)
        if token == "":
            return None
        try:
            int(token, 16)
        except ValueError:
            return None
        return token.lower()
    if kind == "str":
        if not isinstance(raw, str):
            return None
        token = _clean_token(raw)
        return token if token != "" else None
    return None


def _split_tuple_text(raw: str) -> list[str] | None:
    """Split a pasted tuple-like string into its comma-separated parts.

    Accepts `(1, 2)`, `[1, 2]`, and bare `1, 2` -- outer brackets are optional, and are
    the only structure stripped, so a hex or string entry keeps its own quotes intact
    for `normalize_scalar` to peel off itself.
    """
    cleaned = raw.strip()
    if len(cleaned) >= 2 and cleaned[0] in "([" and cleaned[-1] in ")]":
        cleaned = cleaned[1:-1]
    if cleaned.strip() == "":
        return None
    parts = [part.strip() for part in cleaned.split(",")]
    parts = [part for part in parts if part != ""]
    return parts or None


def normalize_answer(line: str, raw: object):
    """Turn whatever the learner pasted into the shape this line's answer has.

    Every graded line declares its shape in SHAPES: a scalar ("int" / "bool" / "hex" /
    "str") or a fixed-width tuple of one of those, e.g. ("int", 2). A tuple may arrive as
    a JSON list `[1, 2]` (the verifier tries `json.loads` before calling this function),
    a Python tuple/list literal typed as text `(1, 2)` / `[1, 2]`, or bare comma-
    separated values `1, 2`.
    """
    shape = SHAPES.get(line)
    if shape is None:
        return None
    if isinstance(shape, tuple):
        kind, width = shape
        if isinstance(raw, str):
            parts = _split_tuple_text(raw)
            if parts is None:
                return None
        elif isinstance(raw, (list, tuple)):
            parts = list(raw)
        else:
            return None
        if len(parts) != width:
            return None
        values = [normalize_scalar(kind, part) for part in parts]
        if any(value is None for value in values):
            return None
        return tuple(values)
    return normalize_scalar(shape, raw)
