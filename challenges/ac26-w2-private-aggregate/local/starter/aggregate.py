"""The only file you edit.

Several organizations hold an incident count and a severity each. Nobody will share
either. Everyone wants

    score = sum_i (count_i * severity_i) + bias        (bias public, mod p)

and nothing else.

Both factors of every product are secret, so each term is the one operation that cannot
be done locally. You have the pieces already: masking, one opening, a linear
recombination, and a preprocessed triple per multiplication.

The only way to reveal anything is `io.open_batch([...])`, which reveals every sharing
you hand it and counts as ONE round. How you group your openings is a cost decision, and
it is measured, not asked about.

    io.open_batch([sharing_a, sharing_b])   -> [value_a, value_b]      1 round
    io.open_batch([sharing_a])
    io.open_batch([sharing_b])              -> same values             2 rounds
"""

from __future__ import annotations


def plan(spec: dict) -> dict:
    """Your cost estimate, before you write the protocol.

    Return {"multiplications": ..., "triples": ..., "rounds": ...}.

    Two of those three are the same number. The third is not, and working out which is
    the point of doing this before you implement rather than after.
    """
    return {"multiplications": 0, "triples": 0, "rounds": 0}


def share_inputs(secrets: list[int], randoms: list[list[int]], p: int) -> list[list[int]]:
    """Split each secret into one share per party.

    `randoms[i]` gives you the first n-1 share values for `secrets[i]`; you choose the
    last one. Every share must be a canonical field element.
    """
    return []


def add_public(shares: list[int], constant: int, p: int) -> list[int]:
    """Shares of (the shared value + a public constant).

    You have done this one before. It is still the one that is not the obvious thing.
    """
    return list(shares)


def aggregate(counts, severities, triple_list, spec, io) -> list[int]:
    """Shares of the score. Return the sharing; do not open it.

    `counts[i]` and `severities[i]` are sharings of organization i's two figures.
    `triple_list[i]` is {"a": [...], "b": [...], "c": [...]} with c = a*b, shared out.

    Nothing except the masked differences may be revealed. The final score is opened by
    the harness, from what you return.
    """
    return [0] * spec["parties"]
