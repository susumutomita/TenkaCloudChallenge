"""Reference implementation. Added only to the author image."""

from __future__ import annotations


def and_shared_bits(x_shares, y_shares, masks, ot_secrets):
    """Two local products plus two OT-split cross terms."""
    if len(x_shares) != 2 or len(y_shares) != 2 or len(masks) != 2:
        raise ValueError("this gate has exactly two parties and two OT masks")

    x0 = ot_secrets.local(x_shares, 0)
    y0 = ot_secrets.local(y_shares, 0)
    x1 = ot_secrets.local(x_shares, 1)
    y1 = ot_secrets.local(y_shares, 1)
    r01 = ot_secrets.local(masks, 0)
    r10 = ot_secrets.local(masks, 1)

    cross_01_for_party_1 = ot_secrets.transfer(
        0, 0, 1, (r01, r01 ^ x0), y1
    )
    cross_10_for_party_0 = ot_secrets.transfer(
        1, 1, 0, (r10, r10 ^ x1), y0
    )

    z0 = (x0 & y0) ^ r01 ^ cross_10_for_party_0
    z1 = (x1 & y1) ^ cross_01_for_party_1 ^ r10
    return (z0, z1)
