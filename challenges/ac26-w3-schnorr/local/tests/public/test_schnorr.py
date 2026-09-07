"""Public tests. They show the shape of an answer; they do not prove one correct.

They sign one message and verify it. They never change a byte and re-verify, never look
at malformed encodings, never compare two domains, and do not exhaust malformed inputs. A separate secp256k1 smoke checks large widths.

A challenge function that hashes only the message passes this file. So does one with no
length prefixes. Both are broken, and both are broken in ways that only show up when
somebody is trying.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "starter"))

import schnorr as submission  # noqa: E402
from fixtures.generate import DOMAINS, nonce, secret_key, toy_group, secp_group  # noqa: E402

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def _setup():
    group = toy_group(SEED)
    return group, secret_key(SEED, "public", group), nonce(SEED, "public", group)


def check_public_key_is_the_secret_times_g() -> str:
    group, x, _k = _setup()
    if submission.public_key(x, group) != group.generator.scalar_mul(x):
        return "P is not xG"
    return ""


def check_honest_transcript_verifies() -> str:
    group, x, k = _setup()
    public = group.generator.scalar_mul(x)
    commitment = submission.commit(k, group)
    e = 3
    z = submission.respond(k, e, x, group)
    if not submission.verify_transcript(public, commitment, e, z, group):
        return "an honest transcript did not verify"
    return ""


def check_sign_then_verify() -> str:
    group, x, k = _setup()
    public = group.generator.scalar_mul(x)
    signature = submission.sign(x, k, b"hello", DOMAINS[0], group)
    if not submission.verify(public, b"hello", signature, DOMAINS[0], group):
        return "a signature this file just produced did not verify"
    return ""


def check_point_encoding_round_trip() -> str:
    group, x, _k = _setup()
    point = group.generator.scalar_mul(x)
    encoded = submission.encode_point(point, group)
    if not isinstance(encoded, bytes) or len(encoded) != 2 * group.as_public()["coordinate_bytes"]:
        return "point encoding does not use the documented width"
    if submission.decode_point(encoded, group) != point:
        return "decoding did not recover the encoded point"
    return ""


def check_secp256k1_round_trip() -> str:
    group = secp_group()
    x, k = 3, 5
    public = submission.public_key(x, group)
    raw = submission.encode_point(public, group)
    if not isinstance(raw, bytes) or len(raw) != 2 * group.as_public()["coordinate_bytes"]:
        return "secp256k1 encoding does not use its coordinate width"
    if submission.decode_point(raw, group) != public:
        return "secp256k1 point encoding did not round-trip"
    message = b"public transfer smoke"
    signature = submission.sign(x, k, message, DOMAINS[0], group)
    if not submission.verify(public, message, signature, DOMAINS[0], group):
        return "secp256k1 signature did not verify"
    return ""


CHECKS = (
    ("secp256k1-round-trip", check_secp256k1_round_trip),
    ("point-encoding-round-trip", check_point_encoding_round_trip),
    ("public-key-is-xg", check_public_key_is_the_secret_times_g),
    ("honest-transcript-verifies", check_honest_transcript_verifies),
    ("sign-then-verify", check_sign_then_verify),
)


def main(argv: list[str]) -> int:
    only = argv[argv.index("--only") + 1] if "--only" in argv else ""
    failed = 0
    for name, check in CHECKS:
        if only and only not in name:
            continue
        try:
            message = check()
        except Exception as error:  # noqa: BLE001 - a crash is a failure, reported as one
            message = f"raised {type(error).__name__}"
        if message:
            print(f"FAIL {name}: {message}")
            failed += 1
        else:
            print(f"ok   {name}")
    print(f"\npublic tests: {failed} failed" if failed else "\npublic tests: all passed")
    if not failed:
        print("\nNothing here changed a byte and re-verified, or compared two domains.")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
