"""The only file you edit.

A signing service kept an audit log. It holds, per signature: the message, the public
key, the commitment R, and the response z. It does not hold the secret key — that was
the point of keeping a log at all.

Somewhere in the log, one signer used the same commitment twice.

    z1 = k + e1*x
    z2 = k + e2*x

Two equations. Two unknowns. You already have one of them.

This is not a story about weak random number generators, although it is usually told
that way. It is the Sigma protocol's *special soundness*: two accepting transcripts that
share a commitment and differ in the challenge yield the witness. That property is what
makes the protocol a proof of knowledge — the same fact that makes it sound is the fact
that makes nonce reuse fatal.

`fixtures.generate` gives you the group, the challenge function, and the log.
"""

from __future__ import annotations


class MalformedRecord(Exception):
    """Raised for a log record that is not a well-formed transcript."""


def parse_record(record, group):
    """Normalize one audit-log record, or raise MalformedRecord.

    The log is data from outside your program. Some rows are broken.
    """
    return {}


def accepts(parsed, group) -> bool:
    """Whether this record is an accepting transcript.

    Worth asking before attacking a pair: what does reuse in a *rejected* transcript
    prove?
    """
    return False


def find_reuse(records, group) -> list[tuple[int, int]]:
    """Index pairs that can be attacked together.

    Sharing a commitment is necessary. Ask yourself what else has to match before two
    transcripts are two equations in the same unknown.
    """
    return []


def recover_secret(first, second, group) -> int:
    """The secret key, from two accepting transcripts sharing a commitment.

    Subtract one response from the other and see what cancels. Something has to be
    inverted, and there is exactly one case where it cannot be — handle that case.
    """
    return 0


def confirms(secret: int, public, group) -> bool:
    """Whether the recovered scalar really is that public key's secret."""
    return False


def attack_log(records, group) -> dict:
    """Find the reuse in a noisy log and return a confirmed recovery.

    Return {"secret", "public_key", "records"} or {} if there is nothing to find.
    """
    return {}


def collision_experiment(seed: str, group, samples: int) -> dict:
    """Measure `fixtures.generate.truncated_nonce`.

    Return {"collisions", "distinct", "space"}. Predict the number before you run it —
    the generator's output looks like hash output, because it is.
    """
    return {}


def safe_nonce(secret: int, message: bytes, group) -> int:
    """Your repair. A nonce that does not repeat across different messages.

    Deterministic is allowed, and is probably what you want. Think about what has to go
    into it so that two different messages cannot collide — and about what has to go in
    so that two different *signers* of the same message do not collide either.
    """
    return 1
