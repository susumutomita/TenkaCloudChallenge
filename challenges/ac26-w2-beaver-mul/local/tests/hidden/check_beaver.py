"""Hidden tests. Run by /verify against a copy of the learner's beaver.py.

The check that matters most is on `combine`, and it is not "does it reconstruct".
The d*e term is a public constant arriving mid-protocol, so the natural mistake is
to fold it into every share -- giving a sharing of x*y + (n-1)*d*e. That is:

  * exactly correct at n = 1,
  * exactly correct whenever d or e happens to be 0,

so a fixture where either mask coincides with its input would pass the wrong answer.
`fixtures.generate.setting` forces d != 0 and e != 0 for exactly that reason, and the
wrong total is named explicitly here rather than being left to inequality alone.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fixtures.generate import (  # noqa: E402
    OPERATIONS,
    reconstruct,
    setting,
    shares_of,
    triple_shares,
)

LABELS = ("h0", "h1", "h2", "h3")
EXPECTED_ROUNDS = {"mask": 0, "open": 1, "combine": 0, "beaver-multiply": 1}


def _valid(result: object, n: int, p: int) -> bool:
    return (
        isinstance(result, list)
        and len(result) == n
        and all(isinstance(v, int) and not isinstance(v, bool) and 0 <= v < p for v in result)
    )


def _case(seed: str, label: str):
    cfg = setting(seed, label)
    n, p = cfg["n"], cfg["p"]
    triple = triple_shares(seed, label)
    sx = shares_of(seed, f"{label}-x", cfg["x"], n, p)
    sy = shares_of(seed, f"{label}-y", cfg["y"], n, p)
    return cfg, triple, sx, sy


def check_mask(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        cfg, triple, sx, _sy = _case(seed, label)
        p, n = cfg["p"], cfg["n"]
        try:
            out = module.mask(list(sx), list(triple["a"]), p)
        except Exception as error:  # noqa: BLE001
            return [f"mask raised {type(error).__name__}"]
        if not _valid(out, n, p):
            failures.append("mask did not return one field element per party")
            continue
        if reconstruct(out, p) != (cfg["x"] - cfg["a"]) % p:
            failures.append("masking does not reconstruct to value minus mask")
    return failures


def check_open(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        cfg, _triple, sx, _sy = _case(seed, label)
        p = cfg["p"]
        try:
            value = module.open_value(list(sx), p)
        except Exception as error:  # noqa: BLE001
            return [f"open_value raised {type(error).__name__}"]
        if not isinstance(value, int) or isinstance(value, bool) or not 0 <= value < p:
            failures.append("open_value did not return a canonical field element")
        elif value != cfg["x"] % p:
            failures.append("open_value does not return the shared value")
    return failures


def check_combine(module, seed: str) -> list[str]:
    """The heart of it: a valid sharing of x*y, with d*e folded in exactly once."""
    failures: list[str] = []
    for label in LABELS:
        cfg, triple, sx, sy = _case(seed, label)
        p, n, x, y = cfg["p"], cfg["n"], cfg["x"], cfg["y"]
        d = (x - cfg["a"]) % p
        e = (y - cfg["b"]) % p
        if d == 0 or e == 0:
            # `setting` forces both to be non-zero, so reaching here means the fixture
            # generator was changed and this case can no longer separate the two
            # answers. Say so instead of skipping, which would grade a wrong answer
            # as correct.
            failures.append("fixture is degenerate: d*e vanishes, so this case grades nothing")
            continue
        try:
            out = module.combine(
                list(triple["c"]), list(triple["a"]), list(triple["b"]), d, e, p
            )
        except Exception as error:  # noqa: BLE001
            return [f"combine raised {type(error).__name__}"]
        if not _valid(out, n, p):
            failures.append("combine did not return one field element per party")
            continue
        total = reconstruct(out, p)
        if total != (x * y) % p:
            failures.append("the combined sharing does not reconstruct to x * y")
        if n > 1 and total == (x * y + (n - 1) * d * e) % p:
            failures.append("the public product was folded into every share instead of one")
    return failures


def check_end_to_end(module, seed: str) -> list[str]:
    """The learner's own four pieces, run as the protocol actually runs."""
    failures: list[str] = []
    for label in LABELS:
        cfg, triple, sx, sy = _case(seed, label)
        p, n, x, y = cfg["p"], cfg["n"], cfg["x"], cfg["y"]
        try:
            d = module.open_value(module.mask(list(sx), list(triple["a"]), p), p)
            e = module.open_value(module.mask(list(sy), list(triple["b"]), p), p)
            out = module.combine(
                list(triple["c"]), list(triple["a"]), list(triple["b"]), d, e, p
            )
        except Exception as error:  # noqa: BLE001
            return [f"running the protocol end to end raised {type(error).__name__}"]
        if not _valid(out, n, p):
            failures.append("the protocol did not produce a valid sharing")
            continue
        if reconstruct(out, p) != (x * y) % p:
            failures.append("the protocol does not produce a sharing of x * y")
    return failures


def check_rounds(module, _seed: str) -> list[str]:
    try:
        actual = module.rounds()
    except Exception as error:  # noqa: BLE001
        return [f"rounds raised {type(error).__name__}"]
    if not isinstance(actual, int) or isinstance(actual, bool) or actual < 1:
        return ["a Beaver multiplication is classified as needing no communication"]
    return []


def run(module, seed: str) -> list[str]:
    return [
        *check_mask(module, seed),
        *check_open(module, seed),
        *check_combine(module, seed),
        *check_end_to_end(module, seed),
        *check_rounds(module, seed),
    ]
