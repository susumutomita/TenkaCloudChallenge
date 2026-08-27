"""Seed derivation, the audit log, and the two generators that are not measured.

The curve arithmetic and the signature scheme are provided to the learner: the previous
two problems built them. They live in `participant/schnorr.py` and are re-exported here,
so this module and the hidden suite keep importing them under the names they always had.
What the learner writes is the attack, and then the fix.

The scenario is an audit log. It holds what such a log usually holds -- message, public
key, commitment R, response z -- and not the secret key. Somewhere in it, one signer
reused a commitment. Two accepting transcripts under the same R are two equations in two
unknowns, and the unknown you do not already have is the secret key.

Issue 537/538 (Issue 543 option B2): this module does **not** ship in the participant
image any more (see ../Dockerfile). What it holds that a learner must not be handed:

  * `audit_log` returns `victim_secret` and `victim_public` beside the records. That is
    the `hunt` checkpoint's answer, as a value.
  * `secret_key` derives every key in this deployment from the seed and a label, and the
    participant container has `FLAG_SEED` in its environment. With this function a
    learner could compute the hidden labels' keys in their own container and hard-code
    them into a submission rather than attacking anything.
  * `deterministic_nonce` is the `repair` checkpoint's answer, with a docstring saying
    why it works and what has to go into the hash.

Three nonce generators exist, and the difference between them is the whole of the last
two checkpoints:

  * `fixed_nonce`      -- the same k every time. Fails immediately.
  * `truncated_nonce`  -- a real hash, then thrown away down to a handful of bits. Looks
                          random in a log and collides by the birthday bound. This is the
                          one the `collision` checkpoint measures, so it is the one that
                          lives in `participant/schnorr.py`.
  * `deterministic_nonce` -- a hash of the secret key AND the message. Deterministic,
                          which sounds alarming, and is the one that does not collide.

Toy parameters are for observability. Nothing here is constant-time, and none of it is a
model for signing anything real.
"""

from __future__ import annotations

import hashlib

# The supplied half. Re-exported rather than redefined so there is exactly one
# definition of the protocol the log records, and the participant image and the grading
# image cannot drift apart.
from participant.schnorr import (  # noqa: F401 - re-exported for the hidden suite
    DOMAINS,
    NONCE_SPACE,
    Group,
    Point,
    _encode_point,
    challenge,
    sign_with,
    truncated_nonce,
)

# (p, a, b, gx, gy, n): toy curves whose generator has the stated PRIME order, so every
# non-zero scalar mod n is usable and z = k + e*x mod n behaves like the real thing.
# Every entry is verified, not assumed: the discriminant is non-zero, the group order is
# prime, and the listed generator has exactly that order. A generator whose order is
# smaller than claimed would make z = k + e*x mod n silently wrong for some scalars, so
# a test recomputes all three properties from scratch.
TOY_GROUPS = (
    (23, 1, 4, 0, 2, 29),
    (23, 5, 1, 0, 1, 31),
    (29, 5, 7, 0, 6, 37),
    (31, 0, 3, 1, 2, 43),
    (31, 1, 3, 1, 6, 41),
)

SECP256K1 = (
    0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F,
    0,
    7,
    0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798,
    0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8,
    0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141,
)


def _stream(seed: str, label: str) -> list[int]:
    out: list[int] = []
    counter = 0
    while len(out) < 128:
        out.extend(hashlib.sha256(f"{seed}:{label}:{counter}".encode()).digest())
        counter += 1
    return out


def _pick(s: list[int], i: int, low: int, high: int) -> int:
    return low + ((s[i % 120] * 256 + s[(i + 1) % 120]) % (high - low + 1))


def toy_group(seed: str, label: str = "public") -> Group:
    return Group(*TOY_GROUPS[_stream(seed, f"group:{label}")[0] % len(TOY_GROUPS)])


def secp_group() -> Group:
    return Group(*SECP256K1)


def secret_key(seed: str, label: str, group: Group) -> int:
    return _pick(_stream(seed, f"secret:{label}"), 0, 1, min(group.n - 1, 1 << 30))


def nonce(seed: str, label: str, group: Group) -> int:
    return _pick(_stream(seed, f"nonce:{label}"), 0, 1, min(group.n - 1, 1 << 30))


def messages(seed: str, label: str, count: int = 4) -> list[bytes]:
    s = _stream(seed, f"messages:{label}")
    return [bytes(s[4 * i : 4 * i + 1 + (s[i] % 20)]) for i in range(count)]


def message_with_different_challenge(
    first: bytes,
    candidate: bytes,
    commitment: Point,
    public: Point,
    group: Group,
) -> bytes:
    """Choose a second message that makes the reused nonce extractable.

    Reusing a commitment gives two equations only when their Fiat-Shamir challenges
    differ. In these toy groups a blind pair collides modulo ``n`` often enough to make
    real deployments unsolvable, so the fixture rejects that degenerate draw instead of
    asking the learner to invert zero.
    """
    first_challenge = challenge(DOMAINS[0], commitment, public, first, group)
    for attempt in range(256):
        suffix = b"" if attempt == 0 else f"-retry-{attempt}".encode()
        second = candidate + suffix
        if (
            second != first
            and challenge(DOMAINS[0], commitment, public, second, group) != first_challenge
        ):
            return second
    raise RuntimeError("could not construct two transcripts with different challenges")


def fixed_nonce(secret: int, message: bytes, group: Group) -> int:
    """The same k every time. The bug this problem exists to punish."""
    return 1 + (secret % 1)  # always 1


