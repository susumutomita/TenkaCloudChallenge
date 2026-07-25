"""Reference solution. Inside the image only; never mounted to the host."""

from __future__ import annotations


def share(secret: int, n: int, p: int, randomness: list[int]) -> list[int]:
    head = [r % p for r in randomness[: n - 1]]
    return [*head, (secret - sum(head)) % p]


def reconstruct(shares: list[int], p: int) -> int:
    return sum(shares) % p


def complete_shares(partial: list[int], secret: int, p: int) -> int:
    return (secret - sum(partial)) % p


def rerandomize(shares: list[int], p: int, randomness: list[int]) -> list[int]:
    # Add a zero-sharing: the offsets sum to 0, so the secret is unchanged while
    # every individual share moves.
    offsets = [r % p for r in randomness[: len(shares) - 1]]
    offsets.append((-sum(offsets)) % p)
    return [(s + o) % p for s, o in zip(shares, offsets)]
