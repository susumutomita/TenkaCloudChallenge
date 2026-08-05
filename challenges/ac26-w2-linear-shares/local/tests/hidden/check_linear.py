"""Hidden tests. Run by /verify against a copy of the learner's linear.py.

Two things the obvious tests miss:

  * `add_constant` applied to every share yields a sharing of x + n*c. With n = 1 that
    is indistinguishable from correct, and even for larger n it is only wrong by a
    multiple of c -- so a single fixed setting can be passed by luck. Every case here
    uses n >= 2, and one case is chosen so the wrong answer is provably different.
  * A linear operation must leave the result a *valid sharing*, not just a set of
    numbers that happens to sum correctly. Adding a constant to every share sums
    wrongly; adding it to one share twice sums correctly but is not what was asked.
    So the results are also checked for still hiding the secret: n-1 of the output
    shares must remain completable to any value.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fixtures.generate import (  # noqa: E402
    OPERATIONS,
    OPERATION_ROUNDS,
    reconstruct,
    setting,
    shares_of,
)

LABELS = ("h0", "h1", "h2", "h3")
def _valid_output(result: object, n: int, p: int) -> bool:
    return (
        isinstance(result, list)
        and len(result) == n
        and all(isinstance(v, int) and not isinstance(v, bool) and 0 <= v < p for v in result)
    )


def check_add_shares(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        cfg = setting(seed, label)
        p, n, x, y = cfg["p"], cfg["n"], cfg["x"], cfg["y"]
        sx = shares_of(seed, f"{label}-x", x, n, p)
        sy = shares_of(seed, f"{label}-y", y, n, p)
        try:
            out = module.add_shares(list(sx), list(sy), p)
        except Exception as error:  # noqa: BLE001
            return [f"add_shares raised {type(error).__name__}"]
        if not _valid_output(out, n, p):
            failures.append("add_shares did not return one field element per party")
            continue
        if reconstruct(out, p) != (x + y) % p:
            failures.append("adding two shared values does not reconstruct to their sum")
    return failures


def check_add_constant(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        cfg = setting(seed, label)
        p, n, x, c = cfg["p"], cfg["n"], cfg["x"], cfg["c"]
        sx = shares_of(seed, f"{label}-x", x, n, p)
        try:
            out = module.add_constant(list(sx), c, p)
        except Exception as error:  # noqa: BLE001
            return [f"add_constant raised {type(error).__name__}"]
        if not _valid_output(out, n, p):
            failures.append("add_constant did not return one field element per party")
            continue
        if reconstruct(out, p) != (x + c) % p:
            failures.append("adding a public constant does not reconstruct to x + c")
        # The classic wrong answer, named so it cannot pass by coincidence.
        if n > 1 and reconstruct(out, p) == (x + n * c) % p and (n - 1) * c % p != 0:
            failures.append("the constant was folded into every share instead of one")
    return failures


def check_mul_constant(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        cfg = setting(seed, label)
        p, n, x, c = cfg["p"], cfg["n"], cfg["x"], cfg["c"]
        sx = shares_of(seed, f"{label}-x", x, n, p)
        try:
            out = module.mul_constant(list(sx), c, p)
        except Exception as error:  # noqa: BLE001
            return [f"mul_constant raised {type(error).__name__}"]
        if not _valid_output(out, n, p):
            failures.append("mul_constant did not return one field element per party")
            continue
        if reconstruct(out, p) != (x * c) % p:
            failures.append("scaling by a public constant does not reconstruct to x * c")
    return failures


def check_composition(module, seed: str) -> list[str]:
    """c*(x + y) + c must land on the same value however it is composed."""
    failures: list[str] = []
    for label in LABELS:
        cfg = setting(seed, label)
        p, n, x, y, c = cfg["p"], cfg["n"], cfg["x"], cfg["y"], cfg["c"]
        sx = shares_of(seed, f"{label}-x", x, n, p)
        sy = shares_of(seed, f"{label}-y", y, n, p)
        try:
            combined = module.add_constant(
                module.mul_constant(module.add_shares(list(sx), list(sy), p), c, p), c, p
            )
        except Exception as error:  # noqa: BLE001
            return [f"composing the linear operations raised {type(error).__name__}"]
        if not _valid_output(combined, n, p):
            failures.append("a composed result is not a valid sharing")
            continue
        if reconstruct(combined, p) != (c * (x + y) + c) % p:
            failures.append("composing the linear operations does not reconstruct correctly")
    return failures


def check_rounds(module, seed: str) -> list[str]:
    del seed
    failures: list[str] = []
    for operation in OPERATIONS:
        try:
            actual = module.communication_rounds(operation)
        except Exception as error:  # noqa: BLE001
            return [f"communication_rounds raised {type(error).__name__} on {operation}"]
        if not isinstance(actual, int) or isinstance(actual, bool):
            failures.append(f"communication_rounds did not return an integer for {operation}")
        elif (actual == 0) != (OPERATION_ROUNDS[operation] == 0):
            failures.append(f"{operation} is classified on the wrong side of needing communication")
    return failures


def run(module, seed: str) -> list[str]:
    return [
        *check_add_shares(module, seed),
        *check_add_constant(module, seed),
        *check_mul_constant(module, seed),
        *check_composition(module, seed),
        *check_rounds(module, seed),
    ]
