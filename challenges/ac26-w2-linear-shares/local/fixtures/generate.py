"""Two deployments of one aggregation desk, everything derived from FLAG_SEED.

The subject is additive secret sharing: a secret `x` is split into `n` rows that
sum to it modulo a prime, one row per party, and no party ever sees another's row.
Some operations on such a sharing can be done by every party alone -- adding two
sharings, scaling by a value everyone already knows -- and the result is already a
correct sharing of the right thing. That property is why MPC is usable at all.

Adding a *public constant* is the one that looks like the others and is not. If
every party adds `c` to its own row the rows sum to `x + n*c`. Exactly one party
folds it in. The whole problem is that one difference and what it costs.

## What the participant can see, and why that is the design

They are **one party**. `shares show` prints their own two rows, the public values,
the party count, and the totals the desk published -- and never another party's row.
That is not decoration:

- Every answer becomes a single unambiguous number instead of a share vector that
  has many correct forms.
- "This operation can be done locally" stops being a claim to check and becomes a
  fact about what is on the screen: if the answer can be computed at all, it was
  computed from one row.

They do learn what the desk's aggregate should have been, because that is what the
desk publishes -- it is the output of the service, not a leak. They never learn
either input's value, only the combination the desk exists to release.

## Two cases, and why the second one is not the first one again

    live      pipeline `Z = k*(X + Y) + c`. The desk's `addpub` folds the public
              constant in at EVERY party, so the run reconstructed to
              `k*(x+y) + n*c` instead of `k*(x+y) + c`. You are not the designated
              party, so your own correct row carries no constant at all.

    transfer  handed over only once the three live stages are cleared. A different
              prime, a different party count, a pipeline that puts the constant
              INSIDE the scale (`Z = k*(X + Y + c)`), you ARE the designated party,
              and the desk's fault is the opposite one: `addpub` never ran, so
              nobody folded the constant in.

The two corrections are therefore `total = published - (n-1)*c` and
`total = published + k*c`. Nothing carries across but the reasoning: the sign is
different, the factor is different, and the transfer one has no `n` in it at all, so
an answer remembered as "subtract (n-1) times something" is wrong there. mutation.py
asserts both properties across seeds.
"""

from __future__ import annotations

import hashlib

#: Four digits, not two. Every stage's answer is a single field element and the CLI
#: takes as many attempts as anyone cares to type, so a two-digit modulus would make
#: a stage a hundred guesses wide. Four digits is still trivial arithmetic -- python3
#: is in the container and `shares show` says so -- and what it removes is the option
#: of not doing it.
PRIMES = (3989, 4001, 4003, 4007, 4013, 4019, 4021, 4027, 4049, 4051, 4057, 4073)

LIVE = "live"
TRANSFER = "transfer"
CASES = (LIVE, TRANSFER)

#: The names the classification stage's expressions are written in. `x`, `y` and `z`
#: are shared -- nobody holds them in the clear. `k` and `c` are public.
SHARED = ("x", "y", "z")
PUBLIC = ("k", "c")

#: Never below three. With two parties the designated party is half the room and
#: `n*c` sits too close to the near misses it has to be told apart from.
PARTIES = {LIVE: (3, 6), TRANSFER: (4, 7)}

#: The id prefix each case's expression list uses. Distinct, so a test can assert
#: that `show` does not print the transfer list before it is earned.
EXPRESSION_PREFIX = {LIVE: "e", TRANSFER: "g"}

#: How many of the eight listed expressions are the local ones. A fixed count would
#: turn the stage into a choice of 4 from 8; a range makes the count part of it.
LOCAL_COUNT = (3, 5)

#: How many expressions a case lists. Eight fits one terminal screen.
EXPRESSION_COUNT = 8


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
    """The one party that folds a public constant in. A desk convention, not a law."""
    return _pick(_stream(seed, f"designated:{case}"), 0, 0, party_count(seed, case) - 1)


def your_index(seed: str, case: str) -> int:
    """Which party the participant is.

    Live: never the designated one, so their own correct row carries no constant and
    the "everyone adds it" reflex is wrong on the first stage they attempt.
    Transfer: always the designated one, so the same reflex is wrong the other way --
    the constant must be folded in, and it now sits inside the scale. mutation.py
    asserts both across seeds; without them the transfer stage would be the live
    stage with different numbers.
    """
    n = party_count(seed, case)
    t = designated_party(seed, case)
    if case == TRANSFER:
        return t
    other = _pick(_stream(seed, f"you:{case}"), 0, 0, n - 2)
    return other if other < t else other + 1


