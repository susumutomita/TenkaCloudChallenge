"""Author-side check: break the reference on purpose and confirm the hidden tests notice.

The mutations that matter are the ones that still return a number. Integer division,
the wrong modulus, and attacking the first duplicate you see all produce a scalar --
just not the key. That is why every extraction path ends at `confirms`.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from tests.hidden import check_recover  # noqa: E402

REFERENCE = (ROOT / "reference" / "recover.py").read_text(encoding="utf-8")
SEED = "mutation-suite-seed"

MUTATIONS: tuple[tuple[str, list[tuple[str, str]]], ...] = (
    ("recovers from a rejected transcript", [("    if not accepts(first, group) or not accepts(second, group):", "    if False:")]),
    ("confirms only Point input", [('    if isinstance(public, dict):', '    if isinstance(public, (dict, tuple, list)):\n        return False\n    if isinstance(public, dict):')]),
    ("includes equal-challenge pairs", [("                if e1 != e2:", "                if True:")]),
    ("rejects normalized Point input", [("    if isinstance(value, Point):", "    if False and isinstance(value, Point):")]),
    (
        "divides instead of inverting",
        [
            (
                "    return (first[\"response\"] - second[\"response\"]) * pow(e1 - e2, -1, group.n) % group.n",
                "    return (first[\"response\"] - second[\"response\"]) // (e1 - e2) % group.n",
            )
        ],
    ),
    (
        "confuses the field modulus with the group order",
        [
            (
                "    return (first[\"response\"] - second[\"response\"]) * pow(e1 - e2, -1, group.n) % group.n",
                "    return (first[\"response\"] - second[\"response\"]) * pow(e1 - e2, -1, group.p) % group.p",
            )
        ],
    ),
    (
        "attacks any pair sharing a commitment, whoever signed it",
        [
            (
                '            if a["commitment"] == b["commitment"] and a["public_key"] == b["public_key"]:',
                '            if a["commitment"] == b["commitment"]:',
            )
        ],
    ),
    (
        "never checks that the transcripts were accepting",
        [("        if accepts(candidate, group):\n            parsed[index] = candidate", "        parsed[index] = candidate")],
    ),
    (
        "lets the equal-challenge case fall through to a zero inverse",
        [
            (
                "    if (e1 - e2) % group.n == 0:\n"
                '        raise MalformedRecord("the two challenges are equal, so there is nothing to solve")',
                "    pass",
            )
        ],
    ),
    (
        # Dropping the confirmation ALONE is an equivalent mutant: with a correct
        # `find_reuse`, every pair it returns provably yields the key, so the check can
        # never fire. It becomes a real defect exactly when validation is also skipped,
        # which is what a sloppy implementation actually looks like -- so the two are
        # mutated together rather than listing a mutant that can never be killed.
        "skips the acceptance check and reports the recovery unconfirmed",
        [
            (
                "        if accepts(candidate, group):\n            parsed[index] = candidate",
                "        parsed[index] = candidate",
            ),
            (
                "        if confirms(secret, first[\"public_key\"], group):\n"
                "            return {\n"
                '                "secret": secret,\n'
                '                "public_key": (first["public_key"].x, first["public_key"].y),\n'
                '                "records": (left, right),\n'
                "            }",
                "        return {\n"
                '            "secret": secret,\n'
                '            "public_key": (first["public_key"].x, first["public_key"].y),\n'
                '            "records": (left, right),\n'
                "        }",
            ),
        ],
    ),
    (
        "derives the nonce from the message alone, binding no key",
        [
            (
                '    digest = hmac.new(key, data, hashlib.sha256).digest()',
                '    digest = hmac.new(b"", data, hashlib.sha256).digest()',
            )
        ],
    ),
    (
        "truncates the repaired nonce space to sixteen bits",
        [
            (
                "    return 1 + int.from_bytes(digest, \"big\") % (group.n - 1)",
                "    return 1 + int.from_bytes(digest, \"big\") % 65536",
            )
        ],
    ),
    (
        "accepts a record whose response is not a canonical scalar",
        [
            (
                "    if not isinstance(response, int) or isinstance(response, bool) or not 0 <= response < group.n:\n"
                '        raise MalformedRecord("the response is not a canonical scalar")',
                "    response = response % group.n",
            )
        ],
    ),
)


MUTATIONS += (
    ("skips recovery input parsing", [("    first = parse_record(first, group)\n    second = parse_record(second, group)", "")]),
    ("does not require a message field", [('("message", "public_key", "commitment", "response")', '("public_key", "commitment", "response")')]),
    ("accepts non-integer responses", [("not isinstance(response, int) or isinstance(response, bool) or not 0 <= response < group.n", "not 0 <= response < group.n")]),

    ("checks membership before coordinate types", [('        if type(value.x) is not int or type(value.y) is not int or not 0 <= value.x < group.p or not 0 <= value.y < group.p:\n            raise MalformedRecord("a coordinate is not canonical")\n        if value.is_infinity or not group.contains(value):\n            raise MalformedRecord("the point is not a usable group element")\n', '        if value.is_infinity or not group.contains(value):\n            raise MalformedRecord("the point is not a usable group element")\n        if type(value.x) is not int or type(value.y) is not int or not 0 <= value.x < group.p or not 0 <= value.y < group.p:\n            raise MalformedRecord("a coordinate is not canonical")\n')]),
    ("uses plain SHA256 instead of HMAC", [(
        "digest = hmac.new(key, data, hashlib.sha256).digest()",
        "digest = hashlib.sha256(key + data).digest()",
    )]),

    ("trusts every normalized Point", [(
        "    if isinstance(value, Point):",
        "    if isinstance(value, Point):\n        return value",
    )]),
    ("returns first pair without comparing challenges", [(
        "                if e1 != e2:\n                    pairs.append((left, right))",
        "                return [(left, right)]",
    )]),
)


def _load(source: str):
    import types

    module = types.ModuleType("mutant")
    exec(compile(source, "<mutant>", "exec"), module.__dict__)  # noqa: S102 - author tool
    return module


def main() -> int:
    suite = unittest.defaultTestLoader.discover(str(ROOT / "tests" / "hidden"), pattern="test_*.py")
    if not unittest.TextTestRunner().run(suite).wasSuccessful():
        return 1
    baseline = check_recover.run(_load(REFERENCE), SEED)
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
            failures = check_recover.run(_load(mutated), SEED)
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
