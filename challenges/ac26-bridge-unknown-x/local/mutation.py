"""Author-side check: break the reference on purpose and confirm the hidden suite notices.

Every mutant below is a line a learner actually mistypes: the cover never laid on, the
cover counted once instead of twice (three separate places invite that one), the
candidate count done without the wrap, the school-algebra expansion missing its cross
terms, the wall compared against 2x instead of x². Each must be KILLED by
`tests/hidden/check_unknown_x_drill.py`.

The verifier-level mutations at the end cannot be expressed as a broken submission:
they check that the value grader itself refuses the near-misses a learner pastes — a
shown fixture value, the plain pair where the covered pair belongs, the returned sum
unopened, the "surely it narrows to one" guess, a truncated tuple, a boolean, and
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
from tests.hidden import check_unknown_x_drill  # noqa: E402
from verifier.expected import expected_for  # noqa: E402

REFERENCE = (ROOT / "reference" / "unknown_x_drill.py").read_text(encoding="utf-8")
SEED = "mutation-suite-seed"

MUTATIONS: dict[str, tuple[str, str]] = {
    "the cover never laid on": (
        "    return (a + x, b + x)",
        "    return (a, b)",
    ),
    "the holder's sum replaced by the plain sum": (
        "    return (a + x) + (b + x)",
        "    return a + b",
    ),
    "the plain-side total with the cover counted once": (
        "    return (a + b) + 2 * x",
        "    return (a + b) + x",
    ),
    "the sameness check with one side miscopied": (
        "    return sum_covered(a, b, x) == sum_plain(a, b, x)",
        "    return sum_covered(a, b, x) == sum_plain(a, b, x) + x",
    ),
    "the gap taken the wrong way round": (
        "    return (a + x) - (b + x)",
        "    return (b + x) - (a + x)",
    ),
    "the huge comparison with the cover counted once on the right": (
        "    return ((a + huge) + (b + huge)) - ((a + b) + 2 * huge)",
        "    return ((a + huge) + (b + huge)) - ((a + b) + huge)",
    ),
    "the held pair carrying one cover instead of two": (
        "    return ((a + x) + (b + x), 2 * x)",
        "    return ((a + x) + (b + x), x)",
    ),
    "the recovery subtracting the cover once": (
        "    return ((a + x) + (b + x)) - 2 * x",
        "    return ((a + x) + (b + x)) - x",
    ),
    "the candidate count without the wrap": (
        "    return sum(1 for ca in range(n) if any((ca + cx) % n == observed for cx in range(n)))",
        "    return sum(1 for ca in range(n) if any(ca + cx == observed for cx in range(n)))",
    ),
    "the expansion missing its cross terms": (
        "    without_square = a * b + (a + b) * x",
        "    without_square = a * b + x * x",
    ),
    "the wall compared against 2x": (
        "    return product(a, b, x)[2] == x * x",
        "    return product(a, b, x)[2] == 2 * x",
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
    module = types.ModuleType("unknown_x_drill_mutant")
    exec(compile(source, "unknown_x_drill_mutant", "exec"), module.__dict__)  # noqa: S102 - author tooling
    return module


def main() -> int:
    survivors: list[str] = []

    reference = _load(REFERENCE)
    failures = check_unknown_x_drill.run(reference, SEED)
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
            failures = check_unknown_x_drill.run(mutant, SEED)
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

    pub = setting(SEED)["public"]
    exp = expected_for(SEED)
    other = expected_for("another-deployment")
    near_misses = {
        "covered accepts the plain pair": (
            "covered",
            _different(exp["covered"], [pub["a"], pub["b"]], [0, 0]),
        ),
        "covered accepts one value short": ("covered", list(exp["covered"][:1])),
        "sum-covered accepts the plain total": (
            "sum-covered",
            _different(exp["sum-covered"], pub["a"] + pub["b"], -1),
        ),
        "sum-plain accepts the total with one cover": (
            "sum-plain",
            _different(exp["sum-plain"], pub["a"] + pub["b"] + pub["x"], -1),
        ),
        "huge accepts the huge cover itself": ("huge", pub["huge"]),
        "huge accepts a boolean": ("huge", True),
        "held accepts a single cover": (
            "held",
            _different(exp["held"], [exp["held"][0], pub["x"]], [0, 0]),
        ),
        "recover accepts the returned sum unopened": (
            "recover",
            _different(exp["recover"], exp["held"][0], -1),
        ),
        "guesses accepts the one narrowed candidate": ("guesses", 1),
        "gap accepts the difference the wrong way round": ("gap", -exp["gap"]),
        "guesses accepts zero": ("guesses", 0),
        "product accepts the pair without the leftover": ("product", list(exp["product"][:2])),
        "product accepts a leftover of zero": (
            "product",
            [exp["product"][0], exp["product"][1], 0],
        ),
        "another deployment's held": (
            "held",
            _different(exp["held"], list(other["held"]), [0, 0]),
        ),
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
