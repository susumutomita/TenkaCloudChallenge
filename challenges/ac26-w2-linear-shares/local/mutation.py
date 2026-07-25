"""Mutation suite: break the reference on purpose, assert the hidden tests notice."""

from __future__ import annotations

import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tests.hidden.check_linear import run

SEED = "mutation-suite-seed"
REFERENCE = (Path(__file__).resolve().parent / "reference" / "linear.py").read_text("utf-8")

MUTATIONS: list[tuple[str, str]] = [
    (
        "constant folded into every share, giving x + n*c",
        REFERENCE.replace(
            "    return [(shares[0] + c) % p, *shares[1:]]",
            "    return [(s + c) % p for s in shares]",
        ),
    ),
    (
        "constant folded into two shares, giving x + 2c",
        REFERENCE.replace(
            "    return [(shares[0] + c) % p, *shares[1:]]",
            "    return [(shares[0] + c) % p, (shares[1] + c) % p, *shares[2:]]",
        ),
    ),
    (
        "scaling applied to one share only",
        REFERENCE.replace(
            "    return [(s * c) % p for s in shares]",
            "    return [(shares[0] * c) % p, *shares[1:]]",
        ),
    ),
    (
        "adding two sharings zips the wrong way and drops the modulus",
        REFERENCE.replace(
            "    return [(x + y) % p for x, y in zip(a, b)]",
            "    return [x + y for x, y in zip(a, b)]",
        ),
    ),
    (
        "claims multiplying two shared values also needs no communication",
        REFERENCE.replace('"mul-shared": 1}', '"mul-shared": 0}'),
    ),
    (
        "claims adding a public constant needs a round",
        REFERENCE.replace('"add-constant": 0,', '"add-constant": 2,'),
    ),
]


def _load(source: str) -> types.ModuleType:
    module = types.ModuleType("mut_linear")
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

    if evaluate("no-communication", '{"add-shared": 0, "add-constant": 0, "mul-constant": 0}'):
        survivors.append("verifier accepts a partial operation table")
        print("SURVIVED verifier accepts a partial operation table")
    else:
        print("KILLED verifier accepts a partial operation table")

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