def publics(seed: str, case: str) -> dict[str, int]:
    """`k` and `c`, the two values everyone already knows.

    `k` is never 0 or 1: a scale of 1 makes "did you scale" unanswerable and a scale
    of 0 destroys the sharing. `c` is never 0: at `c = 0` every wrong way of folding
    a constant in agrees with the right one.
    """
    s = _stream(seed, f"public:{case}")
    p = field_modulus(seed, case)
    return {"k": _pick(s, 0, 2, p - 1), "c": _pick(s, 4, 1, p - 1)}


def secrets(seed: str, case: str) -> dict[str, int]:
    """The two shared inputs. Not reachable from anything `shares show` prints."""
    s = _stream(seed, f"secret:{case}")
    p = field_modulus(seed, case)
    return {"x": _pick(s, 0, 1, p - 1), "y": _pick(s, 4, 1, p - 1)}


def rows(seed: str, case: str, name: str) -> list[int]:
    """One row per party, summing to the secret modulo p. Internal to the fixtures.

    `shares show` prints exactly one entry of this list -- the participant's own.
    Printing the whole table would let them reconstruct the inputs and answer every
    stage without ever acting like a party.
    """
    s = _stream(seed, f"rows:{case}:{name}")
    p = field_modulus(seed, case)
    n = party_count(seed, case)
    head = [_pick(s, 2 * i, 0, p - 1) for i in range(n - 1)]
    return [*head, (secrets(seed, case)[name] - sum(head)) % p]


def your_rows(seed: str, case: str) -> dict[str, int]:
    """The two numbers the participant actually holds."""
    j = your_index(seed, case)
    return {name: rows(seed, case, name)[j] for name in ("x", "y")}


# --------------------------------------------------------------------------- the pipeline


#: What the desk computes, per case, as it is written on the run sheet.
PIPELINE = {
    LIVE: "Z = k*(X + Y) + c",
    TRANSFER: "Z = k*(X + Y + c)",
}

#: What the previous SRE's implementation actually did with the public constant.
#: Two different faults on purpose: one folds it in too many times, the other not at
#: all, so the correction is not the same shape in the two cases.
FAULT = {
    LIVE: "addpub added c to EVERY party's own row",
    TRANSFER: "addpub never ran at all, so nobody folded c in",
}


def correct_row(seed: str, case: str) -> int:
    """The participant's own row of Z, if the pipeline is run correctly."""
    p = field_modulus(seed, case)
    values = publics(seed, case)
    k, c = values["k"], values["c"]
    mine = your_rows(seed, case)
    designated = your_index(seed, case) == designated_party(seed, case)
    if case == LIVE:
        return (k * (mine["x"] + mine["y"]) + (c if designated else 0)) % p
    return (k * (mine["x"] + mine["y"] + (c if designated else 0))) % p


def correct_total(seed: str, case: str) -> int:
    """What the desk should have published: the reconstruction of a correct run."""
    p = field_modulus(seed, case)
    values = publics(seed, case)
    secret = secrets(seed, case)
    total = secret["x"] + secret["y"]
    if case == LIVE:
        return (values["k"] * total + values["c"]) % p
    return (values["k"] * (total + values["c"])) % p


def published_total(seed: str, case: str) -> int:
    """What the desk did publish: the reconstruction of the faulty run.

    Live: every party folded `c` in, so the rows summed to `k*(x+y) + n*c`.
    Transfer: nobody did, so they summed to `k*(x+y)`.
    """
    p = field_modulus(seed, case)
    values = publics(seed, case)
    secret = secrets(seed, case)
    total = secret["x"] + secret["y"]
    if case == LIVE:
        return (values["k"] * total + party_count(seed, case) * values["c"]) % p
    return (values["k"] * total) % p


# --------------------------------------------------------------------------- expressions


def _template(text: str, local: bool, evaluate):  # noqa: ANN001, ANN202 - a fixture row
    return {"text": text, "local": local, "evaluate": evaluate}


