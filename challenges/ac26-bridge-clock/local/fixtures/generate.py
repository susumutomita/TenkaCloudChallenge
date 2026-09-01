"""This deployment's numbers, and the ten values the clock drill expects.

Everything the learner types is decided here from FLAG_SEED: the clock size n, a secret
value, a random cover, and a second cover for the two-message test. The learner never sees
the expected values -- they see the assignment statements (``show.py``) and produce every
value with their own Python, one line at a time.

The subject is the world every later problem lives in: remainders. A clock face with n
ticks, where n wraps to 0. Addition and multiplication both survive the wrap, which is
what makes it a place you can compute in at all.

Then the drill does the thing that makes remainders useful for hiding. Add a uniformly
random cover to a secret and the result is uniform -- every value is equally likely, so
the holder learns nothing at all. Not "hard to work out": nothing. The learner counts the
covers themselves and sees the count come out the same for every candidate secret.

That count is the whole reason secret sharing works, and the reason a one-time cover
cannot be reused. The last two lines reuse one cover on two messages and show the
difference of the two covered values equal to the difference of the two secrets -- the
cover cancels, and something real leaks. Reuse is the oldest mistake in the subject and
the learner makes it here on purpose.

Nothing here is cryptographic. n is small enough to enumerate by hand.
"""

from __future__ import annotations

import hashlib

LINES = (
    "wrap",
    "add",
    "mul",
    "cover",
    "uncover",
    "every",
    "count",
    "reuse",
    "leak",
    "same-diff",
)

# Eight graded. "wrap" (the first look at the clock) and "same-diff" (the True that closes
# the reuse argument) are ungraded: both are read, not computed.
GRADED = (
    "add",
    "mul",
    "cover",
    "uncover",
    "every",
    "count",
    "reuse",
    "leak",
)

TUPLE_LINES = {
    "add": 3,
    "mul": 3,
    "every": 3,
    "reuse": 2,
}

BOOL_LINES = ("same-diff",)


def _draw(seed: str, label: str, low: int, high: int) -> int:
    digest = hashlib.sha256(f"{seed}:{label}".encode("utf-8")).digest()
    return low + int.from_bytes(digest[:8], "big") % (high - low + 1)


def setting(seed: str) -> dict:
    """Everything public (shown by show.py) and everything expected (kept by server.py)."""
    # A clock small enough to enumerate every position by hand.
    n = _draw(seed, "n", 12, 24)

    # Two plain values that both exceed n, so the wrap is visible rather than hypothetical.
    u = _draw(seed, "u", n + 3, 3 * n)
    v = _draw(seed, "v", n + 3, 3 * n)

    # The secret and its cover. The cover is what makes the secret disappear.
    secret = _draw(seed, "secret", 1, n - 1)

    # The cover is drawn from the WHOLE clock, 0 to n-1, and nothing about the resulting
    # observation is rejected. That matters more than it looks: the drill's central claim
    # is that every candidate secret has exactly one cover producing the observation, so
    # the observation rules nothing out. Excluding even a single cover value breaks it --
    # drop cover = 0 and a recipient who knows this generator can rule out the candidate
    # equal to the observation, because that candidate is the only one needing cover 0.
    # Perfect secrecy is a property of the uniform distribution, and it does not survive
    # being tidied up.
    cover = _draw(seed, "cover", 0, n - 1)

    covered = (secret + cover) % n

    # A second secret, covered with the SAME cover. This is the mistake.
    # A different secret, covered with the SAME cover. Only "different from the first" is
    # required -- conditioning on the observed values would reintroduce the bias the cover
    # draw above was just freed from.
    second = _draw(seed, "second", 0, n - 1)
    while second == secret:
        second = (second + 1) % n
    second_covered = (second + cover) % n

    # For each candidate secret, how many covers produce the observed covered value?
    # Exactly one, for every candidate -- so the observation rules nothing out.
    per_candidate = [
        sum(1 for c in range(n) if (cand + c) % n == covered) for cand in range(n)
    ]
    count = per_candidate[0]                    # 1, and the same for every candidate
    every_same = len(set(per_candidate)) == 1

    # The leak: the cover cancels in the difference.
    observed_gap = (covered - second_covered) % n
    real_gap = (secret - second) % n

    expected = {
        "wrap": (u % n, v % n),
        "add": ((u + v) % n, (u % n + v % n) % n, ((u + v) % n) - ((u % n + v % n) % n)),
        "mul": ((u * v) % n, (u % n) * (v % n) % n, ((u * v) % n) - ((u % n) * (v % n) % n)),
        "cover": covered,
        "uncover": (covered - cover) % n,
        # Not (1, 1, n): n is on screen, so that tuple could be copied instead of counted.
        # This asks for the count at three specific candidates, which requires actually
        # building the table. All three are 1 -- that flatness is the whole point.
        "every": (per_candidate[secret], per_candidate[(secret + 1) % n],
                  per_candidate[(covered + 3) % n]),
        "count": sum(per_candidate),
        "reuse": (covered, second_covered),
        "leak": observed_gap,
        "same-diff": observed_gap == real_gap,
    }
    public = {"n": n, "u": u, "v": v, "cover": cover, "secret": secret, "second": second}
    return {"public": public, "expected": expected}


def assignments(seed: str) -> str:
    """The public values as Python assignment statements, ready to paste into a REPL."""
    pub = setting(seed)["public"]
    return "\n".join(
        [
            f"n = {pub['n']}",
            f"u, v = {pub['u']}, {pub['v']}",
            f"secret, second = {pub['secret']}, {pub['second']}",
            f"cover = {pub['cover']}",
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
