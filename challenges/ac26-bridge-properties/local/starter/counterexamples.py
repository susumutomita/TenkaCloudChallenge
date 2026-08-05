"""The other file you edit. A label you cannot demonstrate does not count.

Each function receives the PUBLIC statement only (no witness) and must return a
concrete value that makes the claimed failure actually happen when fed to the
protocol. The verifier runs what you return; it does not take your word for it.
"""

from __future__ import annotations


def incompleteness_witness(statement: dict[str, int]) -> int:
    """A witness that is genuinely valid, yet the incomplete verifier rejects.

    "Valid" means: it satisfies a*w + b == c (mod p) AND lo <= w <= hi.
    Return the integer w. The starter returns a value that is not even valid.
    """
    return 0


def unsoundness_witness(statement: dict[str, int]) -> int:
    """A witness OUTSIDE [lo, hi] that the unsound verifier nevertheless accepts.

    Accepting it means the verifier has not proved the in-range half of the statement.
    Return the integer w. The starter returns an in-range value, which proves nothing.
    """
    return statement["lo"]


def extract_witness(transcript: dict) -> int:
    """Recover the witness from the leaky verifier's transcript.

    You are given only the transcript an observer would see. Return the integer w.
    """
    return 0
