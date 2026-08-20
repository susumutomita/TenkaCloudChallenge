"""Author-side check: break the reference on purpose and confirm the hidden suite notices.

Every mutant below is a line a learner actually mistypes: the multiplication gate written
as an addition, the address column factor off by one, a forgotten σ swap, the fingerprint
without its reduction, the miss count started at β = 0. Each must be KILLED by
`tests/hidden/check_plonk_drill.py`.

The verifier-level mutations at the end cannot be expressed as a broken submission: they
check that the value grader itself refuses the near-misses a learner pastes — a shown
fixture value, another line's value, the un-permuted address list, a swapped pair, a
boolean, and another deployment's answer.
"""

from __future__ import annotations

import os
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from fixtures.generate import GRADED, setting  # noqa: E402
from tests.hidden import check_plonk_drill  # noqa: E402

REFERENCE = (ROOT / "reference" / "plonk_drill.py").read_text(encoding="utf-8")
SEED = "mutation-suite-seed"

MUTATIONS: dict[str, tuple[str, str]] = {
    "the multiplication gate written as an addition": (
        "    o1 = (a1 * b1) % p",
        "    o1 = (a1 + b1) % p",
    ),
    "the lying row shifts the input but not the output": (
        "    return ((o0 + g) % p, o1, (o0 + g + o1) % p)",
        "    return ((o0 + g) % p, o1, (o0 + o1) % p)",
    ),
    "the address column factor off by one": (
        "    return tuple((pow(w, r, q) * (c + 1)) % q for r in range(3) for c in range(3))",
        "    return tuple((pow(w, r, q) * c) % q for r in range(3) for c in range(3))",
    ),
    "sigma with the second swap forgotten": (
        "    (0, 1): (0, 1), (1, 1): (1, 1), (2, 1): (1, 2),\n    (0, 2): (2, 0), (1, 2): (2, 1), (2, 2): (2, 2),",
        "    (0, 1): (0, 1), (1, 1): (1, 1), (2, 1): (2, 1),\n    (0, 2): (2, 0), (1, 2): (1, 2), (2, 2): (2, 2),",
    ),
    "the fingerprint without its reduction": (
        "    return tuple((v + beta * a + gamma) % q for v, a in zip(vals[:3], addr[:3]))",
        "    return tuple((v + beta * a + gamma) for v, a in zip(vals[:3], addr[:3]))",
    ),
    "the grand product compared without the final reduction": (
        "    f = math.prod((v + beta * a + gamma) % q for v, a in zip(vals, addresses(w, q))) % q",
        "    f = math.prod((v + beta * a + gamma) % q for v, a in zip(vals, addresses(w, q)))",
    ),
    "the bad product computed on the honest table": (
        '    """Line 10 — the same two products on the lying table."""\n    return grand_product(bad, w, q, beta, gamma)',
        '    """Line 10 — the same two products on the lying table."""\n    return grand_product([bad[0], bad[1], (bad[0][2], bad[1][2], (bad[0][2] + bad[1][2]))], w, q, beta, gamma)',
    ),
    "the miss count started at beta = 0": (
        "    for b in range(1, q):",
        "    for b in range(q):",
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
    module = types.ModuleType("plonk_drill_mutant")
    exec(compile(source, "plonk_drill_mutant", "exec"), module.__dict__)  # noqa: S102 - author tooling
    return module


def main() -> int:
    survivors: list[str] = []

    reference = _load(REFERENCE)
    failures = check_plonk_drill.run(reference, SEED)
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
            failures = check_plonk_drill.run(mutant, SEED)
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
        "outputs accepts the inputs": ("outputs", [pub["a0"], pub["b0"], pub["a1"]]),
        "bad-row accepts the honest gate-2 row": (
            "bad-row",
            _different(exp["bad-row"], [exp["outputs"][0], exp["outputs"][1], exp["outputs"][2]], [0, 0, 0]),
        ),
        "addresses accepts the sigma-permuted list": (
            "addresses",
            _different(exp["addresses"], list(exp["sigma-addresses"]), [0] * 9),
        ),
        "sigma-addresses accepts the raw list": (
            "sigma-addresses",
            _different(exp["sigma-addresses"], list(exp["addresses"]), [0] * 9),
        ),
        "marks accepts the first three addresses": (
            "marks",
            _different(exp["marks"], list(exp["addresses"][:3]), [0, 0, 0]),
        ),
        "grand-product accepts the lying products": (
            "grand-product",
            _different(exp["grand-product"], list(exp["bad-product"]), [0, 0]),
        ),
        "bad-product accepts the honest products": (
            "bad-product",
            _different(exp["bad-product"], list(exp["grand-product"]), [0, 0]),
        ),
        "bad-product accepts the swapped pair": (
            "bad-product",
            _different(exp["bad-product"], [exp["bad-product"][1], exp["bad-product"][0]], [0, 0]),
        ),
        "miss-count accepts the total pair count": (
            "miss-count",
            _different(exp["miss-count"], (pub["q"] - 1) * pub["q"], exp["miss-count"] + 1),
        ),
        "miss-count accepts another deployment's count": (
            "miss-count",
            _different(exp["miss-count"], other["miss-count"], exp["miss-count"] + 1),
        ),
        "a boolean is not an integer": ("miss-count", True),
        "a truncated tuple is not the answer": ("addresses", list(exp["addresses"][:8])),
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
