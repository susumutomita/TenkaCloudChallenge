"""Author-side check: break the reference on purpose and confirm the hidden suite notices.

Every mutant below is a line a learner actually mistypes: the MLE with the table swapped,
the wiring selector on the wrong corner, p1 without its square, the fudge attached to t
instead of (1 - t), the miss list counted from 2. Each must be KILLED by
`tests/hidden/check_sumcheck_drill.py`.

The verifier-level mutations at the end cannot be expressed as a broken submission: they
check that the value grader itself refuses the near-misses a learner pastes — a shown
fixture value, another line's value, an unsorted miss list, a truncated tuple, a boolean,
and another deployment's answer.
"""

from __future__ import annotations

import os
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from fixtures.generate import GRADED, setting  # noqa: E402
from tests.hidden import check_sumcheck_drill  # noqa: E402
from verifier.expected import expected_for  # noqa: E402

REFERENCE = (ROOT / "reference" / "sumcheck_drill.py").read_text(encoding="utf-8")
SEED = "mutation-suite-seed"

MUTATIONS: dict[str, tuple[str, str]] = {
    "layer multiplies the first pair too": (
        "    y0 = (x1 + x2) % p",
        "    y0 = (x1 * x2) % p",
    ),
    "MLE with the table swapped": (
        "    return (y0 * (1 - z) + y1 * z) % p",
        "    return (y1 * (1 - z) + y0 * z) % p",
    ),
    "wiring selector on the wrong corner": (
        "    return ((1 - a) * b * (w1(y0, y1, a, p) + w1(y0, y1, b, p))) % p",
        "    return (a * (1 - b) * (w1(y0, y1, a, p) + w1(y0, y1, b, p))) % p",
    ),
    "round1 without the square": (
        "    return (c0 + c1 * r1 + c2 * r1 * r1) % p",
        "    return (c0 + c1 * r1 + c2 * r1) % p",
    ),
    "final check evaluates g0 with its arguments swapped": (
        "    return (p2(r2), g0(y0, y1, r1, r2, p))",
        "    return (p2(r2), g0(y0, y1, r2, r1, p))",
    ),
    "the lie attached to t instead of (1 - t)": (
        "    p1c = lambda t: (c0 + c1 * t + c2 * t * t + d * (1 - t)) % p  # noqa: E731",
        "    p1c = lambda t: (c0 + c1 * t + c2 * t * t + d * t) % p  # noqa: E731",
    ),
    "the cover-up ignores m": (
        "    p2c = lambda t: (p2(t) + sh * (1 - t) + m * t * (1 - t)) % p  # noqa: E731\n    return ((p2c(0) + p2c(1)) % p, p2c(r2), g0(y0, y1, r1, r2, p))",
        "    p2c = lambda t: (p2(t) + sh * (1 - t)) % p  # noqa: E731\n    return ((p2c(0) + p2c(1)) % p, p2c(r2), g0(y0, y1, r1, r2, p))",
    ),
    "miss points counted from 2": (
        "    return sorted(t for t in range(p) if p2c(t) == g0(y0, y1, r1, t, p))",
        "    return sorted(t for t in range(2, p) if p2c(t) == g0(y0, y1, r1, t, p))",
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
    module = types.ModuleType("sumcheck_drill_mutant")
    exec(compile(source, "sumcheck_drill_mutant", "exec"), module.__dict__)  # noqa: S102 - author tooling
    return module


def main() -> int:
    survivors: list[str] = []

    reference = _load(REFERENCE)
    failures = check_sumcheck_drill.run(reference, SEED)
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
            failures = check_sumcheck_drill.run(mutant, SEED)
        except Exception as error:  # noqa: BLE001 - a crashing mutant is killed
            failures = [f"raised {type(error).__name__}"]
        if failures:
            print(f"KILLED   {name}")
        else:
            print(f"SURVIVED {name}")
            survivors.append(name)

    # Verifier-level: the value grader must refuse what a learner would paste by mistake.
    os.environ["FLAG_SEED"] = SEED
    from verifier.expected import expected_for  # noqa: PLC0415 - imported after sys.path and env
    from verifier.server import evaluate  # noqa: PLC0415 - imported after sys.path and env

    pub = setting(SEED)["public"]
    exp = expected_for(SEED)
    other = expected_for("another-deployment")
    near_misses = {
        "circuit accepts the inputs themselves": ("circuit", [pub["x1"], pub["x2"], pub["x3"]]),
        "mle accepts the circuit triple": ("mle", _different(exp["mle"], list(exp["circuit"]), [0, 0, 0])),
        "grid accepts a truncated pair": ("grid", [exp["grid"][0], exp["grid"][1]]),
        "round1 accepts the claim (the p1 sum)": ("round1", _different(exp["round1"], exp["p1-sum"], exp["round1"] + 1)),
        "round1 accepts the shown r1": ("round1", _different(exp["round1"], pub["r1"], exp["round1"] + 1)),
        "final-check accepts a single value": ("final-check", str(exp["final-check"][0])),
        "lie accepts the honest pair": ("lie", _different(exp["lie"], [exp["p1-sum"], exp["round1"]], [0, 0])),
        "lie-caught accepts the honest triple": (
            "lie-caught",
            _different(exp["lie-caught"], [exp["p2-sum"], exp["final-check"][0], exp["final-check"][1]], [0, 0, 0]),
        ),
        "miss-points accepts [1] alone": ("miss-points", [1]),
        "miss-points accepts the unsorted pair": (
            "miss-points",
            _different(exp["miss-points"], [exp["miss-points"][1], exp["miss-points"][0]], [0, 0]),
        ),
        "a boolean is not an integer": ("round1", True),
        "another deployment's miss points": ("miss-points", _different(exp["miss-points"], list(other["miss-points"]), [0, 0])),
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
