"""This deployment's numbers, and the twelve values the rotation drill expects.

Everything the learner types is decided here from FLAG_SEED: the plaintext and ciphertext
moduli, the ring size, the binary secret, the mask and body of one LWE ciphertext, and the
function the test polynomial evaluates. The learner never sees the expected values -- they
see the assignment statements (``show.py``) and produce every value with their own Python,
one line at a time.

The procedure is the Week 5 lecture's Programmable Bootstrapping (slides 21-26 for the
rotation, slide 42 for why it is "programmable"): rescale the ciphertext onto the ring's
2n positions, rotate the test polynomial by what the ciphertext points at, read the
constant term. The numbers are this deployment's own (the independent-reimplementation
rule) -- in particular the lecture's own worked example is excluded below, so no
deployment can be solved by copying slide 26.

The one thing worth stating twice, because getting it wrong silently removes the whole
subject of the sibling drill: the rotation index lives **mod 2n**, not mod n.

Nothing here is cryptographic. Toy parameters are for observability.
"""

from __future__ import annotations

import hashlib

#: (plaintext modulus, ring size). q is derived so that q = 2n * (a power of two), which
#: keeps the rescaling factor 2n/q exact and the drill's arithmetic in integers.
SHAPES = (
    (8, 32, 128),
    (8, 32, 256),
    (8, 64, 256),
    (16, 64, 256),
    (16, 64, 512),
    (16, 128, 512),
)

#: The lecture's own worked example (slide 26): p = 8, n = 16, q = 64. Excluded.
LECTURE_EXAMPLE = (8, 16, 64)

LINES = (
    "params",
    "phase",
    "split",
    "slots",
    "testpoly",
    "rescale",
    "index",
    "readout",
    "programmable",
    "window",
    "edge",
    "sweep",
)

# The lines that have an answer field. The platform allows at most eight checkpoints, so
# four lines are ungraded material: `split` and `slots` are pairs/counts of very small
# integers that collide by chance with digits already on screen, `programmable` restates
# `readout` once the learner knows what f is, and `sweep` is the closing all-cases check
# whose content is already covered by `readout` and `edge`.
GRADED = (
    "params",
    "phase",
    "testpoly",
    "rescale",
    "index",
    "readout",
    "window",
    "edge",
)

TUPLE_LINES = {
    "params": 4,
    "split": 2,
    "testpoly": 4,
    "rescale": 3,
}

BOOL_LINES = ("sweep",)


def _draw(seed: str, label: str, low: int, high: int) -> int:
    digest = hashlib.sha256(f"{seed}:{label}".encode("utf-8")).digest()
    return low + int.from_bytes(digest[:8], "big") % (high - low + 1)


def _shapes() -> tuple[tuple[int, int, int], ...]:
    return tuple(s for s in SHAPES if s != LECTURE_EXAMPLE)


def constant_term(coefficients, index: int) -> int:
    """Constant term of `x^(-index) * v(x) mod x^n + 1`. Negated at or above n."""
    degree = len(coefficients)
    wrapped = index % (2 * degree)
    if wrapped < degree:
        return coefficients[wrapped]
    return -coefficients[wrapped - degree]