#: Candidate expressions for the classification stage, each carrying whether it can
#: be evaluated with nobody talking.
#:
#: The criterion is exact and worth stating once. With additive sharing, party i can
#: compute its own row of `f` alone exactly when `f` is affine in the SHARED
#: variables with public coefficients -- degree at most one in `x`, `y`, `z`. Two
#: sharings added is one row plus one row; a sharing scaled by a public value is one
#: row times a known number. A product of two shared values is not: the sum of the
#: products of the rows is not the product of the sums, and no party holds enough to
#: make up the difference.
#:
#: The flag on each row is DECLARED rather than derived from the text, because a
#: parser that computes degree syntactically disagrees with the truth on things like
#: `x*y - x*y`. mutation.py rechecks every declaration independently by sampling the
#: expression over the field and testing affineness directly, so a wrong one is
#: caught by arithmetic rather than by review.
TEMPLATES = (
    _template("x + y", True, lambda v: v["x"] + v["y"]),
    _template("x - y + z", True, lambda v: v["x"] - v["y"] + v["z"]),
    _template("k*x + c", True, lambda v: v["k"] * v["x"] + v["c"]),
    _template("k*(x + y) - z", True, lambda v: v["k"] * (v["x"] + v["y"]) - v["z"]),
    _template("k*c*x", True, lambda v: v["k"] * v["c"] * v["x"]),
    _template("(k + c)*y", True, lambda v: (v["k"] + v["c"]) * v["y"]),
    _template("k*(x - z) + c", True, lambda v: v["k"] * (v["x"] - v["z"]) + v["c"]),
    _template("x + y + z + k", True, lambda v: v["x"] + v["y"] + v["z"] + v["k"]),
    _template("x*y", False, lambda v: v["x"] * v["y"]),
    _template("x*x", False, lambda v: v["x"] * v["x"]),
    _template("x*(y + c)", False, lambda v: v["x"] * (v["y"] + v["c"])),
    _template("z*(x + y)", False, lambda v: v["z"] * (v["x"] + v["y"])),
    _template("k*x*y", False, lambda v: v["k"] * v["x"] * v["y"]),
    _template("(x + c)*(y + k)", False, lambda v: (v["x"] + v["c"]) * (v["y"] + v["k"])),
    _template("(x + y)*(x - y)", False, lambda v: (v["x"] + v["y"]) * (v["x"] - v["y"])),
    _template("x*y + k*z", False, lambda v: v["x"] * v["y"] + v["k"] * v["z"]),
)


def _choose(s: list[int], offset: int, pool: list[int], count: int) -> list[int]:
    chosen: list[int] = []
    index = offset
    while len(chosen) < count:
        candidate = pool[_pick(s, index % 180, 0, len(pool) - 1)]
        if candidate not in chosen:
            chosen.append(candidate)
        index += 2
    return chosen


def expressions(seed: str, case: str) -> list[dict[str, object]]:
    """This case's eight expressions, with ids, in the order they are printed."""
    s = _stream(seed, f"expressions:{case}")
    locals_available = [i for i, row in enumerate(TEMPLATES) if row["local"]]
    others_available = [i for i, row in enumerate(TEMPLATES) if not row["local"]]
    local_count = _pick(s, 0, *LOCAL_COUNT)
    picked = [
        *_choose(s, 2, locals_available, local_count),
        *_choose(s, 80, others_available, EXPRESSION_COUNT - local_count),
    ]
    # Shuffled, so position never correlates with the answer.
    order = sorted(range(len(picked)), key=lambda i: (s[(120 + i) % 180], i))
    prefix = EXPRESSION_PREFIX[case]
    return [
        {
            "id": f"{prefix}{position + 1}",
            "text": TEMPLATES[picked[index]]["text"],
            "local": TEMPLATES[picked[index]]["local"],
            "template": picked[index],
        }
        for position, index in enumerate(order)
    ]


def local_ids(seed: str, case: str) -> list[str]:
    """The ids of the expressions that need no communication. The stage's answer."""
    return [str(row["id"]) for row in expressions(seed, case) if row["local"]]


def flag(seed: str) -> str:
    """Derived from the per-deploy seed, so it can be neither memorised nor guessed."""
    return f"TC{{linear_shares_{hashlib.sha256(f'flag:{seed}'.encode()).hexdigest()[:20]}}}"
