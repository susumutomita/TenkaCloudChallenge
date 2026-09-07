"""The only file you edit.

A signing service kept an audit log. It holds, per signature: the message, the public
key, the commitment R, and the response z. It does not hold the secret key — that was
the point of keeping a log at all.

Somewhere in the log, one signer used the same commitment twice.

    z1 = k + e1*x
    z2 = k + e2*x

Two equations. Two unknowns. You already have one of them.

This is not a story about weak random number generators, although it is usually told
that way. A Sigma protocol is a three-message proof conversation: a commitment (the first
value R), a challenge (the verifier's question number e), and a response z.
A transcript is the recorded conversation; accepting means its verification equation
holds. Special soundness means that two such valid records with the same public key
and R but different e reveal the witness — the secret answer x.
This extraction explains the nonce-reuse attack. The equation alone is not a security
proof for the entire signature scheme.

`participant.schnorr` gives you the group, the challenge function, and the signing
routine the log records. The log itself is handed to you as an argument, and
Inspect evidence in Participant Portal displays this deployment's log.
"""

# Point coordinates must be integers (not bool), in 0..group.p-1.
# Reject infinity before accepting curve membership; otherwise raise MalformedRecord.
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
    """Measure `participant.schnorr.truncated_nonce`.

    Use secret=1 and message=f"trial-{i}".encode() for i in range(samples).
    Pass seed unchanged to truncated_nonce(seed, 1, message, group).
    Return {"collisions", "distinct", "space"}. Predict the number before you run it —
    the generator's output looks like hash output, because it is.
    """
    return {}


def safe_nonce(secret: int, message: bytes, group) -> int:
    """Your repair. Use the exact HMAC-SHA256 encoding in the free statement.

    Deterministic is allowed, and is probably what you want. Think about what has to go
    into it to make collisions unlikely for different messages and signers. A finite
    output range cannot guarantee zero collisions for all inputs.
    """
    return 1


def repair_witness(seed: str, group) -> tuple[int, int]:
    """Return distinct i,j in 0..64 whose trial messages collide in truncated_nonce.

    Use secret=1 and messages f"trial-{i}".encode(); the supplied weak generator
    takes (seed, secret, message, group). Different seeds may need different pairs.
    A constant pair is not a general regression witness.
    """
    return (0, 0)
