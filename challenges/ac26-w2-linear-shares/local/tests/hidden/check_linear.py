"""Check canonical output elements, reconstruction, composition and communication class.

These tests compare algebraic identities on several seeded settings; they do not
prove privacy or a distributed protocol. Adding c to every share gives x+n*c and
is rejected when (n-1)*c is nonzero modulo p. Degenerate cases can coincide, and
any output with the required canonical elements, length and total is accepted.
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
        if not isinstance(actual, int) or isinstance(actual, bool) or actual < 0:
            failures.append(f"communication_rounds did not return a nonnegative integer for {operation}")
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
