"""The only file you edit.

Additive secret sharing over F_p: split a secret into n shares that sum back to it.
The arithmetic is a few lines. The reason it is worth anything is subtler, and the
checkpoints are about that reason rather than the arithmetic.
"""

from __future__ import annotations


def share(secret: int, n: int, p: int, randomness: list[int]) -> list[int]:
    """Split `secret` into `n` shares over F_p, summing to `secret` mod p.

    `randomness` supplies at least n-1 field elements; use them so the split is
    reproducible. The starter returns something that sums to the secret in exactly
    one uninteresting way.
    """
    return [secret] + [0] * (n - 1)


def reconstruct(shares: list[int], p: int) -> int:
    """Recover the secret from the full set of shares."""
    return 0


def complete_shares(partial: list[int], secret: int, p: int) -> int:
    """Given n-1 shares and any target secret, return the missing share.

    This is the checkpoint that shows n-1 shares reveal nothing: whatever the secret
    is, some value of the last share is consistent with what you already hold. If you
    can always produce it, the partial set cannot be evidence about the secret.
    """
    return 0


def rerandomize(shares: list[int], p: int, randomness: list[int]) -> list[int]:
    """Return a fresh sharing of the SAME secret, with every share different.

    Used in real protocols so a set of shares cannot be linked across rounds.
    """
    return list(shares)
