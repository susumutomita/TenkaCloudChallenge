"""Mutation suite: break the reference on purpose, assert the hidden tests notice."""

from __future__ import annotations

import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tests.hidden.check_beaver import run

SEED = "mutation-suite-seed"
REFERENCE = (Path(__file__).resolve().parent / "reference" / "beaver.py").read_text("utf-8")

_COMBINE_TAIL = """    out[0] = (out[0] + d * e) % p
    return out"""

MUTATIONS: list[tuple[str, str]] = [
    (
        "public product folded into every share, giving x*y + (n-1)*d*e",
        REFERENCE.replace(
            _COMBINE_TAIL,
            "    return [(v + d * e) % p for v in out]",
        ),
    ),
    (
        "public product dropped entirely",
        REFERENCE.replace(_COMBINE_TAIL, "    return out"),
    ),
    (
        "cross terms swapped: d*a + e*b instead of d*b + e*a",
        REFERENCE.replace("(c + d * b + e * a) % p", "(c + d * a + e * b) % p"),
    ),
    (
        "mask subtracts the wrong way round",
        REFERENCE.replace(
            "    return [(v - m) % p for v, m in zip(value_shares, mask_shares)]",
            "    return [(m - v) % p for v, m in zip(value_shares, mask_shares)]",
        ),
    ),
    (
        "open_value forgets the modulus",
        REFERENCE.replace("    return sum(shares) % p", "    return sum(shares)"),
    ),
    (
        "claims a Beaver multiplication needs no communication",
        REFERENCE.replace("    return 1", "    return 0"),
    ),
]


def _load(source: str) -> types.ModuleType:
    module = types.ModuleType("mut_beaver")
    exec(compile(source, "<mutation>", "exec"), module.__dict__)  # noqa: S102 - our own fixtures
    return module


def main() -> int:
    if run(_load(REFERENCE), SEED):
        print("FAIL reference implementation does not pass the hidden tests")
        return 1
    print("PASS reference implementation passes the hidden tests")

    survivors: list[str] = []
    for name, source in MUTATIONS:
        failures = run(_load(source), SEED)
        if failures:
            print(f"KILLED {name} ({failures[0]})")
        else:
            survivors.append(name)
            print(f"SURVIVED {name}")

    from verifier.server import evaluate  # noqa: PLC0415 - imported after sys.path

    if evaluate("combine", "def combine(c, a, b, d, e, p):\n    return list(c)\n"):
        survivors.append("verifier accepts a combine that ignores d and e")
        print("SURVIVED verifier accepts a combine that ignores d and e")
    else:
        print("KILLED verifier accepts a combine that ignores d and e")

    print()
    if survivors:
        print(f"{len(survivors)} mutation(s) survived:")
        for name in survivors:
            print(f"  - {name}")
        return 1
    print(f"All {len(MUTATIONS) + 1} mutations killed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
