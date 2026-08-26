"""Derive every fixture from the per-deploy FLAG_SEED.

Nothing here ships a committed constant a learner could memorize. Same seed, same
fixtures (so a session is reproducible and debuggable); different seed, different
fixtures (so an answer copied from someone else's run does not carry).

One deliberate exception: `hidden_blocks` includes the padded `abc` block, whose
schedule FIPS 180-4 publishes. That one is a gift, not a leak — a learner who wants
to check their expansion against the specification should be able to.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

MASK = 0xFFFFFFFF
WORD_BITS = 32
WORDS_PER_BLOCK = 16
SCHEDULE_WORDS = 64


@dataclass(frozen=True)
class RotateCase:
    """One word, one rotation amount, one shift amount."""

    word: int
    rotate_by: int
    shift_by: int


@dataclass(frozen=True)
class MuxCase:
    """Three words for Ch(e, f, g). `e` is the selector."""

    e: int
    f: int
    g: int


@dataclass(frozen=True)
class DependencyCase:
    """A block, and one bit of it to flip."""

    words: tuple[int, ...]
    index: int
    bit: int


def _stream(seed: str, label: str) -> list[int]:
    """A deterministic byte stream for (seed, label). Not a CSPRNG; it does not need to be."""
    out: list[int] = []
    counter = 0
    while len(out) < 512:
        out.extend(hashlib.sha256(f"{seed}:{label}:{counter}".encode()).digest())
        counter += 1
    return out


def _word(stream: list[int], index: int) -> int:
    """Four bytes of the stream as a 32-bit word."""
    base = (index * 4) % (len(stream) - 4)
    return int.from_bytes(bytes(stream[base : base + 4]), "big")


def _pick(stream: list[int], index: int, low: int, high: int) -> int:
    """Uniform-enough choice in [low, high]. The ranges are tiny, so modulo bias is irrelevant."""
    span = high - low + 1
    return low + ((stream[index] * 256 + stream[index + 1]) % span)


def rotate_case(seed: str) -> RotateCase:
    """The `rotate` checkpoint.

    Both amounts avoid 0 and 32, where a rotation and a shift would be indistinguishable
    from doing nothing, and the word always has bits set in its low 8 positions — so a
    rotation visibly wraps them to the top and a shift visibly loses them.
    """
    s = _stream(seed, "rotate")
    word = _word(s, 0) | _pick(s, 8, 1, 255)
    return RotateCase(word=word, rotate_by=_pick(s, 10, 3, 29), shift_by=_pick(s, 12, 3, 29))


def mux_case(seed: str) -> MuxCase:
    """The `mux` checkpoint.

    `f` and `g` are forced to be bitwise complements. That makes Ch(e, f, g) equal `f`
    exactly where e is 1 and `g` exactly where e is 0, with no position where the two
    choices happen to agree and hide a mistake.
    """
    s = _stream(seed, "mux")
    f = _word(s, 0)
    return MuxCase(e=_word(s, 4), f=f, g=~f & MASK)


def dependency_case(seed: str) -> DependencyCase:
    """The `dependency` checkpoint: which schedule word feels a single flipped input bit first.

    The flipped index ranges over all 16 inputs on purpose, because the answer is not one
    formula. W[i] reads W[i-16], W[i-15], W[i-7] and W[i-2], but W[0..15] are inputs rather
    than computed, so the earliest *computed* word that reads index k depends on where k sits.
    """
    s = _stream(seed, "dependency")
    words = tuple(_word(s, position) for position in range(WORDS_PER_BLOCK))
    return DependencyCase(
        words=words,
        index=_pick(s, 100, 0, WORDS_PER_BLOCK - 1),
        bit=_pick(s, 102, 0, WORD_BITS - 1),
    )


def hidden_words(seed: str) -> list[int]:
    """Words for the hidden sigma checks: the boundary values, then seeded ones.

    0 and 0xffffffff lead because they are where a rotation and a shift are easiest to
    confuse. sigma1(0xffffffff) is 0x003fffff — the two rotations of an all-ones word
    cancel under xor and only the shift survives — which is true only if the third term
    really is a shift.
    """
    s = _stream(seed, "sigma-words")
    boundaries = [0, 1, MASK, 0x80000000, 0x7FFFFFFF, 0xAAAAAAAA, 0x55555555, 0x00000400]
    return boundaries + [_word(s, position) for position in range(24)]


def hidden_triples(seed: str) -> list[tuple[int, int, int]]:
    """Triples for the hidden Ch / Maj checks.

    The first eight are the single-bit truth table: every combination of one bit across the
    three inputs, so a parity-instead-of-majority implementation fails on a named row rather
    than on a random word it is hard to reason about.
    """
    table = [(a, b, c) for a in (0, 1) for b in (0, 1) for c in (0, 1)]
    s = _stream(seed, "triples")
    seeded = [(_word(s, i * 3), _word(s, i * 3 + 1), _word(s, i * 3 + 2)) for i in range(12)]
    return table + [(0, MASK, 0), (MASK, 0, MASK), (MASK, MASK, 0)] + seeded


def hidden_blocks(seed: str) -> list[tuple[int, ...]]:
    """16-word blocks for the hidden schedule check.

    The all-zero block is included for a reason worth stating: xor and addition agree on it,
    so a schedule that xors its four terms produces the correct all-zero schedule and this
    block alone would let the defect through. The others are what catch it.
    """
    s = _stream(seed, "blocks")
    return [
        tuple(0 for _ in range(WORDS_PER_BLOCK)),
        tuple(MASK for _ in range(WORDS_PER_BLOCK)),
        tuple(_word(s, position) for position in range(WORDS_PER_BLOCK)),
        tuple(_word(s, position + 40) for position in range(WORDS_PER_BLOCK)),
        # `abc` padded. FIPS 180-4 publishes this block's schedule, so a learner can check
        # their expansion against the specification rather than against this problem.
        (
            0x61626380,
            0x00000000,
            0x00000000,
            0x00000000,
            0x00000000,
            0x00000000,
            0x00000000,
            0x00000000,
            0x00000000,
            0x00000000,
            0x00000000,
            0x00000000,
            0x00000000,
            0x00000000,
            0x00000000,
            0x00000018,
        ),
    ]


def health_token(seed: str) -> str:
    """Proof the learner actually started the container rather than reading the README."""
    case = rotate_case(seed)
    return hashlib.sha256(f"health:{seed}:{case.word:08x}".encode()).hexdigest()[:16]


def public_payload(seed: str) -> dict[str, object]:
    """Everything a participant may see for this deployment. Contains no answer.

    The single source `show.py`, `verifier/server.py`'s `GET /public`, and
    `tests/public/test_schedule.py` all build their payload from. What is deliberately
    absent is anything derived from the recurrence itself: no sigma output and no
    expanded schedule (those are `sigma` and `schedule`'s answers), and no
    `first_affected_index` (that is `dependency`'s answer, computed in
    `verifier/server.py`, which never ships here). The rotate, mux and dependency cases
    below are the *inputs* those three checkpoints hand the learner, not their answers.

    Issue 537/538: `fixtures/` -- this module -- does not ship in the participant Docker
    stage at all (see ../Dockerfile). `participant/server.py`, `show.py` and the public
    tests fetch this payload from the verifier at runtime instead of importing it
    directly.
    """
    rotate = rotate_case(seed)
    mux = mux_case(seed)
    dependency = dependency_case(seed)
    return {
        "rotate": {"word": rotate.word, "rotateBy": rotate.rotate_by, "shiftBy": rotate.shift_by},
        "mux": {"e": mux.e, "f": mux.f, "g": mux.g},
        "dependency": {
            "words": list(dependency.words),
            "index": dependency.index,
            "bit": dependency.bit,
        },
        "healthToken": health_token(seed),
    }
