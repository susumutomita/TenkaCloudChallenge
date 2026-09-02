"""Parties, moduli and secrets, all derived from the per-deploy FLAG_SEED.

Additive secret sharing over F_p: a secret s is split into n shares that sum to s.
The property that makes it useful is not the arithmetic -- that part is trivial --
but that any n-1 of the shares are *independent of the secret*. That independence is
what the checkpoints make the learner demonstrate rather than assert.

The two-of-three checkpoint adds a second split, a line y = s + r*x whose value at
x = 0 is the secret and whose points at x = 1, 2, 3 go to three parties: any two of
them walk back to the secret, one alone is consistent with every secret. `line_cases`
below carries its settings.
"""

from __future__ import annotations

import hashlib

PRIMES = (97, 101, 103, 107, 109, 113, 127, 131, 137, 139)
#: Moduli for the two-of-three checkpoint's large cases. Deliberately far above anything
#: a participant sees on screen: the statement's trial search for "the number that
#: multiplies to 1" still finishes in about 10^4 steps, while trying every
#: (secret, slope) pair is about 10^8 steps per reconstruction and runs into the
#: verifier's time limit.
LARGE_PRIMES = (10007, 10009, 10037, 10039, 10061, 10067, 10069, 10079, 10091, 10093)
#: Party x holds the point of the line at x. x = 0 -- the secret itself -- goes to nobody.
LINE_PARTIES = (1, 2, 3)
#: How many distinct slopes `privacy_probe` draws per secret, for callers that want a
#: sample. The hidden checker no longer uses the sample: it sweeps every slope 0..p-1 for
#: each probe secret (2 x p calls per case), because a `share_line` that folds one slope
#: onto another collides among 300 draws only when both happen to be drawn (about 0.1%).
PRIVACY_PROBE_SLOPES = 300


def _stream(seed: str, label: str, length: int = 96) -> list[int]:
    """At least `length` deterministic bytes; a longer stream extends a shorter one."""
    out: list[int] = []
    counter = 0
    while len(out) < length:
        out.extend(hashlib.sha256(f"{seed}:{label}:{counter}".encode()).digest())
        counter += 1
    return out


def _pick(s: list[int], i: int, low: int, high: int) -> int:
    return low + ((s[i] * 256 + s[i + 1]) % (high - low + 1))


def setting(seed: str, label: str = "public") -> dict[str, int]:
    """Modulus, party count and the secret for one case."""
    s = _stream(seed, f"setting:{label}")
    p = PRIMES[s[0] % len(PRIMES)]
    return {"p": p, "n": _pick(s, 2, 2, 6), "secret": _pick(s, 4, 0, p - 1)}


def randomness(seed: str, label: str, count: int, p: int) -> list[int]:
    """Deterministic 'random' field elements, so a session is reproducible."""
    s = _stream(seed, f"rand:{label}")
    return [_pick(s, (i * 2) % 90, 0, p - 1) for i in range(count)]


def _non_degenerate_randomness(
    seed: str, label: str, count: int, p: int, accepts
) -> list[int]:
    """Retry deterministic draws until the exercise has the property it grades."""
    for attempt in range(256):
        draw_label = label if attempt == 0 else f"{label}:retry-{attempt}"
        values = randomness(seed, draw_label, count, p)
        if accepts(values):
            return values
    raise RuntimeError("could not construct non-degenerate sharing randomness")


def share_randomness(seed: str, label: str, count: int, p: int, secret: int) -> list[int]:
    """A draw whose completed split gives the secret to no single party outright."""

    def is_private_enough(head: list[int]) -> bool:
        shares = [*(value % p for value in head), (secret - sum(head)) % p]
        return sum(value != 0 for value in shares) >= 2

    return _non_degenerate_randomness(seed, label, count, p, is_private_enough)


def rerandomization_randomness(seed: str, label: str, count: int, p: int) -> list[int]:
    """A draw whose zero-sharing changes at least one share.

    This is the contract the statement states for the rerandomize checkpoint: the
    randomness handed to the learner is never all zeros, so following the procedure
    always moves at least one share and the "not identical to the input" relation is
    satisfiable by construction.
    """
    return _non_degenerate_randomness(
        seed,
        label,
        count,
        p,
        lambda values: any(value % p != 0 for value in values),
    )


def reference_shares(seed: str, label: str = "public") -> list[int]:
    cfg = setting(seed, label)
    p, n, secret = cfg["p"], cfg["n"], cfg["secret"]
    head = share_randomness(seed, label, n - 1, p, secret)
    return [*head, (secret - sum(head)) % p]


def line_slope(seed: str, label: str, p: int) -> int:
    """The one randomness value `share_line` receives: a slope in 1 .. p-1.

    Never 0: with slope 0 all three points equal the secret, and a `reconstruct_line`
    that never walks back to x = 0 would pass that case by accident.
    """
    s = _stream(seed, f"line:{label}")
    return _pick(s, 0, 1, p - 1)


