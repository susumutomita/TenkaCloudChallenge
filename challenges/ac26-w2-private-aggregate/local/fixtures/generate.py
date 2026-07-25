"""The application, its inputs, and the protocol handle that counts what it costs.

Several organizations each hold an incident count and a severity. They want the
weighted risk score

    score = sum_i (count_i * severity_i) + bias        (bias public, mod p)

and nothing else. Both factors of every product are secret and held by *different*
sides of the same organization's split, so each term is a multiplication of two shared
values -- the one operation that cannot be done locally.

The two numbers that matter here are not the same number:

    multiplications   one per organization
    rounds            one, for all of them together

Every Beaver multiplication needs its own triple, but the openings of `d` and `e` are
independent, so they all fit in a single batch. An implementation that opens each
multiplication separately is correct, private, and costs `k` times the latency. The
protocol handle below counts batches, which is what makes that difference gradable
instead of assertable.

Toy parameters, small enough to check by hand. Not secure and not a model of a real
deployment.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field

PRIMES = (2003, 2011, 2017, 2027, 2029, 2039, 2053, 2063)


def _stream(seed: str, label: str) -> list[int]:
    out: list[int] = []
    counter = 0
    while len(out) < 160:
        out.extend(hashlib.sha256(f"{seed}:{label}:{counter}".encode()).digest())
        counter += 1
    return out


def _pick(s: list[int], i: int, low: int, high: int) -> int:
    return low + ((s[i % 150] * 256 + s[(i + 1) % 150]) % (high - low + 1))


@dataclass(frozen=True)
class Setting:
    p: int
    parties: int
    counts: tuple[int, ...]
    severities: tuple[int, ...]
    bias: int

    def as_public(self) -> dict[str, object]:
        """What the participant is told. Never the inputs themselves."""
        return {"p": self.p, "parties": self.parties, "bias": self.bias}


def setting(seed: str, label: str = "public") -> Setting:
    s = _stream(seed, f"setting:{label}")
    p = PRIMES[s[0] % len(PRIMES)]
    parties = _pick(s, 2, 2, 6)
    return Setting(
        p=p,
        parties=parties,
        counts=tuple(_pick(s, 10 + 2 * i, 0, 40) for i in range(parties)),
        severities=tuple(_pick(s, 60 + 2 * i, 1, 9) for i in range(parties)),
        bias=_pick(s, 110, 0, p - 1),
    )


def plain_score(st: Setting) -> int:
    """The answer, computed with no privacy at all. The protocol must match it."""
    total = sum(c * v for c, v in zip(st.counts, st.severities))
    return (total + st.bias) % st.p


def shares_of(seed: str, label: str, secret: int, n: int, p: int) -> list[int]:
    s = _stream(seed, f"shares:{label}")
    head = [_pick(s, 2 * i, 0, p - 1) for i in range(n - 1)]
    return [*head, (secret - sum(head)) % p]


def reconstruct(shares: list[int], p: int) -> int:
    return sum(shares) % p


@dataclass(frozen=True)
class Triple:
    a: list[int]
    b: list[int]
    c: list[int]


def triples(seed: str, label: str, st: Setting, count: int) -> list[Triple]:
    """`count` independent preprocessed triples. Reusing one is a real defect, not a
    style question, so they are generated distinctly and the hidden tests check it."""
    out: list[Triple] = []
    for index in range(count):
        s = _stream(seed, f"triple:{label}:{index}")
        a = _pick(s, 0, 1, st.p - 1)
        b = _pick(s, 4, 1, st.p - 1)
        out.append(
            Triple(
                a=shares_of(seed, f"{label}-a{index}", a, st.parties, st.p),
                b=shares_of(seed, f"{label}-b{index}", b, st.parties, st.p),
                c=shares_of(seed, f"{label}-c{index}", (a * b) % st.p, st.parties, st.p),
            )
        )
    return out


def inputs_shared(seed: str, label: str, st: Setting) -> dict[str, list[list[int]]]:
    """Every organization's two private figures, already split. Nobody holds either."""
    return {
        "counts": [
            shares_of(seed, f"{label}-count{i}", value, st.parties, st.p)
            for i, value in enumerate(st.counts)
        ],
        "severities": [
            shares_of(seed, f"{label}-sev{i}", value, st.parties, st.p)
            for i, value in enumerate(st.severities)
        ],
    }


class ForbiddenOpen(Exception):
    """Raised when the protocol asks to reveal something it has no business revealing."""


@dataclass
class Protocol:
    """The only way a submission is allowed to reveal anything.

    `open_batch` reveals several sharings at once and counts as **one** round. That is
    the entire cost model: a submission that calls it once per multiplication pays `k`
    rounds for work that fits in one, and the count is measured rather than claimed.

    Every opened sharing is recorded, so the privacy checkpoint audits what a run
    actually revealed rather than what it says it revealed.
    """

    p: int
    rounds: int = 0
    opened: list[list[int]] = field(default_factory=list)
    batch_sizes: list[int] = field(default_factory=list)

    def open_batch(self, sharings: list[list[int]]) -> list[int]:
        if not isinstance(sharings, list) or not sharings:
            raise ForbiddenOpen("an opening round must reveal at least one sharing")
        values = []
        for sharing in sharings:
            if not isinstance(sharing, list) or not sharing:
                raise ForbiddenOpen("that is not a sharing")
            self.opened.append(list(sharing))
            values.append(sum(sharing) % self.p)
        self.rounds += 1
        self.batch_sizes.append(len(sharings))
        return values


def health_token(seed: str) -> str:
    st = setting(seed)
    return hashlib.sha256(f"health:{seed}:{st.p}:{st.parties}".encode()).hexdigest()[:16]
