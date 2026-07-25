"""Reference solution. Inside the image only; never mounted to the host."""

from __future__ import annotations


def plan(spec: dict) -> dict:
    k = spec["parties"]
    # One multiplication per organization, one triple each -- but the openings are
    # independent, so they batch into a single round.
    return {"multiplications": k, "triples": k, "rounds": 1}


def share_inputs(secrets: list[int], randoms: list[int], p: int) -> list[list[int]]:
    out = []
    for index, secret in enumerate(secrets):
        head = [value % p for value in randoms[index]]
        out.append([*head, (secret - sum(head)) % p])
    return out


def add_public(shares: list[int], constant: int, p: int) -> list[int]:
    # Exactly one party folds a public constant in; adding it everywhere would give
    # a sharing of x + n*c.
    out = [share % p for share in shares]
    out[0] = (out[0] + constant) % p
    return out


def aggregate(counts, severities, triple_list, spec, io) -> list[int]:
    p, k = spec["p"], spec["parties"]

    # Every d and e for every product, masked locally first.
    to_open = []
    for index in range(k):
        triple = triple_list[index]
        to_open.append([(x - a) % p for x, a in zip(counts[index], triple["a"])])
        to_open.append([(y - b) % p for y, b in zip(severities[index], triple["b"])])

    # One round for all of them. This is the whole point of the batch.
    opened = io.open_batch(to_open)

    total = [0] * k
    for index in range(k):
        triple = triple_list[index]
        d, e = opened[2 * index], opened[2 * index + 1]
        product = [
            (c + d * b + e * a) % p
            for c, a, b in zip(triple["c"], triple["a"], triple["b"])
        ]
        product[0] = (product[0] + d * e) % p
        total = [(t + q) % p for t, q in zip(total, product)]

    return add_public(total, spec["bias"], p)
