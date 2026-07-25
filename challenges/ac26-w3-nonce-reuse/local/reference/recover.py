"""Reference solution. Inside the image only; never mounted to the host."""

from __future__ import annotations

import hashlib


class MalformedRecord(Exception):
    """Raised for a log record that is not a well-formed transcript."""


def parse_record(record, group):
    """Normalize one audit-log record, or raise if it is not one.

    An audit log is data from outside. A parser that trusts it is the reason the first
    malformed row takes the whole analysis down.
    """
    if not isinstance(record, dict):
        raise MalformedRecord("a record must be a mapping")
    for key in ("message", "public_key", "commitment", "response"):
        if key not in record:
            raise MalformedRecord(f"a record is missing {key}")
    message = record["message"]
    if not isinstance(message, bytes):
        raise MalformedRecord("the message is not bytes")
    public = _point(record["public_key"], group)
    commitment = _point(record["commitment"], group)
    response = record["response"]
    if not isinstance(response, int) or isinstance(response, bool) or not 0 <= response < group.n:
        raise MalformedRecord("the response is not a canonical scalar")
    return {
        "message": message,
        "public_key": public,
        "commitment": commitment,
        "response": response,
    }


def _point(value, group):
    if not isinstance(value, (tuple, list)) or len(value) != 2:
        raise MalformedRecord("a point is a pair of coordinates")
    x, y = value
    if not isinstance(x, int) or not isinstance(y, int):
        raise MalformedRecord("a coordinate is not an integer")
    if not 0 <= x < group.p or not 0 <= y < group.p:
        raise MalformedRecord("a coordinate is not reduced")
    point = group.point(x, y)
    if not group.contains(point) or point.is_infinity:
        raise MalformedRecord("the point is not a usable group element")
    return point


def accepts(parsed, group) -> bool:
    """Whether this record is an accepting transcript. Reuse in a rejected transcript
    proves nothing, so this has to be checked before the pair is attacked."""
    from fixtures.generate import DOMAINS, challenge

    e = challenge(DOMAINS[0], parsed["commitment"], parsed["public_key"], parsed["message"], group)
    left = group.generator.scalar_mul(parsed["response"])
    right = parsed["commitment"] + parsed["public_key"].scalar_mul(e)
    return left == right


def find_reuse(records, group) -> list[tuple[int, int]]:
    """Index pairs sharing a commitment AND a public key, both accepting.

    Same commitment under two different keys is a coincidence, not a reuse: there is no
    single x to solve for. Malformed rows are skipped rather than fatal.
    """
    parsed: dict[int, dict] = {}
    for index, record in enumerate(records):
        try:
            candidate = parse_record(record, group)
        except MalformedRecord:
            continue
        if accepts(candidate, group):
            parsed[index] = candidate

    pairs: list[tuple[int, int]] = []
    indices = sorted(parsed)
    for position, left in enumerate(indices):
        for right in indices[position + 1 :]:
            a, b = parsed[left], parsed[right]
            if a["commitment"] == b["commitment"] and a["public_key"] == b["public_key"]:
                pairs.append((left, right))
    return pairs


def recover_secret(first, second, group) -> int:
    """x from two accepting transcripts that share a commitment.

        z1 = k + e1*x        z2 = k + e2*x
        z1 - z2 = (e1 - e2)*x          the k cancels

    So x = (z1 - z2) * (e1 - e2)^-1 mod n. The inverse is why e1 must differ from e2:
    two responses to the SAME challenge are one equation written twice.
    """
    from fixtures.generate import DOMAINS, challenge

    if first["commitment"] != second["commitment"]:
        raise MalformedRecord("the two transcripts do not share a commitment")
    if first["public_key"] != second["public_key"]:
        raise MalformedRecord("the two transcripts are not from the same signer")
    e1 = challenge(DOMAINS[0], first["commitment"], first["public_key"], first["message"], group)
    e2 = challenge(DOMAINS[0], second["commitment"], second["public_key"], second["message"], group)
    if (e1 - e2) % group.n == 0:
        raise MalformedRecord("the two challenges are equal, so there is nothing to solve")
    return (first["response"] - second["response"]) * pow(e1 - e2, -1, group.n) % group.n


def confirms(secret: int, public, group) -> bool:
    """Whether the recovered scalar really is the key. Never claim a recovery you have
    not checked -- the arithmetic succeeds on the wrong pair too."""
    return group.generator.scalar_mul(secret % group.n) == public


def attack_log(records, group) -> dict:
    """Find the reuse in a noisy log and come back with a confirmed key."""
    for left, right in find_reuse(records, group):
        first = parse_record(records[left], group)
        second = parse_record(records[right], group)
        try:
            secret = recover_secret(first, second, group)
        except MalformedRecord:
            continue
        if confirms(secret, first["public_key"], group):
            return {
                "secret": secret,
                "public_key": (first["public_key"].x, first["public_key"].y),
                "records": (left, right),
            }
    return {}


def collision_experiment(seed: str, group, samples: int) -> dict:
    """Count commitment collisions from the truncated generator.

    Every one of its outputs looks like hash output, and the log gives no hint that
    anything is wrong. The collision arrives on the birthday schedule regardless.
    """
    from fixtures.generate import NONCE_SPACE, messages, truncated_nonce

    secret = 12345 % (group.n - 1) + 1
    seen: dict[int, int] = {}
    collisions = 0
    for index in range(samples):
        message = f"payment {index}".encode()
        k = truncated_nonce(f"{seed}:{index % 1}", secret, message, group)
        if k in seen:
            collisions += 1
        seen[k] = index
    return {"collisions": collisions, "distinct": len(seen), "space": NONCE_SPACE}


def safe_nonce(secret: int, message: bytes, group) -> int:
    """A nonce that does not repeat across different messages.

    Deterministic on purpose. The same key and message give the same nonce -- and
    therefore the same signature, which leaks nothing new -- while two different
    messages cannot share one without a hash collision. The key is in the hash too:
    without it, two signers of the same message would use the same nonce.
    """
    digest = hashlib.sha256(
        b"nonce/v1" + secret.to_bytes(32, "big") + len(message).to_bytes(4, "big") + message
    ).digest()
    return 1 + int.from_bytes(digest, "big") % (group.n - 1)
