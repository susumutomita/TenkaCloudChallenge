"""Two Beaver multiplications, everything derived from FLAG_SEED.

Multiplying two *shared* values is the one operation that cannot finish inside one
party: the sum of the products of the rows is not the product of the sums. Beaver's
trick moves the hard part into preprocessing. A triple (a, b, c) with c = a*b, shared
out in advance and independent of the inputs, turns one multiplication into masking,
one opening, and a linear combination:

    d = x - a      e = y - b        (local: one row minus one row)
    open d, open e                  (one round: everybody broadcasts its two rows)
    x*y = c + d*b + e*a + d*e

The first three terms are linear in the shares, so each party computes its own row.
`d*e` is not a sharing at all -- it is a public scalar, and exactly one party folds
it in. That is the same rule as adding a public constant in `ac26-w2-linear-shares`,
arriving in the middle of a protocol where it is far easier to miss.

## What the participant can see, and why that is the design

They are **one party**. `beaver show` prints their own five rows (of X, Y, a, b and
c), every other party's *broadcast* rows of d and e -- which are public by the time
the opening has happened, that being what opening means -- and the total the desk
published. It never prints another party's row of a, b, c, X or Y.

That is what keeps the problem honest in both directions:

- `x = d + a` needs the whole of `a`, and only one row of it is on the screen, so
  publishing `d` and `e` really does reveal nothing about the inputs. The participant
  can check that claim against what they were given rather than take it.
- Every stage's answer is a single field element (or two), so there is nothing to
  paste into a one-line answer box that has several correct forms.

They do learn `x*y`, because that is the desk's output and the third stage asks for
it. A multiplication protocol reveals its product; that is the point of running it.

## Two cases, and why the second one is not the first one again

    live      the desk's implementation folded `d*e` into EVERY party's row, so the
              run reconstructed to `x*y + (n-1)*d*e`. You are not the designated
              party, so your own correct row carries no `d*e` at all.

    transfer  handed over only once the three live stages are cleared. A different
              prime, a different party count, you ARE the designated party, and the
              fault is the opposite one: nobody folded `d*e` in, so the run
              reconstructed to `x*y - d*e`.

The corrections are therefore `published - (n-1)*d*e` and `published + d*e`. The
second has no `n` in it, so an answer remembered as "take off (n-1) times the
product of the openings" is wrong there -- and it is wrong by a different shape
rather than a different number. mutation.py asserts that across seeds.
"""

from __future__ import annotations

import hashlib

#: Four digits, not two. Every stage's answer is a field element and the CLI takes as
#: many attempts as anyone cares to type, so a two-digit modulus would make a stage a
#: hundred guesses wide. Four digits is still trivial arithmetic -- python3 is in the
#: container and `beaver show` says so -- and what it removes is the option of not
#: doing it. Far too small for any real use, in either case.
PRIMES = (3989, 4001, 4003, 4007, 4013, 4019, 4021, 4027, 4049, 4051, 4057, 4073)

LIVE = "live"
TRANSFER = "transfer"
CASES = (LIVE, TRANSFER)

#: Never below three. With two parties the designated party is half the room and
#: `(n-1)*d*e` collapses onto `d*e`, which is the transfer case's correction.
PARTIES = {LIVE: (3, 6), TRANSFER: (4, 7)}


def _stream(seed: str, label: str) -> list[int]:
    out: list[int] = []
    counter = 0
    while len(out) < 192:
        out.extend(hashlib.sha256(f"{seed}:{label}:{counter}".encode()).digest())
        counter += 1
    return out


def _pick(s: list[int], i: int, low: int, high: int) -> int:
    return low + ((s[i] * 256 + s[i + 1]) % (high - low + 1))


# --------------------------------------------------------------------------- the setting


def field_modulus(seed: str, case: str) -> int:
    """The prime this case works in. The transfer case never reuses the live one."""
    s = _stream(seed, f"field:{case}")
    if case == LIVE:
        return PRIMES[s[0] % len(PRIMES)]
    others = tuple(prime for prime in PRIMES if prime != field_modulus(seed, LIVE))
    return others[s[0] % len(others)]


def party_count(seed: str, case: str) -> int:
    low, high = PARTIES[case]
    return _pick(_stream(seed, f"parties:{case}"), 0, low, high)


def designated_party(seed: str, case: str) -> int:
    """The one party that folds a public scalar in. A protocol convention, not a law."""
    return _pick(_stream(seed, f"designated:{case}"), 0, 0, party_count(seed, case) - 1)


def your_index(seed: str, case: str) -> int:
    """Which party the participant is.

    Live: never the designated one, so their own correct row carries no `d*e` and the
    "everyone folds it in" reflex is wrong on the stage they attempt second.
    Transfer: always the designated one, so the same reflex is wrong the other way.
    mutation.py asserts both across seeds; without them the transfer stage would be
    the live stage with different numbers.
    """
    n = party_count(seed, case)
    t = designated_party(seed, case)
    if case == TRANSFER:
        return t
    other = _pick(_stream(seed, f"you:{case}"), 0, 0, n - 2)
    return other if other < t else other + 1


