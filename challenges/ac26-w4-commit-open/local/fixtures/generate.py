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

The `lenient` checkpoint attacks the problem setter's own verifiers instead: five
commitment schemes (`SCHEMES`) that all accept every honest opening and differ only in
the leaf, the node, and how the verifier decides which side a sibling is on. Which of them admit
a forged claim is the participant's question; this module answers it only in code
(`FORGEABLE_SCHEMES`), and mutation.py confirms the reference forges exactly those.
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


# --- the four lenient schemes the `lenient` checkpoint attacks -----------------------

#: The setter's five commitment schemes, as the statement describes them. Every one of
#: them accepts every honest opening of its own tree. They differ in the leaf, in the
#: node, and in how the verifier decides which side a sibling is on:
#:
#:   A  leaf = sha256(LEAF_TAG + value as 8 bytes)      -- no index in the leaf;
#:      the verifier takes each sibling's side from the path
#:   B  leaf = sha256(str(index) + str(value))          -- `weak_leaf`, no separator;
#:      the verifier takes each sibling's side from the path
#:   C  leaf = the honest leaf (index bound, fixed widths);
#:      the verifier takes each sibling's side from the path
#:   D  leaf = as A (no index in the leaf);
#:      the verifier ignores the path's side flags and derives the side from the index
#:   E  leaf = sha256(the value in as few bytes as it needs), node = sha256(left + right)
#:      -- no index, no tags, no fixed width; sides derived from the index as in D
#:
#: Nodes are the honest `node_hash` in A-D. No scheme checks the path length, and
#: every scheme checks only that the index is inside the vector (E also bounds the
#: value to 64 bytes).
SCHEMES = ("A", "B", "C", "D", "E")
#: The schemes that accept a claim outside the honest table. A leaf that does not name
#: its position can be presented at another position with its own path as long as the
#: verifier lets the path say which side each sibling is on (A); the separator-free
#: leaf lets a different (index, value) pair render to the same text (B). Binding the
#: index into the leaf (C) or deriving the sides from the index (D) each closes the
#: relabelling on its own: the leaf's own position is then part of what the root
#: commits to, and a claim at another position recomputes to something else. E closes
#: the relabelling like D but drops the domain tags and the fixed width, so a value
#: whose bytes are exactly (left child + right child) hashes to an interior node: that
#: node can be presented as a leaf with a shorter path, which is what the unchecked
#: path length lets through once the tags are gone.
FORGEABLE_SCHEMES = ("A", "B", "E")
#: Cells in the table the lenient schemes commit to. Sixteen, so scheme B always has a
#: forgery: an entry at index 10..15 re-reads as index 1 followed by a longer value.
LENIENT_LENGTH = 16
#: Values in a claim must fit the eight-byte leaf field of schemes A, C and D.
MAX_LEAF_VALUE = 1 << 64
#: Scheme E encodes the value in as few bytes as it needs; a claim may use up to 64.
MAX_UNTAGGED_VALUE = 1 << 512


def lenient_setting(seed: str, label: str = "public") -> dict:
    """The honest table the lenient schemes commit to. Sixteen distinct cells, always.

    Distinct, as the statement promises: scheme A's forgery presents one cell's value
    at another index, which is a claim outside the table only if the two cells differ.
    """
    s = _stream(seed, f"lenient:{label}")
    values: list[int] = []
    for i in range(LENIENT_LENGTH):
        value = _pick(s, 2 * i + 4, 0, 9999)
        while value in values:
            value = (value + 1) % 10_000
        values.append(value)
    return {"length": LENIENT_LENGTH, "values": values}


def scheme_leaf(scheme: str, index: int, value: int) -> bytes:
    if scheme == "B":
        return weak_leaf(index, value)
    if scheme == "C":
        return leaf_hash(index, value)
    if scheme == "E":
        # No tag, no index, and only as many bytes as the value needs (one for zero).
        width = max(1, (value.bit_length() + 7) // 8)
        return hashlib.sha256(value.to_bytes(width, "big")).digest()
    # A and D: the leaf does not name its position.
    return hashlib.sha256(LEAF_TAG + value.to_bytes(8, "big")).digest()


def scheme_node(scheme: str, left: bytes, right: bytes) -> bytes:
    if scheme == "E":
        return hashlib.sha256(left + right).digest()
    return node_hash(left, right)


def scheme_levels(scheme: str, values: list[int]) -> list[list[bytes]]:
    level = [scheme_leaf(scheme, index, value) for index, value in enumerate(values)]
    levels = [level]
    while len(level) > 1:
        level = [scheme_node(scheme, level[i], level[i + 1]) for i in range(0, len(level), 2)]
        levels.append(level)
    return levels


def scheme_root(scheme: str, values: list[int]) -> bytes:
    return scheme_levels(scheme, values)[-1][0]


def scheme_opening(scheme: str, values: list[int], index: int) -> list[dict]:
    """The honest opening of `index` under `scheme`, in the same shape as `opening_for`."""
    path: list[dict] = []
    position = index
    for level in scheme_levels(scheme, values)[:-1]:
        sibling = position ^ 1
        path.append({"hash": level[sibling], "sibling_is_left": sibling < position})
        position //= 2
    return path


def lenient_verify(
    scheme: str, root: bytes, index: object, value: object, path: object, length: int
) -> bool:
    """The setter's verifier for one scheme.

    Accepts every honest opening of that scheme's tree. Checks the index range and the
    value's width, then walks the path and compares with the root; the path length is
    not checked. Schemes A, B and C place each sibling where the path says; schemes D
    and E ignore the path's flag and place it by the index's bit for that level.
    """
    if scheme not in SCHEMES:
        return False
    if type(index) is not int or not 0 <= index < length:
        return False
    limit = MAX_UNTAGGED_VALUE if scheme == "E" else MAX_LEAF_VALUE
    if type(value) is not int or not 0 <= value < limit:
        return False
    if not isinstance(path, list):
        return False
    node = scheme_leaf(scheme, index, value)
    position = index
    for step in path:
        if not isinstance(step, dict):
            return False
        sibling = step.get("hash")
        if not isinstance(sibling, bytes) or len(sibling) != 32:
            return False
        if scheme in ("D", "E"):
            sibling_is_left = position % 2 == 1
        else:
            sibling_is_left = bool(step.get("sibling_is_left"))
        node = scheme_node(scheme, sibling, node) if sibling_is_left else scheme_node(scheme, node, sibling)
        position //= 2
    return node == root


def lenient_claim_report(
    seed: str, scheme: str, index: object, value: object, path: object
) -> dict[str, object]:
    """What `GET /public`'s companion `POST /public/lenient` answers for one claim.

    Evaluated on the PUBLIC lenient table only -- the one the participant can see -- so
    the public tests can show whether an attempted forgery gets through a scheme's
    verifier, without touching the hidden tables the checkpoint is graded on.
    """
    cfg = lenient_setting(seed)
    values, length = list(cfg["values"]), cfg["length"]
    if scheme not in SCHEMES:
        return {"ok": False, "error": "unknown scheme"}
    accepted = lenient_verify(scheme, scheme_root(scheme, values), index, value, path, length)
    in_table = type(index) is int and 0 <= index < length and values[index] == value
    return {"ok": True, "scheme": scheme, "accepted": accepted, "inTable": in_table}


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
        # The table the five lenient schemes commit to, for the last checkpoint. Only the
        # values: the scheme roots are recomputed by the verifier when asked.
        "lenientLength": LENIENT_LENGTH,
        "lenientValues": list(lenient_setting(seed)["values"]),
    }
