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


def share_line(secret: int, p: int, randomness: list[int]) -> list[list[int]]:
    # The line y = secret + r*x over F_p. Party x holds the point at x = 1, 2, 3; the
    # secret is the value at x = 0, which nobody holds.
    r = randomness[0] % p
    return [[x, (secret + r * x) % p] for x in (1, 2, 3)]


def _partner(d: int, p: int) -> int:
    """The number that multiplies d to 1 mod p, by the trial search the statement gives.

    `pow(d, -1, p)` would do, but this problem sits before ac26-w3-field-inverse, so the
    reference follows the route the statement offers -- and shows it is fast enough on
    the ~10^4 moduli of the hidden cases (at most p steps per reconstruction).
    """
    for k in range(1, p):
        if (d * k) % p == 1:
            return k
    raise ValueError("no partner: the modulus is not prime or the divisor is 0")


def reconstruct_line(two_points: list[list[int]], p: int) -> int:
    x1, y1 = two_points[0]
    x2, y2 = two_points[1]
    slope = ((y2 - y1) % p) * _partner((x2 - x1) % p, p) % p
    return (y1 - slope * x1) % p