def line_cases(seed: str) -> list[dict[str, int]]:
    """Settings for the two-of-three checkpoint: modulus, secret and slope per case.

    Three small cases whose modulus differs from this deployment's public `p` -- so a
    modulus copied off the screen cannot pass -- followed by two cases on the ~10^4
    moduli of `LARGE_PRIMES`. The large secrets are drawn from the upper half of the
    field: a search that walks candidate secrets upward from 0 then pays at least
    p/2 * p steps per reconstruction and cannot finish inside the verifier's limit,
    while the statement's trial search for the multiplicative partner stays at ~p.
    The privacy property (one point fits every secret) is checked exhaustively on the
    small cases and by `privacy_probe` on the large ones; see
    tests/hidden/check_sharing.py. `label` names the case for the per-case draws.
    """
    public_p = setting(seed)["p"]
    others = [prime for prime in PRIMES if prime != public_p]
    s = _stream(seed, "line:cases")
    cases: list[dict[str, object]] = []
    start = s[0] % len(others)
    for k in range(3):
        # len(others) == 9 and a stride of 3 keeps the three picks distinct.
        p = others[(start + 3 * k) % len(others)]
        cases.append(
            {
                "label": f"small-{k}",
                "p": p,
                "secret": _pick(s, 2 + 2 * k, 0, p - 1),
                "slope": line_slope(seed, f"small-{k}", p),
            }
        )
    for k in range(2):
        # len(LARGE_PRIMES) == 10 and a stride of 5 keeps the two picks distinct.
        p = LARGE_PRIMES[(s[10] + 5 * k) % len(LARGE_PRIMES)]
        cases.append(
            {
                "label": f"large-{k}",
                "p": p,
                "secret": _pick(s, 12 + 2 * k, p // 2, p - 1),
                "slope": line_slope(seed, f"large-{k}", p),
            }
        )
    return cases


def privacy_probe(seed: str, label: str, p: int, secret: int) -> dict[str, list[int]]:
    """Two distinct secrets and PRIVACY_PROBE_SLOPES distinct slopes for one large case.

    The large-modulus form of "one point fits every secret": for a fixed secret, the
    map slope -> party i's y must be a bijection on 0..p-1 (then every y is reachable
    from every secret, by exactly one slope). The hidden test checks that map on every
    slope, for each of these secrets, through the learner's own `share_line`, and
    requires the y values to be pairwise distinct -- a collision means some y is
    unreachable for that secret, and seeing that y would rule the secret out. The
    sampled slopes are kept for callers that want a cheap spot check.

    The second secret is drawn uniformly from the field minus the case's own secret, so
    a `share_line` that only behaves on the graded secret is probed on another one too.
    """
    count = min(PRIVACY_PROBE_SLOPES, p)
    s = _stream(seed, f"probe:{label}", 4)
    other = _pick(s, 0, 0, p - 2)
    if other >= secret % p:
        other += 1
    length = 8 * count
    while True:
        s = _stream(seed, f"probe:{label}", length)
        slopes: list[int] = []
        seen: set[int] = set()
        for index in range(2, len(s) - 1, 2):
            value = _pick(s, index, 0, p - 1)
            if value in seen:
                continue
            seen.add(value)
            slopes.append(value)
            if len(slopes) == count:
                return {"secrets": [secret % p, other], "slopes": slopes}
        length *= 2   # the stream is prefix-consistent, so the picks so far are unchanged


def health_token(seed: str) -> str:
    cfg = setting(seed)
    return hashlib.sha256(f"health:{seed}:{cfg['p']}:{cfg['n']}".encode()).hexdigest()[:16]


def public_payload(seed: str) -> dict[str, object]:
    """Everything a participant may see for this deployment. Carries values, not functions.

    The single source `show.py`, `verifier/server.py`'s `GET /public` and
    `tests/public/test_sharing.py` all build their view from. Every field below is
    something `make inspect` already printed or the public tests already imported before
    Issue 543 option B2, so the split changes where a participant reads it, not what they
    may see.

    What is deliberately absent is this module itself. `reference_shares` above builds a
    correct split -- the `share` half of the `share-and-reconstruct` checkpoint -- and the
    two `*_randomness` helpers are the retry loops the graded run draws from. Shipping the
    module put all of that, and `tests/hidden/check_sharing.py`'s assertions beside it, in
    the image a learner's own `make build` produced. Serving the derived values keeps
    `make inspect` and the public tests working without shipping the derivation.

    `secret` is here because it always was: `tests/public/test_sharing.py` has to hand a
    secret to `share()` to check the round trip at all, so this value has been reachable
    from the participant surface since the problem was written. It is not worth points --
    `complete_shares` is graded against every element of F_p, not this one -- and `show.py`
    still does not print it, which is what keeps the `hides-the-secret` reasoning intact.

    `lineRandomness` is the one slope value the public tests hand to `share_line`; the
    graded two-of-three cases (`line_cases`) use other moduli and other slopes.
    """
    cfg = setting(seed)
    p, n, secret = cfg["p"], cfg["n"], cfg["secret"]
    return {
        "params": {"p": p, "n": n},
        "secret": secret,
        "healthToken": health_token(seed),
        "shareRandomness": share_randomness(seed, "public", n - 1, p, secret),
        "rerandomizationRandomness": rerandomization_randomness(seed, "rr", n - 1, p),
        "lineRandomness": [line_slope(seed, "public", p)],
        # The n-1 shares `show.py` displays. The last one is withheld here as well as
        # there: printing it would hand over the answer to `complete_shares` for this
        # deployment's own secret.
        "partialShares": reference_shares(seed)[:-1],
    }
