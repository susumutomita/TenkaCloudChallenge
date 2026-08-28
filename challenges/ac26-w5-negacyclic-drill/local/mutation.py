"""Author-side check: break the reference on purpose and confirm the hidden suite notices.

Every mutant below is a line a learner actually mistypes: the wrap with every reduction
counted as one flip too many, the constant term read without the flip, the boundary
searched only below n, the two bits swapped, the noise added instead of subtracted,
slide 44's condition taken literally (n - 3 instead of n - 3D). Each must be KILLED by
`tests/hidden/check_negacyclic_drill.py`.

The verifier-level mutations at the end cannot be expressed as a broken submission:
they check that the value grader itself refuses the near-misses a learner pastes — a
shown fixture value, another line's value, the NAND column where the constant terms
belong, a truncated tuple, a boolean, and another deployment's answer.
"""

from __future__ import annotations

import os
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from fixtures.generate import GRADED, setting  # noqa: E402
from tests.hidden import check_negacyclic_drill  # noqa: E402
from verifier.expected import expected_for  # noqa: E402

REFERENCE = (ROOT / "reference" / "negacyclic_drill.py").read_text(encoding="utf-8")
SEED = "mutation-suite-seed"

MUTATIONS: dict[str, tuple[str, str]] = {
    "params with q and n in each other's seats": (
        "    return (p, 2 * n, n, (2 * n) // p)",
        "    return (p, n, 2 * n, (2 * n) // p)",
    ),
    "wrap with every reduction counted as one flip too many": (
        "    return (total % n, 1 if (total // n) % 2 == 0 else -1, total)",
        "    return (total % n, -1 if (total // n) % 2 == 0 else 1, total)",
    ),
    "the constant term read without the flip": (
        "    return -v[wrapped - n]",
        "    return v[wrapped - n]",
    ),
    "the flip boundary off by one": (
        "    if wrapped < n:",
        "    if wrapped <= n:",
    ),
    "the boundary searched only below n": (
        "    return min(i for i in range(2 * n) if constant_at(v, i) < 0)",
        "    return min(i for i in range(n) if constant_at(v, i) < 0)",
    ),
    "the hazard read on the safe side": (
        "    return (lo + n, constant_at(v, lo + n))",
        "    return (lo, constant_at(v, lo))",
    ),
    "the two bits swapped": (
        "    return (p - 1, 1)",
        "    return (1, p - 1)",
    ),
    "the linear step with its sign flipped": (
        "    return tuple((1 - table[a] - table[b]) % p for a, b in ((0, 0), (0, 1), (1, 0), (1, 1)))",
        "    return tuple((table[a] + table[b] - 1) % p for a, b in ((0, 0), (0, 1), (1, 0), (1, 1)))",
    ),
    "the noise added instead of subtracted": (
        "    return tuple((delta * ph - total) % q for ph in phases(p))",
        "    return tuple((delta * ph + total) % q for ph in phases(p))",
    ),
    "the constants read at the phase, not the rotation": (
        "    return tuple(constant_at(v, rot) for rot in rotations(p, n, noise_a, noise_b))",
        "    return tuple(constant_at(v, rot) for rot in phases(p))",
    ),
    "AND left where NAND belongs": (
        "    return tuple(1 - (a & b) for a, b in ((0, 0), (0, 1), (1, 0), (1, 1)))",
        "    return tuple((a & b) for a, b in ((0, 0), (0, 1), (1, 0), (1, 1)))",
    ),
    "the sweep with the encoding upside down": (
        "        constant_at(v, (delta * ph - d) % q) == (1 if bit else -1)",
        "        constant_at(v, (delta * ph - d) % q) == (-1 if bit else 1)",
    ),
    "slide 44's condition taken literally": (
        "    return n - 3 * delta",
        "    return n - 3",
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
    module = types.ModuleType("negacyclic_drill_mutant")
    exec(compile(source, "negacyclic_drill_mutant", "exec"), module.__dict__)  # noqa: S102 - author tooling
    return module


def main() -> int:
    survivors: list[str] = []

    reference = _load(REFERENCE)
    failures = check_negacyclic_drill.run(reference, SEED)
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
            failures = check_negacyclic_drill.run(mutant, SEED)
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
    q = 2 * pub["n"]
    delta = q // pub["p"]
    near_misses = {
        "params accepts q and n swapped": (
            "params",
            _different(exp["params"], [pub["p"], pub["n"], q, delta], [0, 0, 0, 0]),
        ),
        "wrap accepts the pair without the unreduced exponent": ("wrap", list(exp["wrap"][:2])),
        "signs accepts the probes themselves": (
            "signs",
            _different(exp["signs"], list(pub["probes"]), [0, 0, 0, 0, 0, 0]),
        ),
        "signs accepts one value short": ("signs", list(exp["signs"][:5])),
        "boundary accepts 2n": ("boundary", 2 * pub["n"]),
        "boundary accepts a boolean": ("boundary", True),
        "hazard accepts the safe-side read": ("hazard", [pub["low_probe"], 1]),
        "rotations accepts the phases": (
            "rotations",
            _different(exp["rotations"], list(exp["phases"]), [0, 0, 0, 0]),
        ),
        "constants accepts the NAND column": ("constants", list(exp["nand"])),
        "margin accepts the boundary n": ("margin", pub["n"]),
        "margin accepts slide 44's literal n - 3": (
            "margin",
            _different(exp["margin"], pub["n"] - 3, -1),
        ),
        "another deployment's wrap": (
            "wrap",
            _different(exp["wrap"], list(other["wrap"]), [0, 0, 0]),
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
