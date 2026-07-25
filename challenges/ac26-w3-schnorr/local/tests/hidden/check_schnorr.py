"""Hidden tests. Run by /verify against a copy of the learner's schnorr.py.

The serialization and Fiat-Shamir checks are the ones with teeth. A challenge that
leaves out any binding input, or an encoding that lets two different statements produce
the same preimage, still signs and verifies perfectly on the happy path -- so the tests
attack those directly rather than only round-tripping.
"""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fixtures.generate import (  # noqa: E402
    DOMAINS,
    messages,
    nonce,
    secp_group,
    secret_key,
    toy_group,
    weak_challenge,
)

LABELS = ("h0", "h1", "h2")


def _case(module, seed: str, label: str):
    group = toy_group(seed, label)
    x = secret_key(seed, label, group)
    k = nonce(seed, label, group)
    return group, x, k, messages(seed, label)


def check_keygen(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        group, x, _k, _m = _case(module, seed, label)
        try:
            public = module.public_key(x, group)
        except Exception as error:  # noqa: BLE001
            return [f"deriving a public key raised {type(error).__name__}"]
        if public != group.generator.scalar_mul(x):
            failures.append("the public key is not the secret times the generator")
            continue
        if not module.validate_public_key(public, group):
            failures.append("a valid public key was rejected")
        # The identity is on the curve and is not a usable key.
        if module.validate_public_key(group.infinity(), group):
            failures.append("the identity was accepted as a public key")
        other = toy_group(seed, f"{label}-other")
        if other.params != group.params and module.validate_public_key(other.generator, group):
            failures.append("a point from another curve was accepted as a public key")
        for bad in (0, group.n, -1):
            try:
                module.public_key(bad, group)
                failures.append("a secret outside [1, n-1] was accepted")
                break
            except module.InvalidKey:
                pass
            except Exception as error:  # noqa: BLE001
                failures.append(f"a bad secret raised {type(error).__name__}, not InvalidKey")
                break
    return failures


def check_sigma(module, seed: str) -> list[str]:
    """The interactive protocol, with the challenge coming from outside."""
    failures: list[str] = []
    for label in LABELS:
        group, x, k, _m = _case(module, seed, label)
        public = group.generator.scalar_mul(x)
        commitment = module.commit(k, group)
        if commitment != group.generator.scalar_mul(k):
            failures.append("the commitment is not the nonce times the generator")
            continue
        for e in (0, 1, 2, group.n - 1, (x * 7 + 3) % group.n):
            z = module.respond(k, e, x, group)
            if not isinstance(z, int) or not 0 <= z < group.n:
                failures.append("the response is not a scalar reduced by the group order")
                break
            if z != (k + e * x) % group.n:
                failures.append("the response is not k + e*x mod n")
                break
    return failures


def check_transcript(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        group, x, k, _m = _case(module, seed, label)
        public = group.generator.scalar_mul(x)
        commitment = group.generator.scalar_mul(k)
        for e in (1, 3, group.n - 2):
            z = (k + e * x) % group.n
            if not module.verify_transcript(public, commitment, e, z, group):
                failures.append("an honest transcript was rejected")
                break
            if module.verify_transcript(public, commitment, e, (z + 1) % group.n, group):
                failures.append("a transcript with a modified response was accepted")
                break
            if module.verify_transcript(public, commitment, (e + 1) % group.n, z, group):
                failures.append("a transcript with a modified challenge was accepted")
                break
            other_commitment = group.generator.scalar_mul((k + 1) % group.n)
            if module.verify_transcript(public, other_commitment, e, z, group):
                failures.append("a transcript with a modified commitment was accepted")
                break
        if module.verify_transcript(group.infinity(), commitment, 1, 1, group):
            failures.append("a transcript against the identity as a public key was accepted")
    return failures


def check_serialization(module, seed: str) -> list[str]:
    """Round-trip, plus the two ways an encoding stops being an encoding."""
    failures: list[str] = []
    for label in LABELS:
        group, x, k, message_list = _case(module, seed, label)
        public = group.generator.scalar_mul(x)
        width = group.as_public()["coordinate_bytes"]
        try:
            raw = module.encode_point(public, group)
        except Exception as error:  # noqa: BLE001
            return [f"encoding a point raised {type(error).__name__}"]
        if not isinstance(raw, bytes) or len(raw) != 2 * width:
            failures.append("a point does not encode to a fixed width")
            continue
        if module.decode_point(raw, group) != public:
            failures.append("a point does not survive an encode and decode")
            continue
        # A coordinate at or above p is a second byte string for the same element.
        overflowing = (group.p + public.x).to_bytes(width + 1, "big")[-width:] + raw[width:]
        if group.p + public.x < 1 << (8 * width):
            try:
                module.decode_point(overflowing, group)
                failures.append("a coordinate that is not reduced was accepted")
            except module.InvalidEncoding:
                pass
            except Exception as error:  # noqa: BLE001
                failures.append(f"a non-reduced coordinate raised {type(error).__name__}")
        try:
            module.decode_point(raw[:-1], group)
            failures.append("a truncated encoding was accepted")
        except module.InvalidEncoding:
            pass
        except Exception as error:  # noqa: BLE001
            failures.append(f"a truncated encoding raised {type(error).__name__}")

        # The ambiguity that matters: two different (domain, message) pairs must never
        # produce the same preimage. Plain concatenation makes them collide.
        commitment = group.generator.scalar_mul(k)
        first = module.challenge_preimage("ab", commitment, public, b"cd", group)
        second = module.challenge_preimage("a", commitment, public, b"bcd", group)
        if first == second:
            failures.append("two different statements produce the same challenge preimage")
    return failures


def check_fiat_shamir(module, seed: str) -> list[str]:
    """Every binding input has to change what gets hashed, and the challenge with it.

    On the toy groups the assertion is on the PREIMAGE, not on the challenge value. Two
    different preimages collide mod n with probability 1/n, and n here is under fifty --
    so "changing the message changes the challenge" is false about one time in forty for
    a perfectly correct implementation. The property that actually matters is that the
    input to the hash differs, which is deterministic. The challenge values themselves
    are compared over secp256k1, where a collision is not going to happen.
    """
    failures: list[str] = []
    for label in LABELS:
        group, x, k, message_list = _case(module, seed, label)
        public = group.generator.scalar_mul(x)
        commitment = group.generator.scalar_mul(k)
        message = message_list[0]
        base_challenge = module.challenge(DOMAINS[0], commitment, public, message, group)
        if not isinstance(base_challenge, int) or not 0 <= base_challenge < group.n:
            failures.append("the challenge is not a scalar reduced by the group order")
            continue
        if module.challenge(DOMAINS[0], commitment, public, message, group) != base_challenge:
            failures.append("the challenge is not deterministic")
            continue
        base = module.challenge_preimage(DOMAINS[0], commitment, public, message, group)
        variants = {
            "the domain": module.challenge_preimage(
                DOMAINS[1], commitment, public, message, group
            ),
            "the commitment": module.challenge_preimage(
                DOMAINS[0], group.generator.scalar_mul((k + 1) % group.n), public, message, group
            ),
            "the public key": module.challenge_preimage(
                DOMAINS[0], commitment, group.generator.scalar_mul((x + 1) % group.n), message, group
            ),
            "the message": module.challenge_preimage(
                DOMAINS[0], commitment, public, message + b"!", group
            ),
        }
        for name, value in variants.items():
            if value == base:
                failures.append(f"changing {name} does not change what the challenge hashes")
                break

    group = secp_group()
    for label in ("f0", "f1"):
        x = secret_key(seed, label, group)
        k = nonce(seed, label, group)
        public = group.generator.scalar_mul(x)
        commitment = group.generator.scalar_mul(k)
        message = messages(seed, label, 1)[0]
        base_challenge = module.challenge(DOMAINS[0], commitment, public, message, group)
        others = [
            module.challenge(DOMAINS[1], commitment, public, message, group),
            module.challenge(DOMAINS[0], commitment, public, message + b"!", group),
            module.challenge(
                DOMAINS[0], group.generator.scalar_mul((k + 1) % group.n), public, message, group
            ),
        ]
        if any(value == base_challenge for value in others):
            failures.append("a binding input does not change the challenge on the real curve")
    return failures


def check_sign_verify(module, seed: str) -> list[str]:
    """Honest signatures on the toy groups; forgery rejection on the real one.

    The split is not arbitrary. A Schnorr forgery succeeds with probability 1/n, and the
    toy groups have n between 29 and 43 -- so "sign, change the message, verify" really
    does accept about one time in forty, and asserting otherwise would be asserting that
    a coin never lands heads. That is a true and useful fact about small groups, not a
    defect, so the rejection assertions run over secp256k1 where 1/n is negligible.
    """
    failures: list[str] = []
    for label in LABELS:
        group, x, k, message_list = _case(module, seed, label)
        public = group.generator.scalar_mul(x)
        for message in message_list:
            try:
                signature = module.sign(x, k, message, DOMAINS[0], group)
            except Exception as error:  # noqa: BLE001
                return [f"signing raised {type(error).__name__}"]
            if not isinstance(signature, tuple) or len(signature) != 2:
                failures.append("a signature is not a commitment and a response")
                break
            if not module.verify(public, message, signature, DOMAINS[0], group):
                failures.append("an honest signature was rejected")
                break

    group = secp_group()
    for label in ("r0", "r1"):
        x = secret_key(seed, label, group)
        k = nonce(seed, label, group)
        public = group.generator.scalar_mul(x)
        for message in messages(seed, label, 2):
            signature = module.sign(x, k, message, DOMAINS[0], group)
            if not module.verify(public, message, signature, DOMAINS[0], group):
                failures.append("an honest signature was rejected")
                continue
            commitment, response = signature
            accepted = {
                "the message": module.verify(
                    public, message + b"\x00", signature, DOMAINS[0], group
                ),
                "the domain": module.verify(public, message, signature, DOMAINS[1], group),
                "the public key": module.verify(
                    group.generator.scalar_mul((x + 1) % group.n),
                    message,
                    signature,
                    DOMAINS[0],
                    group,
                ),
                "the commitment": module.verify(
                    public,
                    message,
                    (group.generator.scalar_mul((k + 1) % group.n), response),
                    DOMAINS[0],
                    group,
                ),
                "the response": module.verify(
                    public, message, (commitment, (response + 1) % group.n), DOMAINS[0], group
                ),
            }
            for name, was_accepted in accepted.items():
                if was_accepted:
                    failures.append(f"a signature was still accepted after {name} changed")
                    break
    return failures


def check_cross_protocol(module, seed: str) -> list[str]:
    """The counterexample: one signature, two protocols, because the domain was left out.

    The weak challenge is defined in the fixtures rather than by the submission, so the
    attack has to work against a fixed weakness rather than against the learner's own
    code. And the same witness must FAIL under their real challenge -- otherwise they
    have demonstrated an attack on themselves.
    """
    failures: list[str] = []
    for label in LABELS:
        group = toy_group(seed, label)
        try:
            witness = module.cross_protocol_witness(group)
        except Exception as error:  # noqa: BLE001
            return [f"building the witness raised {type(error).__name__}"]
        if not isinstance(witness, dict):
            failures.append("no witness was produced")
            continue
        missing = [
            key
            for key in ("domain_a", "domain_b", "message", "secret", "nonce")
            if key not in witness
        ]
        if missing:
            failures.append("the witness does not name both domains, a message, and a keypair")
            continue
        domain_a, domain_b = witness["domain_a"], witness["domain_b"]
        message = witness["message"]
        if domain_a == domain_b:
            failures.append("the two domains in the witness are the same")
            continue
        if not isinstance(message, bytes):
            failures.append("the witness message is not bytes")
            continue
        secret, nonce_value = witness["secret"], witness["nonce"]
        if not (1 <= secret <= group.n - 1 and 1 <= nonce_value <= group.n - 1):
            failures.append("the witness keypair is not usable in this group")
            continue

        public = group.generator.scalar_mul(secret)
        commitment = group.generator.scalar_mul(nonce_value)
        weak_e = weak_challenge(commitment, public, message, group)
        response = (nonce_value + weak_e * secret) % group.n

        # Under the weak challenge the one signature satisfies both protocols, because
        # neither protocol is named anywhere in what was hashed. This holds by the
        # equation, not by chance.
        left = group.generator.scalar_mul(response)
        right = commitment + public.scalar_mul(weak_e)
        if left != right:
            failures.append("the witness signature is not valid under the weak challenge")
            continue

        # And the learner's own challenge must separate the two domains. Asserted on the
        # preimage rather than on the challenge value: over a group this small two
        # different preimages collide mod n about one time in forty, and that would make
        # a correct submission fail at random.
        preimage_a = module.challenge_preimage(domain_a, commitment, public, message, group)
        preimage_b = module.challenge_preimage(domain_b, commitment, public, message, group)
        if preimage_a == preimage_b:
            failures.append("the real challenge hashes the same bytes for both domains")
    return failures


def check_transfer(module, seed: str) -> list[str]:
    """The same protocol code on a real parameter set, unchanged."""
    failures: list[str] = []
    group = secp_group()
    for label in ("t0", "t1"):
        x = secret_key(seed, label, group)
        k = nonce(seed, label, group)
        for message in messages(seed, label, 2):
            public = module.public_key(x, group)
            if public != group.generator.scalar_mul(x):
                failures.append("the public key is wrong on the real curve")
                continue
            signature = module.sign(x, k, message, DOMAINS[0], group)
            if not module.verify(public, message, signature, DOMAINS[0], group):
                failures.append("an honest signature was rejected on the real curve")
                continue
            if module.verify(public, message + b"x", signature, DOMAINS[0], group):
                failures.append("a modified message was accepted on the real curve")
            raw = module.encode_point(public, group)
            if module.decode_point(raw, group) != public:
                failures.append("a point does not round-trip on the real curve")
    return failures


def run(module, seed: str) -> list[str]:
    return [
        *check_keygen(module, seed),
        *check_sigma(module, seed),
        *check_transcript(module, seed),
        *check_serialization(module, seed),
        *check_fiat_shamir(module, seed),
        *check_sign_verify(module, seed),
        *check_cross_protocol(module, seed),
        *check_transfer(module, seed),
    ]
