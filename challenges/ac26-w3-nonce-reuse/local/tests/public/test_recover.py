"""Public tests. They show the shape of an answer; they do not prove one correct.

They hand you two transcripts that share a commitment and ask for the key. They do not
give you the noisy log, the record that parses but does not verify, the pair with equal
challenges, or the pair from two different signers. Every one of those is in the hidden
tests, and each of them makes a working extraction return a wrong number rather than
fail loudly.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "starter"))

import recover as submission  # noqa: E402
from fixtures.generate import secret_key, sign_with, toy_group  # noqa: E402

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def _pair():
    group = toy_group(SEED)
    secret = secret_key(SEED, "public", group)
    k = 1 + (secret * 3 + 5) % (group.n - 2)
    return group, secret, sign_with(k, secret, b"one", group), sign_with(k, secret, b"two", group)


def check_a_valid_record_parses() -> str:
    group, _secret, first, _second = _pair()
    parsed = submission.parse_record(dict(first), group)
    if not isinstance(parsed, dict) or "response" not in parsed:
        return "a valid record did not parse"
    return ""


def check_the_key_comes_out() -> str:
    group, secret, first, second = _pair()
    a = submission.parse_record(dict(first), group)
    b = submission.parse_record(dict(second), group)
    if submission.recover_secret(a, b, group) % group.n != secret % group.n:
        return "the recovered scalar is not the signer's secret"
    return ""


CHECKS = (
    ("a-valid-record-parses", check_a_valid_record_parses),
    ("the-key-comes-out", check_the_key_comes_out),
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
        print("\nNothing here gave you a broken record, a decoy pair, or a log to search.")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
