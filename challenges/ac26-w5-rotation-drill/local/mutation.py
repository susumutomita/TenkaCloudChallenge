"""Author-side check: break the reference on purpose and confirm the hidden suite notices.

Every mutant below is a line a learner actually mistypes: the phase with the mask added
back, the slot width computed on half the ring, the test polynomial without the
half-slot centring, the rescaling floored instead of rounded, the index reduced mod n
(which silently deletes the whole negacyclic subject — on a clean deployment the two
give the same number, so the hidden suite's overshoot probes are what catches it), the
constant term read without the flip, the sweep run over the whole plaintext space
instead of the usable lower half. Each must be KILLED by
`tests/hidden/check_rotation_drill.py`.

The verifier-level mutations at the end cannot be expressed as a broken submission:
they check that the value grader itself refuses the near-misses a learner pastes — a
shown fixture value, another line's value, the plaintext where f(m) belongs, a
truncated tuple, a boolean, and another deployment's answer.
"""

from __future__ import annotations

import os
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from fixtures.generate import GRADED, setting  # noqa: E402
from tests.hidden import check_rotation_drill  # noqa: E402
from verifier.expected import expected_for  # noqa: E402

REFERENCE = (ROOT / "reference" / "rotation_drill.py").read_text(encoding="utf-8")
#: Chosen so that every source-level mutant below produces a different value than the
#: reference on at least one checked line (verified when the suite runs — a surviving
#: mutant fails the build, and "mutation-suite-seed" happens to make four of them
#: coincide with the right answers).
SEED = "mutation-seed-1"

MUTATIONS: dict[str, tuple[str, str]] = {
    "params with D derived from the ring, not the plaintext": (
        "    return (p, q, n, q // p)",
        "    return (p, q, n, q // n)",
    ),
    "the phase with the mask added back": (
        "    return (b - sum(x * y for x, y in zip(a, s))) % q",
        "    return (b + sum(x * y for x, y in zip(a, s))) % q",
    ),
    "the split returned noise-first": (
        "    return divmod(phase(q, s, a, b), q // p)",
        "    return divmod(phase(q, s, a, b), q // p)[::-1]",
    ),
    "the slot width computed on half the ring": (
        "    return 2 * n // p",
        "    return n // p",
    ),
    "the test polynomial without the half-slot centring": (
        "    return [(min((j + slot // 2) // slot, half - 1) + shift) % half for j in range(n)]",
        "    return [(min(j // slot, half - 1) + shift) % half for j in range(n)]",
    ),
    "the rescaling floored instead of rounded": (
        "    return round(x * 2 * n / q)",
        "    return (x * 2 * n) // q",
    ),
    "the index reduced mod n, not 2n": (
        "    return (rescale_one(q, n, b) - shifted) % (2 * n)",
        "    return (rescale_one(q, n, b) - shifted) % n",
    ),
    "the constant term read without the flip": (
        "    return -v[wrapped - n]",
        "    return v[wrapped - n]",
    ),
    "the readout taken at the phase, not the index": (
        "    return constant_at(testvector(p, n, shift), index(q, n, s, a, b))",
        "    return constant_at(testvector(p, n, shift), phase(q, s, a, b))",
    ),
    "the programmable map applied backwards": (
        "    return (split(p, q, s, a, b)[0] + shift) % (p // 2)",
        "    return (split(p, q, s, a, b)[0] - shift) % (p // 2)",
    ),
    "the window counted on one side only": (
        "    return sum(1 for d in range(-slot, slot + 1) if constant_at(v, idx + d) == middle)",
        "    return sum(1 for d in range(0, slot + 1) if constant_at(v, idx + d) == middle)",
    ),
    "the edge counted up to the change itself": (
        "    return next(d for d in range(1, 2 * n + 1) if constant_at(v, idx + d) != here) - 1",
        "    return next(d for d in range(1, 2 * n + 1) if constant_at(v, idx + d) != here)",
    ),
    "the sweep run over the whole plaintext space": (
        "        for t in range(half)",
        "        for t in range(p)",
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
    module = types.ModuleType("rotation_drill_mutant")
    exec(compile(source, "rotation_drill_mutant", "exec"), module.__dict__)  # noqa: S102 - author tooling
    return module


def main() -> int:
    survivors: list[str] = []

    reference = _load(REFERENCE)
    failures = check_rotation_drill.run(reference, SEED)
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
            failures = check_rotation_drill.run(mutant, SEED)
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
    v_head = reference.testvector(pub["p"], pub["n"], pub["shift"])[:4]
    near_misses = {
        "params accepts p, n, q in reading order": (
            "params",
            _different(exp["params"], [pub["p"], pub["n"], pub["q"], pub["q"] // pub["p"]], [0, 0, 0, 0]),
        ),
        "phase accepts the body b unstripped": ("phase", _different(exp["phase"], pub["b"], -1)),
        "phase accepts the split pair": ("phase", list(exp["split"])),
        "testpoly accepts the first four coefficients": (
            "testpoly",
            _different(exp["testpoly"], v_head, [0, 0, 0, 0]),
        ),
        "testpoly accepts one value short": ("testpoly", list(exp["testpoly"][:3])),
        "rescale accepts the unscaled values": (
            "rescale",
            _different(exp["rescale"], [pub["q"] // pub["p"], pub["a"][0], pub["b"]], [0, 0, 0]),
        ),
        "index accepts the phase": ("index", _different(exp["index"], exp["phase"], -1)),
        "index accepts a boolean": ("index", True),
        "readout accepts the plaintext unmapped": (
            "readout",
            _different(exp["readout"], exp["split"][0], -1),
        ),
        "readout accepts the whole boundary sample": ("readout", list(exp["testpoly"])),
        "window accepts the slot width": ("window", _different(exp["window"], exp["slots"], -1)),
        "edge accepts the window": ("edge", _different(exp["edge"], exp["window"], -1)),
        "another deployment's phase": ("phase", _different(exp["phase"], other["phase"], -1)),
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
