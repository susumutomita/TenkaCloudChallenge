"""Author-side check: break the reference on purpose and confirm the hidden tests notice.

Almost every entry here still signs and verifies on the happy path. Dropping the domain,
the message, or the commitment from the challenge produces a scheme that works perfectly
until somebody attacks it, which is precisely why the checkpoints attack it.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from tests.hidden import check_schnorr  # noqa: E402

REFERENCE = (ROOT / "reference" / "schnorr.py").read_text(encoding="utf-8")
SEED = "mutation-suite-seed"

_PREIMAGE = """    return b"".join(
        [
            len(domain_bytes).to_bytes(4, "big"),
            domain_bytes,
            len(message).to_bytes(4, "big"),
            message,
            encode_point(commitment, group),
            encode_point(public, group),
        ]
    )"""

MUTATIONS: tuple[tuple[str, list[tuple[str, str]]], ...] = (
    (
        "leaves the domain out of the challenge",
        [
            (
                _PREIMAGE,
                '    return b"".join(\n'
                "        [\n"
                '            len(message).to_bytes(4, "big"),\n'
                "            message,\n"
                "            encode_point(commitment, group),\n"
                "            encode_point(public, group),\n"
                "        ]\n"
                "    )",
            )
        ],
    ),
    (
        "leaves the message out of the challenge",
        [
            (
                _PREIMAGE,
                '    return b"".join(\n'
                "        [\n"
                '            len(domain_bytes).to_bytes(4, "big"),\n'
                "            domain_bytes,\n"
                "            encode_point(commitment, group),\n"
                "            encode_point(public, group),\n"
                "        ]\n"
                "    )",
            )
        ],
    ),
    (
        "leaves the commitment out of the challenge",
        [
            (
                _PREIMAGE,
                '    return b"".join(\n'
                "        [\n"
                '            len(domain_bytes).to_bytes(4, "big"),\n'
                "            domain_bytes,\n"
                '            len(message).to_bytes(4, "big"),\n'
                "            message,\n"
                "            encode_point(public, group),\n"
                "        ]\n"
                "    )",
            )
        ],
    ),
    (
        "leaves the public key out of the challenge",
        [
            (
                _PREIMAGE,
                '    return b"".join(\n'
                "        [\n"
                '            len(domain_bytes).to_bytes(4, "big"),\n'
                "            domain_bytes,\n"
                '            len(message).to_bytes(4, "big"),\n'
                "            message,\n"
                "            encode_point(commitment, group),\n"
                "        ]\n"
                "    )",
            )
        ],
    ),
    (
        "concatenates the variable-length fields without lengths",
        [
            (
                _PREIMAGE,
                '    return b"".join(\n'
                "        [\n"
                "            domain_bytes,\n"
                "            message,\n"
                "            encode_point(commitment, group),\n"
                "            encode_point(public, group),\n"
                "        ]\n"
                "    )",
            )
        ],
    ),
    (
        "reduces the response by the field modulus instead of the group order",
        [
            (
                "    return (nonce + challenge * secret) % group.n",
                "    return (nonce + challenge * secret) % group.p",
            )
        ],
    ),
    (
        "gets the sign wrong in the verification equation",
        [
            (
                "    right = commitment + public.scalar_mul(challenge % group.n)",
                "    right = commitment + (-public).scalar_mul(challenge % group.n)",
            )
        ],
    ),
    (
        "accepts the identity as a public key",
        [
            (
                "    return group.contains(point) and not point.is_infinity",
                "    return group.contains(point)",
            )
        ],
    ),
    (
        "accepts a coordinate that is not reduced",
        [
            (
                "    if x >= group.p or y >= group.p:\n"
                '        raise InvalidEncoding("a coordinate is not reduced")',
                "    x, y = x % group.p, y % group.p",
            )
        ],
    ),
    (
        "accepts any secret, including zero",
        [
            (
                "    if not isinstance(secret, int) or isinstance(secret, bool) or not 1 <= secret <= group.n - 1:\n"
                '        raise InvalidKey("the secret must be in [1, n-1]")',
                "    secret = secret % group.n",
            )
        ],
    ),
)


def _load(source: str):
    import types

    module = types.ModuleType("mutant")
    exec(compile(source, "<mutant>", "exec"), module.__dict__)  # noqa: S102 - author tool
    return module


def main() -> int:
    baseline = check_schnorr.run(_load(REFERENCE), SEED)
    if baseline:
        print(f"FAIL reference implementation does not pass the hidden tests: {baseline}")
        return 1
    print("PASS reference implementation passes the hidden tests")

    survivors = 0
    for name, substitutions in MUTATIONS:
        missing = [needle for needle, _ in substitutions if needle not in REFERENCE]
        if missing:
            print(f"SURVIVED {name} (the mutation no longer applies to the reference)")
            survivors += 1
            continue
        mutated = REFERENCE
        for needle, replacement in substitutions:
            mutated = mutated.replace(needle, replacement)
        try:
            failures = check_schnorr.run(_load(mutated), SEED)
        except Exception as error:  # noqa: BLE001 - a mutation that crashes is caught
            failures = [f"raised {type(error).__name__}"]
        if failures:
            print(f"KILLED {name} ({failures[0]})")
        else:
            print(f"SURVIVED {name}")
            survivors += 1

    if survivors:
        print(f"\n{survivors} mutation(s) survived. The hidden tests have a hole.")
        return 1
    print(f"\nAll {len(MUTATIONS)} mutations killed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
