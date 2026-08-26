"""Vectors to commit to, the queries a verifier makes, and the broken protocol variants.

The commitment is a Merkle tree over a small vector. That is not a polynomial commitment
and this problem does not pretend otherwise -- what it isolates is the ORDER
(commit, then challenge, then open) and what has to be bound into the commitment for the
order to mean anything.

`PROTOCOLS` are four ways to run the same three steps. One is honest. The others each
break the order or the binding, and the point of the problem is that all four produce a
transcript that verifies against a naive verifier.

  honest          commit, then challenge, then open
  challenge-first the prover learns the query before committing
  no-index        the leaf hash does not bind its position
  no-direction    the opening does not say which side each sibling is on

Toy sizes throughout. SHA-256 is real, but nothing here is a proof system: there is one
query, so a cheating prover who guesses it wins outright.
"""

from __future__ import annotations

import hashlib

PROTOCOLS = ("honest", "challenge-first", "no-index", "no-direction")

LEAF_TAG = b"leaf/v1"
NODE_TAG = b"node/v1"
DOMAIN = "tenkacloud/ac26/commit-open/v1"


def _stream(seed: str, label: str) -> list[int]:
    out: list[int] = []
    counter = 0
    while len(out) < 96:
        out.extend(hashlib.sha256(f"{seed}:{label}:{counter}".encode()).digest())
        counter += 1
    return out


def _pick(s: list[int], i: int, low: int, high: int) -> int:
    return low + ((s[i % 90] * 256 + s[(i + 1) % 90]) % (high - low + 1))


def setting(seed: str, label: str = "public") -> dict:
    s = _stream(seed, f"setting:{label}")
    # A power of two, so every level pairs cleanly and the odd-leaf rule never applies.
    # Ragged trees are a separate lesson; conflating them here would hide this one.
    length = 1 << _pick(s, 0, 2, 4)
    return {
        "length": length,
        "values": [_pick(s, 2 * i + 4, 0, 9999) for i in range(length)],
        "query": _pick(s, 40, 0, length - 1),
        "domain": DOMAIN,
    }


def leaf_hash(index: int, value: int) -> bytes:
    """The leaf commitment, binding the POSITION as well as the value.

    Without the index, a leaf is just a hash of a number: the prover can present it as
    having come from wherever is convenient, and the verifier has no way to object.
    """
    return hashlib.sha256(
        LEAF_TAG + index.to_bytes(4, "big") + value.to_bytes(8, "big")
    ).digest()


def node_hash(left: bytes, right: bytes) -> bytes:
    return hashlib.sha256(NODE_TAG + left + right).digest()


def build_tree(values: list[int]) -> list[list[bytes]]:
    """Levels, leaves first. The length is a power of two, so no level is ragged."""
    level = [leaf_hash(index, value) for index, value in enumerate(values)]
    levels = [level]
    while len(level) > 1:
        level = [node_hash(level[i], level[i + 1]) for i in range(0, len(level), 2)]
        levels.append(level)
    return levels


def root_of(values: list[int]) -> bytes:
    return build_tree(values)[-1][0]


def opening_for(values: list[int], index: int) -> list[dict]:
    """The authentication path: each sibling, and which SIDE it is on.

    Direction is not decoration. Without it the verifier does not know whether to hash
    (sibling, node) or (node, sibling), and a prover can pick whichever order produces
    the root they need.
    """
    levels = build_tree(values)
    path: list[dict] = []
    position = index
    for level in levels[:-1]:
        sibling = position ^ 1
        path.append({"hash": level[sibling], "sibling_is_left": sibling < position})
        position //= 2
    return path


def weak_leaf(index: int, value: int) -> bytes:
    """A leaf encoding with no separators: the two fields run together.

    Fixed here rather than written by the learner, so the ambiguity counterexample has to
    work against a stated weakness rather than against their own deliberately bad code.
    `(1, 23)` and `(12, 3)` both render as "123" and therefore commit to the same leaf.
    """
    return hashlib.sha256(f"{index}{value}".encode()).digest()


def health_token(seed: str) -> str:
    cfg = setting(seed)
    return hashlib.sha256(f"health:{seed}:{cfg['length']}".encode()).hexdigest()[:16]


def public_payload(seed: str) -> dict[str, object]:
    """Everything a participant may see for this deployment. Contains no answer.

    The single source `show.py`, `verifier/server.py`'s `GET /public`, and
    `tests/public/test_commit.py` all build their payload from. What is deliberately
    absent is `node_hash` (and every other function this module defines) itself --
    Issue 537/538's stub-vs-implementation finding is that the starter's `node_hash`
    stub shares its name with this module's complete Merkle node-combining function, so
    handing this module to a learner's own container handed over a working
    implementation for the price of one import. This payload carries only the VALUES
    `build_tree`/`root_of`/`opening_for` produce -- the vector, the query, the leaf
    hashes, the root, and the opening path for the query index -- never the functions
    that derive them. None of those values is a checkpoint's answer either: the root
    and the opening path are exactly what `show.py` has always printed, and a learner
    is graded on whether their own code reproduces them, not on knowing them.

    Issue 543 option B2: `fixtures/` -- this module -- does not ship in the participant
    Docker stage at all (see ../Dockerfile). `participant/server.py`, `show.py` and the
    public tests fetch this payload from the verifier at runtime instead of importing
    it directly.
    """
    cfg = setting(seed)
    values = list(cfg["values"])
    levels = build_tree(values)
    opening = opening_for(values, cfg["query"])
    return {
        "setting": {
            "length": cfg["length"],
            "values": values,
            "query": cfg["query"],
            "domain": cfg["domain"],
        },
        "leafHashesHex": [leaf.hex() for leaf in levels[0]],
        "rootHex": root_of(values).hex(),
        "treeLevels": len(levels),
        "openingForQuery": [
            {"hashHex": entry["hash"].hex(), "siblingIsLeft": entry["sibling_is_left"]}
            for entry in opening
        ],
        "healthToken": health_token(seed),
    }