def secrets(seed: str, case: str) -> dict[str, int]:
    """The two shared inputs and the preprocessed triple behind them.

    `d = x - a` and `e = y - b` are forced non-zero, and forced apart from each other.
    If either vanished so would `d*e`, and folding the public scalar into every row
    would be indistinguishable from folding it into exactly one -- the wrong answer
    would grade as correct. If they were equal, `beaver open e,d` would pass a
    transposition. A real protocol draws a uniform mask and tolerates all three; these
    parameters are chosen for observability, not for realism.
    """
    s = _stream(seed, f"secret:{case}")
    p = field_modulus(seed, case)
    x = _pick(s, 0, 1, p - 1)
    y = _pick(s, 4, 1, p - 1)
    a = _pick(s, 8, 0, p - 1)
    b = _pick(s, 12, 0, p - 1)
    if (x - a) % p == 0:
        a = (a + 1) % p
    if (y - b) % p == 0:
        b = (b + 1) % p
    while (x - a) % p == (y - b) % p:
        b = (b + 1) % p
        if (y - b) % p == 0:
            b = (b + 1) % p
    return {"x": x, "y": y, "a": a, "b": b, "c": (a * b) % p}


def rows(seed: str, case: str, name: str) -> list[int]:
    """One row per party, summing to the value modulo p. Internal to the fixtures.

    `beaver show` prints exactly one entry of each of these -- the participant's own.
    Printing a whole table would let them reconstruct `a`, and `x = d + a` would then
    be one subtraction away, which is the property the opening stage rests on.
    """
    s = _stream(seed, f"rows:{case}:{name}")
    p = field_modulus(seed, case)
    n = party_count(seed, case)
    head = [_pick(s, 2 * i, 0, p - 1) for i in range(n - 1)]
    return [*head, (secrets(seed, case)[name] - sum(head)) % p]


def your_rows(seed: str, case: str) -> dict[str, int]:
    """The five numbers the participant actually holds."""
    j = your_index(seed, case)
    return {name: rows(seed, case, name)[j] for name in ("x", "y", "a", "b", "c")}


# --------------------------------------------------------------------------- the opening


def broadcast(seed: str, case: str) -> list[dict[str, int]]:
    """Each party's two rows of `d` and `e`, as they go out on the wire.

    `d = x - a` is a sharing, so party i's row of it is `x_i - a_i`. Opening a value
    means every party sends its row and everyone adds them up, which is why the whole
    table is public afterwards -- and why it costs one round.
    """
    p = field_modulus(seed, case)
    x_rows, a_rows = rows(seed, case, "x"), rows(seed, case, "a")
    y_rows, b_rows = rows(seed, case, "y"), rows(seed, case, "b")
    return [
        {"d": (x_rows[i] - a_rows[i]) % p, "e": (y_rows[i] - b_rows[i]) % p}
        for i in range(party_count(seed, case))
    ]


def opened(seed: str, case: str) -> dict[str, int]:
    """`d` and `e`, the two values the round makes public."""
    p = field_modulus(seed, case)
    values = secrets(seed, case)
    return {"d": (values["x"] - values["a"]) % p, "e": (values["y"] - values["b"]) % p}


# --------------------------------------------------------------------------- the product


#: What the previous SRE's implementation did with the public scalar `d*e`. Two
#: different faults on purpose: one folds it in too many times, the other not at all,
#: so the correction is not the same shape in the two cases.
FAULT = {
    LIVE: "every party folded d*e into its own row",
    TRANSFER: "nobody folded d*e in at all",
}


def correct_row(seed: str, case: str) -> int:
    """The participant's own row of X*Y, assembled correctly."""
    p = field_modulus(seed, case)
    mine = your_rows(seed, case)
    values = opened(seed, case)
    designated = your_index(seed, case) == designated_party(seed, case)
    row = mine["c"] + values["d"] * mine["b"] + values["e"] * mine["a"]
    return (row + (values["d"] * values["e"] if designated else 0)) % p


def product(seed: str, case: str) -> int:
    """X*Y, which is what a correct run reconstructs to."""
    p = field_modulus(seed, case)
    values = secrets(seed, case)
    return (values["x"] * values["y"]) % p


def published_total(seed: str, case: str) -> int:
    """What the desk did publish: the reconstruction of the faulty run.

    Live: every party folded `d*e` in, so the rows summed to `x*y + (n-1)*d*e`.
    Transfer: nobody did, so they summed to `x*y - d*e`.
    """
    p = field_modulus(seed, case)
    values = opened(seed, case)
    scalar = (values["d"] * values["e"]) % p
    if case == LIVE:
        return (product(seed, case) + (party_count(seed, case) - 1) * scalar) % p
    return (product(seed, case) - scalar) % p


def flag(seed: str) -> str:
    """Derived from the per-deploy seed, so it can be neither memorised nor guessed."""
    return f"TC{{beaver_mul_{hashlib.sha256(f'flag:{seed}'.encode()).hexdigest()[:20]}}}"
