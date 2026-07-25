"""Reference solution. Inside the image only; never mounted to the host."""

from __future__ import annotations

import hashlib

LEAF_TAG = b"leaf/v1"
NODE_TAG = b"node/v1"


class ProtocolError(Exception):
    """Raised when the three steps are taken out of order."""


def encode_leaf(index: int, value: int) -> bytes:
    """Fixed-width fields and a tag, so one byte string means one (index, value).

    Binding the index is what stops a prover presenting a leaf as having come from
    wherever is convenient. Fixed widths are what stop two different pairs rendering to
    the same bytes.
    """
    return LEAF_TAG + index.to_bytes(4, "big") + value.to_bytes(8, "big")


def leaf_hash(index: int, value: int) -> bytes:
    return hashlib.sha256(encode_leaf(index, value)).digest()


def node_hash(left: bytes, right: bytes) -> bytes:
    return hashlib.sha256(NODE_TAG + left + right).digest()


def merkle_root(values: list[int]) -> bytes:
    level = [leaf_hash(index, value) for index, value in enumerate(values)]
    while len(level) > 1:
        level = [node_hash(level[i], level[i + 1]) for i in range(0, len(level), 2)]
    return level[0]


def open_at(values: list[int], index: int) -> list[dict]:
    """The authentication path, each step carrying which side its sibling is on."""
    if not 0 <= index < len(values):
        raise ProtocolError("the query index is outside the vector")
    level = [leaf_hash(position, value) for position, value in enumerate(values)]
    path: list[dict] = []
    position = index
    while len(level) > 1:
        sibling = position ^ 1
        path.append({"hash": level[sibling], "sibling_is_left": sibling < position})
        level = [node_hash(level[i], level[i + 1]) for i in range(0, len(level), 2)]
        position //= 2
    return path


def verify_opening(root: bytes, index: int, value: int, path: list[dict], length: int) -> bool:
    """Recompute the root from the claimed leaf, and refuse anything that does not fit.

    The index-range and path-length checks here are defence in depth rather than the
    thing that makes this sound. What actually prevents presenting an interior node as a
    leaf is the domain tags: LEAF_TAG and NODE_TAG mean a leaf hash can never equal a
    node hash, so a path of the wrong length recomputes to something that is not the
    root and is rejected by the comparison anyway. Removing either check is an
    equivalent mutation, which is why neither appears in the mutation suite -- a mutant
    that cannot be killed teaches authors to ignore the suite.

    The range check that IS load-bearing is the one in `Session.receive_challenge`:
    without it a negative index silently wraps and the prover opens a different row than
    the one that was asked about.
    """
    if not isinstance(index, int) or not 0 <= index < length:
        return False
    if not isinstance(path, list) or len(path) != max(length - 1, 1).bit_length():
        return False
    node = leaf_hash(index, value)
    for step in path:
        if not isinstance(step, dict) or "hash" not in step or "sibling_is_left" not in step:
            return False
        sibling = step["hash"]
        if not isinstance(sibling, bytes) or len(sibling) != 32:
            return False
        node = node_hash(sibling, node) if step["sibling_is_left"] else node_hash(node, sibling)
    return node == root


def transcript(domain: str, root: bytes, statement: bytes) -> bytes:
    """What the challenge is derived from. Length-prefixed, so the fields cannot merge."""
    domain_bytes = domain.encode("utf-8")
    return b"".join(
        [
            len(domain_bytes).to_bytes(4, "big"),
            domain_bytes,
            len(statement).to_bytes(4, "big"),
            statement,
            root,
        ]
    )


def challenge(domain: str, root: bytes, statement: bytes, length: int) -> int:
    """The query index, derived from the transcript rather than chosen by a verifier.

    The root has to be in here. A challenge that does not depend on the commitment is a
    challenge the prover knew before committing, which is the whole thing this problem
    is about.
    """
    digest = hashlib.sha256(transcript(domain, root, statement)).digest()
    return int.from_bytes(digest, "big") % length


class Session:
    """The order, enforced. commit, then challenge, then open, and not otherwise."""

    def __init__(self, values: list[int]) -> None:
        self.values = list(values)
        self.phase = "start"
        self.root: bytes | None = None
        self.query: int | None = None

    def commit(self) -> bytes:
        if self.phase != "start":
            raise ProtocolError("already committed")
        self.root = merkle_root(self.values)
        self.phase = "committed"
        return self.root

    def receive_challenge(self, index: int) -> None:
        if self.phase != "committed":
            raise ProtocolError("a challenge before a commitment is not a challenge")
        if not 0 <= index < len(self.values):
            raise ProtocolError("the query index is outside the vector")
        self.query = index
        self.phase = "challenged"

    def open(self) -> dict:
        if self.phase != "challenged":
            raise ProtocolError("nothing has been asked yet")
        self.phase = "opened"
        return {
            "index": self.query,
            "value": self.values[self.query],
            "path": open_at(self.values, self.query),
        }


def adaptive_witness(setting: dict) -> dict:
    """What a prover can do when the query arrives first.

    Commit to a vector that is wrong at every position except the one you already know
    you will be asked about. The opening verifies. The commitment is to garbage.
    """
    honest = list(setting["values"])
    query = setting["query"]
    forged = [(value + 1) % 10_000 for value in honest]
    forged[query] = honest[query]
    return {"values": forged, "query": query}


def ambiguity_witness() -> dict:
    """Two different (index, value) pairs that the separator-free encoding cannot tell
    apart. `(1, 23)` and `(12, 3)` both render as "123"."""
    return {"first": (1, 23), "second": (12, 3)}
