"""Instances and the three toy verifiers, all derived from the per-deploy FLAG_SEED.

The relation is deliberately small integer arithmetic, not a real proof system:

    the prover claims to know w with   a*w + b == c  (mod p)   and   lo <= w <= hi

Everything the learner reasons about is visible in these few dozen lines, so the
difficulty is in telling the *properties* apart, not in reading a crypto library.

Three verifiers, each broken differently on purpose:

  P1  complete? no.  Off-by-one range check rejects a witness that is genuinely valid.
  P2  sound?    no.  Range check missing entirely, so a witness outside [lo, hi]
                     is accepted and the in-range claim is never actually proved.
  P3  private?  no.  Accepts and rejects correctly, but writes the witness into the
                     transcript, so anyone reading the transcript learns it.

None of the three is "just buggy code": each satisfies some properties and breaks
others, which is the distinction the learner has to be able to state.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

PROTOCOL_IDS = ("p1", "p2", "p3")


@dataclass(frozen=True)
class Instance:
    """One statement: a*w + b == c (mod p), with w claimed to be in [lo, hi]."""

    p: int
    a: int
    b: int
    c: int
    lo: int
    hi: int
    # The witness the honest prover holds. Never shown to the learner directly.
    witness: int

    def as_public(self) -> dict[str, int]:
        """The statement, without the witness. This is what a verifier gets."""
        return {
            "p": self.p,
            "a": self.a,
            "b": self.b,
            "c": self.c,
            "lo": self.lo,
            "hi": self.hi,
        }


def _stream(seed: str, label: str) -> list[int]:
    out: list[int] = []
    counter = 0
    while len(out) < 64:
        out.extend(hashlib.sha256(f"{seed}:{label}:{counter}".encode()).digest())
        counter += 1
    return out


def _pick(stream: list[int], index: int, low: int, high: int) -> int:
    span = high - low + 1
    return low + ((stream[index] * 256 + stream[index + 1]) % span)


# Small primes: large enough that the relation is not guessable by eye, small enough
# that a learner can check any single step with a calculator.
_PRIMES = (101, 103, 107, 109, 113, 127, 131, 137, 139, 149)


def instance(seed: str, label: str = "public", *, witness_at_lower_bound: bool = False) -> Instance:
    """Build one statement.

    `witness_at_lower_bound` places the honest witness exactly at `lo`. That case
    matters because P1's only defect is a strict lower bound: for any instance whose
    witness sits strictly inside the range, P1 behaves identically to a correct
    verifier and its incompleteness is unobservable. The incompleteness checkpoint
    therefore uses a boundary instance — the failure has to be reachable for the
    learner to demonstrate it.
    """
    s = _stream(seed, f"instance:{label}")
    p = _PRIMES[s[0] % len(_PRIMES)]
    a = _pick(s, 2, 1, p - 1)
    lo = _pick(s, 4, 2, p // 3)
    hi = lo + _pick(s, 6, 5, p // 3)
    witness = lo if witness_at_lower_bound else _pick(s, 8, lo + 1, hi - 1)
    b = _pick(s, 10, 0, p - 1)
    c = (a * witness + b) % p
    return Instance(p=p, a=a, b=b, c=c, lo=lo, hi=hi, witness=witness)


def boundary_instance(seed: str, label: str = "boundary") -> Instance:
    """The instance used for the incompleteness checkpoint: honest witness at `lo`."""
    return instance(seed, label, witness_at_lower_bound=True)


def satisfies_relation(inst: Instance, w: int) -> bool:
    """The algebraic half of the statement, with no range condition."""
    return (inst.a * w + inst.b) % inst.p == inst.c % inst.p


def in_range(inst: Instance, w: int) -> bool:
    return inst.lo <= w <= inst.hi


def is_true_statement(inst: Instance, w: int) -> bool:
    """What an ideal verifier accepts: the relation holds AND w is in range."""
    return satisfies_relation(inst, w) and in_range(inst, w)


def verify(protocol_id: str, inst: Instance, w: int) -> tuple[bool, dict[str, object]]:
    """Run one toy verifier. Returns (accepted, transcript).

    The transcript is what an observer sees. Whether it leaks the witness is exactly
    what the privacy checkpoint is about.
    """
    if protocol_id == "p1":
        # Off-by-one: strict lower bound, so w == lo is rejected even though the
        # statement says lo <= w. Complete? No. Sound? Yes. Private? Yes.
        accepted = satisfies_relation(inst, w) and inst.lo < w <= inst.hi
        return accepted, {"protocol": "p1", "checked": ["relation", "range(strict-lo)"]}
    if protocol_id == "p2":
        # Range check dropped. Complete? Yes. Sound? No — a witness outside [lo, hi]
        # that satisfies the relation is accepted, so the in-range claim is unproved.
        accepted = satisfies_relation(inst, w)
        return accepted, {"protocol": "p2", "checked": ["relation"]}
    if protocol_id == "p3":
        # Correct accept/reject, but the transcript carries the witness.
        # Complete? Yes. Sound? Yes. Private? No.
        accepted = is_true_statement(inst, w)
        return accepted, {
            "protocol": "p3",
            "checked": ["relation", "range"],
            "opening": {"value": w, "note": "recorded for audit"},
        }
    raise ValueError(f"unknown protocol id: {protocol_id}")


# The property matrix the learner has to arrive at. Kept inside the image so the
# verifier can grade it; never written anywhere the learner can read.
TRUTH: dict[str, dict[str, bool]] = {
    "p1": {"complete": False, "sound": True, "private": True},
    "p2": {"complete": True, "sound": False, "private": True},
    "p3": {"complete": True, "sound": True, "private": False},
}


def health_token(seed: str) -> str:
    inst = instance(seed)
    return hashlib.sha256(
        f"health:{seed}:{inst.p}:{inst.a}:{inst.c}".encode()
    ).hexdigest()[:16]
