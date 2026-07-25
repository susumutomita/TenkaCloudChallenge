"""Mutation suite: break the reference on purpose, assert the hidden tests notice."""

from __future__ import annotations

import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tests.hidden.check_sharing import run

SEED = "mutation-suite-seed"
REFERENCE = (Path(__file__).resolve().parent / "reference" / "sharing.py").read_text("utf-8")

MUTATIONS: list[tuple[str, str]] = [
    (
        "hands the whole secret to party 0",
        REFERENCE.replace(
            '''    head = [r % p for r in randomness[: n - 1]]
    return [*head, (secret - sum(head)) % p]''',
            "    return [secret % p] + [0] * (n - 1)",
        ),
    ),
    (
        "shares are not reduced into the field",
        REFERENCE.replace(
            '''    head = [r % p for r in randomness[: n - 1]]
    return [*head, (secret - sum(head)) % p]''',
            '''    head = [r % p for r in randomness[: n - 1]]
    return [*head, secret - sum(head)]''',
        ),
    ),
    (
        "completion only works for the one secret it was built from",
        REFERENCE.replace(
            "    return (secret - sum(partial)) % p",
            "    return (0 - sum(partial)) % p",
        ),
    ),
    (
        "rerandomize offsets do not cancel, so the secret moves",
        REFERENCE.replace(
            '''    offsets = [r % p for r in randomness[: len(shares) - 1]]
    offsets.append((-sum(offsets)) % p)''',
            '    offsets = [r % p for r in randomness[: len(shares) - 1]] + [1]',
        ),
    ),
    (
        "rerandomize returns the shares untouched",
        REFERENCE.replace(
            "    return [(s + o) % p for s, o in zip(shares, offsets)]",
            "    return list(shares)",
        ),
    ),
    (
        "reconstruct forgets the modulus",
        REFERENCE.replace("    return sum(shares) % p", "    return sum(shares)"),
    ),
]


def _load(source: str) -> types.ModuleType:
    module = types.ModuleType("mut_sharing")
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

    # Naming the threshold without two distinct witnesses demonstrates nothing.
    if evaluate("threshold", '{"sharesNeeded": 2, "partial": [1], "completions": []}'):
        survivors.append("verifier accepts a threshold answer with no witnesses")
        print("SURVIVED verifier accepts a threshold answer with no witnesses")
    else:
        print("KILLED verifier accepts a threshold answer with no witnesses")

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
