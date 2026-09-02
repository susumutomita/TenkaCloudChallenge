"""Mutation suite: break the reference on purpose, assert the hidden tests notice."""

from __future__ import annotations

import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures.generate import setting
from tests.hidden.check_sharing import check_line_pairs, check_line_privacy, run

SEED = "mutation-suite-seed"
REFERENCE = (Path(__file__).resolve().parent / "reference" / "sharing.py").read_text("utf-8")
STARTER = (Path(__file__).resolve().parent / "starter" / "sharing.py").read_text("utf-8")


def _replace(source: str, old: str, new: str) -> str:
    """Substitute exactly one occurrence, so a reference edit cannot silently turn a
    mutation into an unmodified copy that then 'survives'."""
    if source.count(old) != 1:
        raise SystemExit(f"mutation anchor not found exactly once: {old!r}")
    return source.replace(old, new)


MUTATIONS: list[tuple[str, str]] = [
    (
        "hands the whole secret to party 0",
        _replace(
            REFERENCE,
            '''    head = [r % p for r in randomness[: n - 1]]
    return [*head, (secret - sum(head)) % p]''',
            "    return [secret % p] + [0] * (n - 1)",
        ),
    ),
    (
        "shares are not reduced into the field",
        _replace(
            REFERENCE,
            '''    head = [r % p for r in randomness[: n - 1]]
    return [*head, (secret - sum(head)) % p]''',
            '''    head = [r % p for r in randomness[: n - 1]]
    return [*head, secret - sum(head)]''',
        ),
    ),
    (
        "completion only works for the one secret it was built from",
        _replace(
            REFERENCE,
            "    return (secret - sum(partial)) % p",
            "    return (0 - sum(partial)) % p",
        ),
    ),
    (
        "rerandomize offsets do not cancel, so the secret moves",
        _replace(
            REFERENCE,
            '''    offsets = [r % p for r in randomness[: len(shares) - 1]]
    offsets.append((-sum(offsets)) % p)''',
            '    offsets = [r % p for r in randomness[: len(shares) - 1]] + [1]',
        ),
    ),
    (
        "rerandomize returns the shares untouched",
        _replace(
            REFERENCE,
            "    return [(s + o) % p for s, o in zip(shares, offsets)]",
            "    return list(shares)",
        ),
    ),
    (
        "reconstruct forgets the modulus",
        _replace(REFERENCE, "    return sum(shares) % p", "    return sum(shares)"),
    ),
]

#: two-of-three mutants. Each is a self-consistent pair (its own share_line and
#: reconstruct_line agree with each other), so only a *property* can reject it: the
#: privacy ones pass every pair check, the pair ones keep the reference privacy.
LINE_MUTATIONS: list[tuple[str, str]] = [
    (
        "line: every party gets a copy of the secret (the starter's shape)",
        _replace(
            _replace(
                REFERENCE,
                "    return [[x, (secret + r * x) % p] for x in (1, 2, 3)]",
                "    return [[x, secret % p] for x in (1, 2, 3)]",
            ),
            "    return (y1 - slope * x1) % p",
            "    return y1 % p",
        ),
    ),
    (
        "line: party 1 is handed the secret itself (line through (1, secret), walked back to x = 1)",
        _replace(
            _replace(
                REFERENCE,
                "    return [[x, (secret + r * x) % p] for x in (1, 2, 3)]",
                "    return [[x, (secret + r * (x - 1)) % p] for x in (1, 2, 3)]",
            ),
            "    return (y1 - slope * x1) % p",
            "    return (y1 - slope * (x1 - 1)) % p",
        ),
    ),
    (
        "line: the slope uses only one bit of the randomness",
        _replace(REFERENCE, "    r = randomness[0] % p", "    r = randomness[0] % 2"),
    ),
    (
        "line: reconstruct never walks back (returns the first point's y)",
        _replace(REFERENCE, "    return (y1 - slope * x1) % p", "    return y1 % p"),
    ),
    (
        "line: the slope is divided with // instead of the partner that multiplies to 1",
        _replace(
            REFERENCE,
            "    slope = ((y2 - y1) % p) * _partner((x2 - x1) % p, p) % p",
            "    slope = ((y2 - y1) // (x2 - x1)) % p",
        ),
    ),
    (
        "line: reconstruct assumes the first point is party 1's",
        _replace(
            REFERENCE,
            "    x1, y1 = two_points[0]\n",
            "    x1, y1 = 1, two_points[0][1]\n",
        ),
    ),
    (
        "line: reconstruct forgets the final modulus",
        _replace(REFERENCE, "    return (y1 - slope * x1) % p", "    return y1 - slope * x1"),
    ),
    (
        "line: the modulus is hard-coded to this deployment's public p",
        _replace(
            REFERENCE,
            "def reconstruct_line(two_points: list[list[int]], p: int) -> int:\n",
            "def reconstruct_line(two_points: list[list[int]], _p: int) -> int:\n"
            f"    p = {setting(SEED)['p']}\n",
        ),
    ),
]

