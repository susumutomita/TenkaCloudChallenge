"""Public tests. They show the shape of an answer; they do not prove one correct.

They hand you two transcripts that share a commitment and ask for the key. They do not
give you the noisy log, the record that parses but does not verify, the pair with equal
challenges, or the pair from two different signers. Every one of those is in the hidden
tests, and each of them makes a working extraction return a wrong number rather than
fail loudly.

Issue 537/538 (Issue 543 option B2): this file used to build its pair with
`fixtures.generate`'s `toy_group` and `secret_key`, which do not ship in the participant
image any more -- `secret_key` derives every key in this deployment, the hidden labels'
included, from the seed this container already has. Nothing is lost by writing the group
and the key out here instead: they were never the deployment's graded ones, and a fixed
pair is the same pair on every seed.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "starter"))

import recover as submission  # noqa: E402
from participant.schnorr import DOMAINS, Group, challenge, sign_with  # noqa: E402

#: One of the toy curves this problem draws from, written out rather than derived: the
#: generator has prime order 29, so every non-zero scalar below is usable.
GROUP = (23, 1, 4, 0, 2, 29)
SECRET = 7
NONCE = 11


def _pair():
    """Two accepting transcripts under one commitment, and the key behind them.

    The second message is searched for rather than fixed, because the extraction needs
    the two Fiat-Shamir challenges to differ: with n = 29 a blindly chosen pair collides
    about one time in thirty, and a public test that fails on those seeds would be
    telling the learner their correct code is wrong.
    """
    group = Group(*GROUP)
    commitment = group.generator.scalar_mul(NONCE)
    public = group.generator.scalar_mul(SECRET)
    first = b"one"
    first_challenge = challenge(DOMAINS[0], commitment, public, first, group)
    for attempt in range(256):
        second = b"two" if attempt == 0 else b"two-%d" % attempt
        if challenge(DOMAINS[0], commitment, public, second, group) != first_challenge:
            break
    else:  # pragma: no cover - 256 consecutive collisions modulo 29 does not happen
        raise AssertionError("could not find a second message with a different challenge")
    return (
        group,
        SECRET,
        sign_with(NONCE, SECRET, first, group),
        sign_with(NONCE, SECRET, second, group),
    )


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