def setting(seed: str) -> dict:
    """Everything public (shown by show.py) and everything expected (kept by server.py)."""
    shapes = _shapes()
    modulus_p, degree, q = shapes[_draw(seed, "shape", 0, len(shapes) - 1)]
    delta = q // modulus_p
    dimension = _draw(seed, "dimension", 4, 8)

    # A 0/1 secret with at least one 1: an all-zero secret makes the mask term vanish and
    # the drill would pass without the learner ever taking an inner product.
    secret = tuple(_draw(seed, f"s-{i}", 0, 1) for i in range(dimension))
    if not any(secret):
        secret = (1,) + secret[1:]

    def rescale(value: int) -> int:
        return round(value * 2 * degree / q)

    # `a` is rescaled coefficient by coefficient and each one is rounded, so the index the
    # learner computes carries the SUM of those roundings -- up to k/2 positions away from
    # the exact target. Most draws land well inside the plaintext's region; a few do not,
    # and on those the drill's own answer would be the neighbouring value. Rather than
    # pretend the rounding is harmless, the mask is redrawn until the deployment is one
    # where the readout is right for every usable plaintext (`_mask_is_clean` below).
    # Roughly one draw in eighty is rejected.
    mask = tuple(_draw(seed, f"a-{i}", 0, q - 1) for i in range(dimension))
    inner = sum(x * y for x, y in zip(mask, secret)) % q

    # The message and its noise. The noise stays inside the slot width so the readout is
    # the one the test polynomial intends; the sibling `window` line is where the learner
    # finds out how much room that leaves.
    slot = 2 * degree // modulus_p          # positions per plaintext after rescaling

    # Only the lower half of the plaintext space is usable. Past it the rotation index
    # crosses n and the constant term comes back negated, so the readout can never equal
    # f(m) for an f into [0, p). This is what slide 26 means by writing the plaintext
    # space as Z_8 and then adding "実際に使うのは0~3" -- the parenthetical is the
    # negacyclic constraint, not a simplification. `usable` is that half.
    usable = modulus_p // 2
    message = _draw(seed, "m", 0, usable - 1)
    # The noise must stay inside the slot's half-width once rescaled, or the index leaves
    # its plaintext's region and the readout is the neighbour's value. Rescaling multiplies
    # by 2n/q, and a region reaches slot/2 = n/p either side of its centre, so the bound is
    # e < delta/2. A quarter of delta is used, which leaves visible room for the `edge`
    # line to measure rather than sitting exactly on the limit.
    noise_cap = max(1, delta // 4)
    noise = _draw(seed, "e", 1, noise_cap)
    body = (inner + delta * message + noise) % q

    # The function the test polynomial evaluates -- this is what makes it *programmable*.
    # A permutation of Z_p that is not the identity, so `readout` differs from `split`.
    shift = _draw(seed, "f-shift", 1, usable - 1) if usable > 2 else 1

    def f(value: int) -> int:
        """A permutation of the usable half, never the identity."""
        return (value + shift) % usable

    # v[j] = f(the plaintext whose rescaled position is j), with the slot boundaries
    # shifted by half a slot so that a plaintext's target index sits in the MIDDLE of its
    # region rather than on its first position.
    #
    # This is not cosmetic. `a` and `b` are rescaled independently and each is rounded, so
    # the index the learner computes differs from the exact target by the accumulated
    # rounding error -- often by -1. With the regions starting exactly at m*slot, that -1
    # drops the readout into the previous plaintext's region and the whole drill returns
    # the wrong value on those seeds. Centring gives slot/2 of room on both sides. This is
    # what slide 24 means by its heading 「ポイントは幅を持たせること」.
    v = [f(min((j + slot // 2) // slot, usable - 1) % usable) for j in range(degree)]

    def readout_table(msk):
        """(rescaled mask, per-plaintext readout) for one candidate mask."""
        rescaled = tuple(rescale(x) for x in msk)
        shifted = sum(x * y for x, y in zip(rescaled, secret))
        inner_local = sum(x * y for x, y in zip(msk, secret)) % q
        table = {}
        for plain in range(usable):
            body_local = (inner_local + delta * plain + noise) % q
            idx = (rescale(body_local) - shifted) % (2 * degree)
            table[plain] = (idx, constant_term(v, idx))
        return rescaled, table

    attempt = 0
    while True:
        rescaled_mask, table = readout_table(mask)
        if all(value == f(plain) for plain, (_, value) in table.items()):
            break
        attempt += 1
        if attempt > 64:  # unreachable in practice; keeps the loop total
            break
        mask = tuple(_draw(seed, f"a-{i}-retry{attempt}", 0, q - 1) for i in range(dimension))
        inner = sum(x * y for x, y in zip(mask, secret)) % q
        body = (inner + delta * message + noise) % q

    index = table[message][0]
    rescaled_body = rescale(body)

    readout = constant_term(v, index)

    # Every plaintext, run through the same machine: does the readout equal f(m) for all m?
    sweep = all(value == f(plain) for plain, (_, value) in table.items())

    # The largest extra noise the readout survives: push the index up one position at a
    # time until the constant term changes. This is the slot width seen from the inside.
    edge = 0
    while edge < 2 * degree and constant_term(v, index + edge + 1) == readout:
        edge += 1

    # How far the noise may move before the readout changes.
    window = sum(1 for d in range(-slot, slot + 1) if constant_term(v, index + d) == readout)

    expected = {
        "params": (modulus_p, q, degree, delta),
        "phase": (body - inner) % q,
        "split": divmod((body - inner) % q, delta),
        "window": window,
        "testpoly": tuple(v[min(j * slot, degree - 1)] for j in range(4)),
        "rescale": (rescale(delta), rescaled_mask[0], rescaled_body),
        "index": index,
        "readout": readout,
        "programmable": f(message),
        "sweep": sweep,
        "edge": edge,
        "slots": slot,
    }
    public = {
        "usable": modulus_p // 2,
        "p": modulus_p,
        "q": q,
        "n": degree,
        "k": dimension,
        "s": list(secret),
        "a": list(mask),
        "b": body,
        "shift": shift,
    }
    return {"public": public, "expected": expected}


def assignments(seed: str) -> str:
    """The public values as Python assignment statements, ready to paste into a REPL."""
    pub = setting(seed)["public"]
    return "\n".join(
        [
            f"p, q, n = {pub['p']}, {pub['q']}, {pub['n']}",
            f"D = q // p",
            f"s = {tuple(pub['s'])}",
            f"a = {tuple(pub['a'])}",
            f"b = {pub['b']}",
            f"shift = {pub['shift']}",
        ]
    )


def normalize_answer(line: str, raw: object):
    """Turn whatever the learner pasted into the shape the expected value has."""
    if line in BOOL_LINES:
        if isinstance(raw, bool):
            return raw
        if isinstance(raw, str) and raw.strip().lower() in ("true", "false"):
            return raw.strip().lower() == "true"
        return None
    width = TUPLE_LINES.get(line)
    if width is not None:
        if isinstance(raw, str):
            cleaned = raw.strip().strip("()[]")
            parts = [part.strip() for part in cleaned.split(",") if part.strip() != ""]
        elif isinstance(raw, (list, tuple)):
            parts = list(raw)
        else:
            return None
        if len(parts) != width:
            return None
        try:
            return tuple(int(part) for part in parts)
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
