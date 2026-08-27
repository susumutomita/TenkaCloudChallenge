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

Issue 537/538 (Issue 543 option B2): this module derives every setting a checkpoint is
graded against -- the secret counts and severities behind `plain_score`, and the triples
`check_privacy` builds its expected opening set from -- so it does not ship in the
`participant` Docker stage any more (see ../Dockerfile). The opening handle a learner is
handed is not part of that and stayed behind in `participant/protocol.py`, which is
imported below rather than restated. `public_payload` at the bottom is what the
participant image reads over the network instead of importing this file.
"""

from __future__ import annotations

import hashlib
import sys
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# The supplied half, single-sourced. `participant/protocol.py` is the copy that ships in
# the participant image; importing it here rather than restating it is what keeps the
# round counting a learner sees identical to the round counting they are graded by.
from participant.protocol import (  # noqa: E402 - after the sys.path insert above
    ForbiddenOpen,
    Protocol,
    reconstruct,
)

__all__ = [
    "ForbiddenOpen",
    "Protocol",
    "Setting",
    "Triple",
    "health_token",
    "inputs_shared",
    "plain_score",
    "public_payload",
    "reconstruct",
    "setting",
    "shares_of",
    "triples",
]

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


def health_token(seed: str) -> str:
    st = setting(seed)
    return hashlib.sha256(f"health:{seed}:{st.p}:{st.parties}".encode()).hexdigest()[:16]


def public_payload(seed: str) -> dict[str, object]:
    """Everything a participant may see for this deployment. Carries values, not code.

    This is the `public` label only. Every checkpoint is graded on the `h0`, `h1` and
    `h2` labels (see tests/hidden/check_aggregate.py), which derive a different modulus,
    a different organization count and different secrets from the same seed -- so nothing
    below narrows a graded run.

    Within the `public` label it carries the whole input, because the public tests hand
    exactly this to `aggregate` as its arguments: a submission holds every share of every
    count and severity at runtime by construction, and a sharing is a sum away from its
    value in a single process. Withholding it here would hide it from the tests and from
    nobody else. `show.py` prints one organization's row of it, as it always did.

    What does not travel is the seed derivation itself. `setting`, `inputs_shared`,
    `triples` and `plain_score` decide the hidden labels too, and the module they live in
    ships beside `tests/hidden/check_aggregate.py`, whose assertions state this problem's
    answers outright -- the three numbers `plan` must return among them.
    """
    st = setting(seed)
    shared = inputs_shared(seed, "public", st)
    triple_list = triples(seed, "public", st, st.parties)
    return {
        "params": {"p": st.p, "parties": st.parties, "bias": st.bias},
        "counts": [list(sharing) for sharing in shared["counts"]],
        "severities": [list(sharing) for sharing in shared["severities"]],
        "triples": [{"a": list(t.a), "b": list(t.b), "c": list(t.c)} for t in triple_list],
        "healthToken": health_token(seed),
    }
