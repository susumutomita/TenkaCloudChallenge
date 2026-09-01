"""Author-side check: break the reference on purpose and confirm the hidden suite notices.

Every mutant below is a line a learner actually mistypes: the wrap never taken, the
wrap forgotten on the left side of the add and mul comparisons, the cover subtracted where it
should be added (and added where it should be subtracted), the cover table counted
without the wrap, the leak's difference taken the wrong way round. Each must be
KILLED by `tests/hidden/check_clock_drill.py`.

The verifier-level mutations at the end cannot be expressed as a broken submission:
they check that the value grader itself refuses the near-misses a learner pastes — a
shown fixture value, the secret where the covered value belongs, the candidates where
their counts belong, a truncated tuple, a boolean, and another deployment's answer.
"""

from __future__ import annotations

import os
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from fixtures.generate import GRADED, setting  # noqa: E402
from tests.hidden import check_clock_drill  # noqa: E402
from verifier.expected import expected_for  # noqa: E402

REFERENCE = (ROOT / "reference" / "clock_drill.py").read_text(encoding="utf-8")
SEED = "mutation-suite-seed"

MUTATIONS: dict[str, tuple[str, str]] = {
    "the wrap never taken": (
        "    return (u % n, v % n)",
        "    return (u, v)",
    ),
    "the add line with the left side never wrapped": (
        "    return ((u + v) % n, (u % n + v % n) % n, ((u + v) % n) - ((u % n + v % n) % n))",
        "    return (u + v, (u % n + v % n) % n, (u + v) - ((u % n + v % n) % n))",
    ),
    "the mul line with the left side never wrapped": (
        "    return ((u * v) % n, (u % n) * (v % n) % n, ((u * v) % n) - ((u % n) * (v % n) % n))",
        "    return (u * v, (u % n) * (v % n) % n, (u * v) - ((u % n) * (v % n) % n))",
    ),
    "the cover laid on without the wrap": (
        "    return (secret + cover) % n",
        "    return secret + cover",
    ),
    "the cover added again instead of subtracted": (
        "    return (covered(secret, cover, n) - cover) % n",
        "    return (covered(secret, cover, n) + cover) % n",
    ),
    "the cover table counted without the wrap": (
        "    return [sum(1 for c in range(n) if (cand + c) % n == observed) for cand in range(n)]",
        "    return [sum(1 for c in range(n) if cand + c == observed) for cand in range(n)]",
    ),
    "the total replaced by one candidate's count": (
        "    return sum(_table(secret, cover, n))",
        "    return _table(secret, cover, n)[0]",
    ),
    "the reused cover subtracted from the second message": (
        "    return (covered(secret, cover, n), (second + cover) % n)",
        "    return (covered(secret, cover, n), (second - cover) % n)",
    ),
    "the leak's difference taken the wrong way round": (
        "    return (first - twice) % n",
        "    return (twice - first) % n",
    ),
    "the closing check against the reversed gap": (
        "    return leak(secret, second, cover, n) == (secret - second) % n",
        "    return leak(secret, second, cover, n) == (second - secret) % n",
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
    module = types.ModuleType("clock_drill_mutant")
    exec(compile(source, "clock_drill_mutant", "exec"), module.__dict__)  # noqa: S102 - author tooling
    return module


def main() -> int:
    survivors: list[str] = []

    reference = _load(REFERENCE)
    failures = check_clock_drill.run(reference, SEED)
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
            failures = check_clock_drill.run(mutant, SEED)
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
    covered_value = exp["cover"]
    near_misses = {
        "add accepts the pair without the difference": ("add", list(exp["add"][:2])),
        "mul accepts the add line's value": (
            "mul",
            _different(exp["mul"], list(exp["add"]), [0, 0, 1]),
        ),
        "cover accepts the secret itself": ("cover", pub["secret"]),
        "cover accepts the unwrapped sum": (
            "cover",
            _different(covered_value, pub["secret"] + pub["cover"], -1),
        ),
        "uncover accepts the covered value": ("uncover", covered_value),
        "every accepts the candidates themselves": (
            "every",
            _different(
                exp["every"],
                [pub["secret"], (pub["secret"] + 1) % pub["n"], (covered_value + 3) % pub["n"]],
                [0, 0, 0],
            ),
        ),
        "every accepts one value short": ("every", list(exp["every"][:2])),
        "count accepts the single cover count": ("count", 1),
        "count accepts a boolean": ("count", True),
        "reuse accepts the two secrets": (
            "reuse",
            _different(exp["reuse"], [pub["secret"], pub["second"]], [0, 0]),
        ),
        "leak accepts the unwrapped gap": (
            "leak",
            _different(exp["leak"], pub["secret"] - pub["second"], exp["leak"] + pub["n"]),
        ),
        "another deployment's leak": (
            "leak",
            _different(exp["leak"], other["leak"], exp["leak"] - pub["n"]),
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
