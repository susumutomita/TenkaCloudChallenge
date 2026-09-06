"""Participant implementation derived from the statement, hints and starter.

Each list position is one party. Only open_value joins the values. The one
public term d*e is assigned to party 0, so it enters the reconstructed sum once.
"""


def mask(value_shares: list[int], mask_shares: list[int], p: int) -> list[int]:
    result = []
    for party in range(len(value_shares)):
        result.append((value_shares[party] - mask_shares[party]) % p)
    return result


def open_value(shares: list[int], p: int) -> int:
    total = 0
    for share in shares:
        total += share
    return total % p


def combine(
    c_shares: list[int],
    a_shares: list[int],
    b_shares: list[int],
    d: int,
    e: int,
    p: int,
) -> list[int]:
    result = []
    for party in range(len(c_shares)):
        row = c_shares[party] + d * b_shares[party] + e * a_shares[party]
        if party == 0:
            row += d * e
        result.append(row % p)
    return result


def rounds() -> int:
    # d does not depend on e or vice versa: both are opened in one batch.
    return 1