def deterministic_nonce(secret: int, message: bytes, group: Group) -> int:
    """A hash of the secret AND the message.

    Deterministic, which sounds like the opposite of what a nonce should be, and is
    nonetheless the safe one: the same message under the same key gives the same nonce
    and the same signature, and two DIFFERENT messages cannot collide without a hash
    collision. Binding the key matters too -- hashing the message alone would give two
    signers the same nonce for the same message.

    This is the `repair` checkpoint's answer. It stays out of the participant image.
    """
    digest = hashlib.sha256(
        b"nonce/v1" + secret.to_bytes(32, "big") + len(message).to_bytes(4, "big") + message
    ).digest()
    return 1 + (int.from_bytes(digest, "big") % (group.n - 1))


def audit_log(seed: str, label: str, group: Group) -> dict:
    """A log with one reused commitment in it, plus noise.

    The noise is the point: several signers, several messages, and a few malformed
    records, so that "find the two records that matter" is a real step rather than
    "attack records 0 and 1".
    """
    s = _stream(seed, f"log:{label}")
    victim = secret_key(seed, f"{label}-victim", group)
    others = [secret_key(seed, f"{label}-other{i}", group) for i in range(3)]
    note_list = messages(seed, f"{label}-msg", 10)

    # The victim signs two different messages under one commitment. Chosen first, so the
    # honest records can be built to avoid it.
    reused = 1 + (_pick(s, 0, 1, group.n - 2))

    # The honest records get pairwise distinct nonces, chosen rather than hashed. On a
    # group this small a hash-derived nonce collides with another by birthday often
    # enough to matter, and a second, accidental reuse would make "find the reuse"
    # ambiguous -- the attack would recover *a* key, just not reliably the victim's.
    # Realism is not worth a fixture that grades differently run to run.
    available = [value for value in range(1, group.n) if value != reused]
    records = []
    for index, note in enumerate(note_list[:6]):
        signer = others[index % len(others)]
        records.append(sign_with(available[index % len(available)], signer, note, group))
    first = note_list[6]
    second = message_with_different_challenge(
        first,
        note_list[7],
        group.generator.scalar_mul(reused),
        group.generator.scalar_mul(victim),
        group,
    )
    records.append(sign_with(reused, victim, first, group))
    records.append(sign_with(reused, victim, second, group))

    # A record that parses perfectly, shares the reused commitment and the victim's key,
    # and does NOT verify. A detector that skips the acceptance check pairs it with a
    # real transcript and solves for a scalar that is not anybody's key. Reuse in a
    # rejected transcript proves nothing.
    forged = sign_with(reused, victim, note_list[8], group)
    forged["response"] = (forged["response"] + 1) % group.n
    records.append(forged)

    # A DIFFERENT signer who happens to have used the same commitment. Two transcripts
    # under one commitment but two keys are not two equations in one unknown -- there is
    # nothing to solve for, and an attacker who pairs them recovers a scalar belonging to
    # nobody. Sharing R is necessary and is not sufficient.
    records.append(sign_with(reused, others[0], note_list[9], group))

    # Malformed records, so a parser that trusts its input falls over.
    records.append({"message": b"broken", "public_key": (None, None), "commitment": (0, 0)})
    records.append({"message": b"broken", "commitment": (1, 1), "response": 0})

    order = [(_pick(s, 2 * i + 2, 0, 10_000), record) for i, record in enumerate(records)]
    order.sort(key=lambda pair: pair[0])
    return {
        "records": [record for _key, record in order],
        "victim_secret": victim,
        "victim_public": group.generator.scalar_mul(victim),
    }


def health_token(seed: str) -> str:
    group = toy_group(seed)
    return hashlib.sha256(f"health:{seed}:{group.p}:{group.n}".encode()).hexdigest()[:16]


def _record_as_public(record: dict) -> dict[str, object]:
    """One log row, as JSON. Exactly the four fields the log has always shown.

    A malformed row travels as the malformed thing it is -- a missing field is missing
    here too -- because "some rows are broken" is a fact about the log that `make
    inspect` has always shown and that `parse_record` is graded on handling.
    """

    def _point(value: object) -> object:
        if not isinstance(value, (tuple, list)) or len(value) != 2:
            return value
        return list(value)

    payload: dict[str, object] = {}
    if "message" in record:
        message = record["message"]
        payload["message"] = message.hex() if isinstance(message, bytes) else message
    for name in ("public_key", "commitment"):
        if name in record:
            payload[name] = _point(record[name])
    if "response" in record:
        payload["response"] = record["response"]
    return payload


def public_payload(seed: str) -> dict[str, object]:
    """Everything a participant may see for this deployment. Carries values, not code.

    This is exactly what `make inspect` has always printed and nothing more: the health
    token, this deployment's group, the public label's audit log row by row, and the size
    of the truncated generator's output space.

    What does not travel is `audit_log`'s other two return values. `victim_secret` is the
    `hunt` checkpoint's answer outright, and `victim_public` names which of the log's
    keys is the one to recover -- half of the same answer, since confirming a candidate
    against a named public key is the check the attack is supposed to arrive at. The
    records themselves are the material the learner is meant to work on, including the
    malformed rows, the row that parses and does not verify, and the second signer under
    the same commitment; none of them says which pair is the solvable one.

    The public label is not a graded label. The hidden phases draw `h0`, `h1` and `h2`,
    each with its own group, its own keys and its own log, from the same seed by a
    derivation (`secret_key`, `audit_log`) that ships only in the verifier image.
    """
    group = toy_group(seed)
    log = audit_log(seed, "public", group)
    return {
        "healthToken": health_token(seed),
        "group": {
            "p": group.p,
            "a": group.a,
            "b": group.b,
            "n": group.n,
            "gx": group.generator.x,
            "gy": group.generator.y,
        },
        "nonceSpace": NONCE_SPACE,
        "records": [_record_as_public(record) for record in log["records"]],
    }
