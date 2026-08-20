"""Author-side check: break the reference on purpose and confirm the hidden suite notices.

Every mutant below is a line a learner actually mistypes: the odd part built from the
even coefficients, the fold with the halves swapped, the recovery dividing by x instead
of 2x, the miss list scanned over Y instead of x, the second fold using β again. Each
must be KILLED by `tests/hidden/check_fri_drill.py`.

The verifier-level mutations at the end cannot be expressed as a broken submission: they
check that the value grader itself refuses the near-misses a learner pastes — a shown
fixture value, another line's value, a swapped or truncated tuple, a boolean, and
another deployment's answer.
"""

from __future__ import annotations

import os
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from fixtures.generate import GRADED, setting  # noqa: E402
from tests.hidden import check_fri_drill  # noqa: E402

REFERENCE = (ROOT / "reference" / "fri_drill.py").read_text(encoding="utf-8")
SEED = "mutation-suite-seed"

MUTATIONS: dict[str, tuple[str, str]] = {
    "the odd part built from the even coefficients": (
        "def _qo(qs: tuple, Y: int, p: int) -> int:\n    return (qs[1] + qs[3] * Y) % p",
        "def _qo(qs: tuple, Y: int, p: int) -> int:\n    return (qs[1] + qs[2] * Y) % p",
    ),
    "the fold with the halves swapped": (
        "def _q1(qs: tuple, beta: int, Y: int, p: int) -> int:\n    return (_qe(qs, Y, p) + beta * _qo(qs, Y, p)) % p",
        "def _q1(qs: tuple, beta: int, Y: int, p: int) -> int:\n    return (_qo(qs, Y, p) + beta * _qe(qs, Y, p)) % p",
    ),
    "the second fold reuses beta": (
        "    return (c + beta2 * d) % p",
        "    return (c + beta * d) % p",
    ),
    "the query opens x and x instead of x and -x": (
        '    """Line 6 — the two openings (Q₀(x), Q₀(−x))."""\n    return (_q(qs, x, p), _q(qs, (-x) % p, p))',
        '    """Line 6 — the two openings (Q₀(x), Q₀(−x))."""\n    return (_q(qs, x, p), _q(qs, x, p))',
    ),
    "the recovery divides by x instead of 2x": (
        "    ro = (_q(qs, x, p) - _q(qs, (-x) % p, p)) * pow(2 * x, p - 2, p) % p",
        "    ro = (_q(qs, x, p) - _q(qs, (-x) % p, p)) * pow(x, p - 2, p) % p",
    ),
    "the consistency check forgets beta": (
        '    re, ro, _e, _o = recover(qs, x, p)\n    return ((re + beta * ro) % p, _q1(qs, beta, x * x % p, p))',
        '    re, ro, _e, _o = recover(qs, x, p)\n    return ((re + ro) % p, _q1(qs, beta, x * x % p, p))',
    ),
    "the swapped commitment forgets d1": (
        "    return ((re + beta * ro) % p, (_q1(qs, beta, xx, p) + d0 + d1 * xx) % p)",
        "    return ((re + beta * ro) % p, (_q1(qs, beta, xx, p) + d0) % p)",
    ),
    "the miss list scans Y instead of x": (
        "    return sorted(xx for xx in range(1, p) if (d0 + d1 * (xx * xx % p)) % p == 0)",
        "    return sorted(xx for xx in range(1, p) if (d0 + d1 * xx) % p == 0)",
    ),
}


def _canon(value):
    return tuple(value) if isinstance(value, (list, tuple)) else value


def _different(expected, *candidates):
    """The first near-miss that is not accidentally the right answer for this seed."""
    for candidate in candidates:
        if _canon(candidate) != _canon(expected):
            return candidate
    raise RuntimeError("every near-miss equals the expected value; pick another seed")


def _load(source: str) -> types.ModuleType:
    module = types.ModuleType("fri_drill_mutant")
    exec(compile(source, "fri_drill_mutant", "exec"), module.__dict__)  # noqa: S102 - author tooling
    return module


def main() -> int:
    survivors: list[str] = []

    reference = _load(REFERENCE)
    failures = check_fri_drill.run(reference, SEED)
    if failures:
        print("FAIL reference implementation fails the hidden tests:", failures)
        return 1
    print("PASS reference implementation passes the hidden tests")

    for name, (old, new) in MUTATIONS.items():
        if old not in REFERENCE:
            print(f"BROKEN mutation target not found: {name}")
            return 1
        mutant = _load(REFERENCE.replace(old, new, 1))
        try:
            failures = check_fri_drill.run(mutant, SEED)
        except Exception as error:  # noqa: BLE001 - a crashing mutant is killed
            failures = [f"raised {type(error).__name__}"]
        if failures:
            print(f"KILLED   {name}")
        else:
            print(f"SURVIVED {name}")
            survivors.append(name)

    # Verifier-level: the value grader must refuse what a learner would paste by mistake.
    os.environ["FLAG_SEED"] = SEED
    from verifier.server import evaluate  # noqa: PLC0415 - imported after sys.path and env

    cfg = setting(SEED)
    pub, exp = cfg["public"], cfg["expected"]
    other = setting("another-deployment")["expected"]
    near_misses = {
        "poly accepts the coefficients": ("poly", [pub["q0"], pub["q1"], pub["q2"]]),
        "fold accepts the unfolded poly values": ("fold", _different(exp["fold"], list(exp["poly"]), [0, 0, 0])),
        "fold2 accepts the shown beta2": ("fold2", _different(exp["fold2"], pub["beta2"], exp["fold2"] + 1)),
        "query accepts the swapped pair": (
            "query",
            _different(exp["query"], [exp["query"][1], exp["query"][0]], [0, 0]),
        ),
        "recover accepts only its first half": ("recover", [exp["recover"][0], exp["recover"][1]]),
        "consistency accepts the cheat's pair": (
            "consistency",
            _different(exp["consistency"], list(exp["cheat-caught"]), [0, 0]),
        ),
        "cheat-caught accepts the honest pair": (
            "cheat-caught",
            _different(exp["cheat-caught"], list(exp["consistency"]), [0, 0]),
        ),
        "miss-points accepts a single root": ("miss-points", [exp["miss-points"][0]]),
        "miss-points accepts another deployment's pair": (
            "miss-points",
            _different(exp["miss-points"], list(other["miss-points"]), [0, 0]),
        ),
        "a boolean is not an integer": ("fold2", True),
    }
    for name, (line, value) in near_misses.items():
        if evaluate(line, value):
            print(f"SURVIVED verifier: {name}")
            survivors.append(name)
        else:
            print(f"KILLED   verifier: {name}")
    for line in GRADED:
        value = exp[line]
        if not evaluate(line, list(value) if isinstance(value, tuple) else value):
            print(f"SURVIVED verifier: rejects the correct value for {line}")
            survivors.append(f"correct {line}")

    if survivors:
        print(f"{len(survivors)} mutation(s) survived.")
        return 1
    print(f"All {len(MUTATIONS) + len(near_misses)} mutations killed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
