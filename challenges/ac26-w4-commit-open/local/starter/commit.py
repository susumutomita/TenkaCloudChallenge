"""The only file you edit.

Three steps, in this order:

    1. the prover commits to data
    2. the verifier chooses what to ask about
    3. the prover opens that part

Swap steps 1 and 2 and the protocol proves nothing — the prover can commit to garbage
everywhere except the one place they already know will be checked. You will build the
honest version, demonstrate that attack, and finally show — against the problem
setter's own four verifiers — which missing detail lets a forged claim through.

The commitment is a Merkle tree over a small vector. **It is not a polynomial
commitment**, and one opening does not say anything about the rows nobody asked about.

Two things have to be bound into a leaf or the ordering does not help:

  * its **index** — otherwise a leaf can be presented as coming from anywhere;
  * unambiguous **field boundaries** — otherwise two different (index, value) pairs
    encode to the same bytes.

And an opening has to say which **side** each sibling is on, or the verifier does not
know whether to hash (sibling, node) or (node, sibling).
"""

from __future__ import annotations

import hashlib


class ProtocolError(Exception):
    """Raised when the three steps are taken out of order."""


def encode_leaf(index: int, value: int) -> bytes:
    """The bytes a leaf commits to. Two different pairs must never produce the same."""
    return b""


def leaf_hash(index: int, value: int) -> bytes:
    return hashlib.sha256(encode_leaf(index, value)).digest()


def node_hash(left: bytes, right: bytes) -> bytes:
    """Combine two children. Order matters here too."""
    return b""


def merkle_root(values: list[int]) -> bytes:
    """The commitment. The vector length is a power of two."""
    return b""


def open_at(values: list[int], index: int) -> list[dict]:
    """The authentication path: [{"hash": bytes, "sibling_is_left": bool}, ...]."""
    return []


def verify_opening(root: bytes, index: int, value: int, path: list[dict], length: int) -> bool:
    """Recompute the root from the claimed leaf.

    Think about what an unchecked path length lets a prover do.
    """
    return False


def transcript(domain: str, root: bytes, statement: bytes) -> bytes:
    """The bytes the non-interactive challenge is derived from."""
    return b""


def challenge(domain: str, root: bytes, statement: bytes, length: int) -> int:
    """The query index, derived rather than received.

    One of the inputs is the reason this is not just "hash something". Work out which.
    """
    return 0


class Session:
    """The order, enforced: commit, then challenge, then open, and not otherwise."""

    def __init__(self, values: list[int]) -> None:
        self.values = list(values)

    def commit(self) -> bytes:
        return b""

    def receive_challenge(self, index: int) -> None:
        return None

    def open(self) -> dict:
        """{"index", "value", "path"}."""
        return {}


def adaptive_witness(setting: dict) -> dict:
    """What a prover can do when the query arrives before the commitment.

    Return {"values", "query"}: a vector you commit to that is wrong nearly everywhere
    and still opens correctly at `query`.
    """
    return {}


def ambiguity_witness() -> dict:
    """Two different (index, value) pairs that `fixtures.generate.weak_leaf` cannot tell
    apart, while your own encoding can. Return {"first", "second"}."""
    return {}


def lenient_opening(setting: dict) -> dict | None:
    """The last checkpoint: the setter's four verifiers, A to D (the statement's table).

    `setting` is {"scheme": "A", "length": 16, "values": [...]} -- one letter, and the
    honest table that scheme's tree commits to. Return an opening
    {"index": ..., "value": ..., "path": [...]} that the scheme's verifier accepts for a
    claim that is NOT in the table, or None if that verifier accepts no such claim. All
    four answers have to be right at once. You will want a copy of `open_at` with its
    leaf line swapped for that scheme's leaf.
    """
    return None
