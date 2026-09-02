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


# --- the last checkpoint: the setter's four lenient schemes -------------------------

#: The three schemes that accept a claim outside the honest table. A leaf that does
#: not name its position (A) can be presented at any other position with its own path,
#: as long as the verifier lets the path say which side each sibling is on. The
#: separator-free leaf (B) additionally lets a different (index, value) pair render to
#: the same text. Binding the index into the leaf (C) or deriving the sides from the
#: index (D) each closes the relabelling on its own: the leaf's position is then part
#: of what the root commits to, and a claim at another position recomputes to
#: something else. E derives the sides like D but has no domain tags and no fixed
#: width, so a value whose bytes are exactly (left child + right child) hashes to an
#: interior node, and that node can be presented as a leaf with a shorter path.
FORGEABLE_SCHEMES = ("A", "B", "E")


def _scheme_leaf(scheme: str, index: int, value: int) -> bytes:
    if scheme == "B":
        return hashlib.sha256(f"{index}{value}".encode()).digest()
    if scheme == "C":
        return leaf_hash(index, value)
    if scheme == "E":
        width = max(1, (value.bit_length() + 7) // 8)
        return hashlib.sha256(value.to_bytes(width, "big")).digest()
    return hashlib.sha256(LEAF_TAG + value.to_bytes(8, "big")).digest()


def _scheme_node(scheme: str, left: bytes, right: bytes) -> bytes:
    if scheme == "E":
        return hashlib.sha256(left + right).digest()
    return node_hash(left, right)


def _scheme_levels(scheme: str, values: list[int]) -> list[list[bytes]]:
    level = [_scheme_leaf(scheme, position, value) for position, value in enumerate(values)]
    levels = [level]
    while len(level) > 1:
        level = [_scheme_node(scheme, level[i], level[i + 1]) for i in range(0, len(level), 2)]
        levels.append(level)
    return levels


def _scheme_open_at(scheme: str, values: list[int], index: int) -> list[dict]:
    """`open_at` with the scheme's leaf and node swapped in."""
    path: list[dict] = []
    position = index
    for level in _scheme_levels(scheme, values)[:-1]:
        sibling = position ^ 1
        path.append({"hash": level[sibling], "sibling_is_left": sibling < position})
        position //= 2
    return path


def _node_as_leaf(values: list[int], length: int) -> dict | None:
    """Scheme E: an interior node presented as a leaf, with the path above it.

    The node over positions (2p, 2p+1) is sha256(left + right). A value whose bytes are
    exactly those 64 bytes has the same leaf hash, so the honest path of position 2p
    minus its first step climbs from that node to the root. The verifier derives the
    sides from the claimed index, so the index has to share its low bits with p.
    """
    levels = _scheme_levels("E", values)
    for pair in range(len(levels[0]) // 2):
        left, right = levels[0][2 * pair], levels[0][2 * pair + 1]
        if left[0] == 0:
            continue  # a leading zero byte would be dropped by the minimal encoding
        value = int.from_bytes(left + right, "big")
        for index in (pair, pair + len(levels[0]) // 2):
            if index < length and values[index] != value:
                return {
                    "index": index,
                    "value": value,
                    "path": _scheme_open_at("E", values, 2 * pair)[1:],
                }
    return None


def _split_claims(index: int, value: int):
    """Every other canonical (index, value) pair that renders to the same digits."""
    text = f"{index}{value}"
    for cut in range(1, len(text)):
        head, tail = text[:cut], text[cut:]
        other_index, other_value = int(head), int(tail)
        if str(other_index) != head or str(other_value) != tail:
            continue  # a leading zero: this split does not render back to the same text
        if (other_index, other_value) != (index, value):
            yield other_index, other_value


def lenient_opening(setting: dict) -> dict | None:
    """A claim outside the table that the scheme's verifier accepts, or None if none exists.

    A: the leaf does not know its position and the verifier trusts the path's sides, so
    position j's value with position j's own path is accepted as a claim about any
    other index. B: the same relabelling, except that the claimed pair has to render to
    the same text as a real entry. E: an interior node presented as a leaf. C and D:
    sound -- see FORGEABLE_SCHEMES.
    """
    scheme, length, values = setting["scheme"], setting["length"], list(setting["values"])
    if scheme not in FORGEABLE_SCHEMES:
        return None
    if scheme == "E":
        return _node_as_leaf(values, length)
    for position, value in enumerate(values):
        path = _scheme_open_at(scheme, values, position)
        if scheme == "A":
            claims = ((index, value) for index in range(length) if index != position)
        else:
            claims = _split_claims(position, value)
        for index, claimed in claims:
            if 0 <= index < length and values[index] != claimed:
                return {"index": index, "value": claimed, "path": path}
    return None