#: Goes through the verifier rather than in-process: on the ~10^4 moduli it does not
#: finish, and the verifier's time limit is the property that rejects it.
BRUTE_FORCE_LINE = _replace(
    REFERENCE,
    '''    x1, y1 = two_points[0]
    x2, y2 = two_points[1]
    slope = ((y2 - y1) % p) * _partner((x2 - x1) % p, p) % p
    return (y1 - slope * x1) % p''',
    '''    x1, y1 = two_points[0]
    x2, y2 = two_points[1]
    for candidate in range(p):
        for slope in range(p):
            if (candidate + slope * x1) % p == y1 and (candidate + slope * x2) % p == y2:
                return candidate
    return 0''',
)


def _load(source: str) -> types.ModuleType:
    module = types.ModuleType("mut_sharing")
    exec(compile(source, "<mutation>", "exec"), module.__dict__)  # noqa: S102 - our own fixtures
    return module


def _line_failures(module: types.ModuleType) -> list[str]:
    return [*check_line_pairs(module, SEED), *check_line_privacy(module, SEED)]


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

    for name, source in LINE_MUTATIONS:
        failures = _line_failures(_load(source))
        if failures:
            print(f"KILLED {name} ({failures[0]})")
        else:
            survivors.append(name)
            print(f"SURVIVED {name}")

    from verifier.server import evaluate, evaluate_with_message  # noqa: PLC0415 - after sys.path

    # Naming the threshold without two distinct witnesses demonstrates nothing.
    if evaluate("threshold", '{"sharesNeeded": 2, "partial": [1], "completions": []}'):
        survivors.append("verifier accepts a threshold answer with no witnesses")
        print("SURVIVED verifier accepts a threshold answer with no witnesses")
    else:
        print("KILLED verifier accepts a threshold answer with no witnesses")

    # The starter's two-of-three shape passes the public tests and must not pass /verify.
    correct, message = evaluate_with_message("two-of-three", STARTER)
    if correct:
        survivors.append("verifier accepts the starter's copy-to-everyone line split")
        print("SURVIVED verifier accepts the starter's copy-to-everyone line split")
    else:
        print(f"KILLED verifier accepts the starter's copy-to-everyone line split ({message})")

    # Trying every (secret, slope) pair is correct and far too slow on the large moduli.
    # This one waits out the verifier's time limit, so it is the slow step of the suite.
    correct, message = evaluate_with_message("two-of-three", BRUTE_FORCE_LINE)
    if correct:
        survivors.append("line: reconstruct tries every (secret, slope) pair")
        print("SURVIVED line: reconstruct tries every (secret, slope) pair")
    else:
        print(f"KILLED line: reconstruct tries every (secret, slope) pair ({message})")

    if not evaluate("two-of-three", REFERENCE):
        survivors.append("reference two-of-three rejected by the verifier")
        print("FAIL reference two-of-three rejected by the verifier")
    else:
        print("PASS reference two-of-three passes through the verifier")

    print()
    if survivors:
        print(f"{len(survivors)} mutation(s) survived:")
        for name in survivors:
            print(f"  - {name}")
        return 1
    print(f"All {len(MUTATIONS) + len(LINE_MUTATIONS) + 3} mutations killed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
