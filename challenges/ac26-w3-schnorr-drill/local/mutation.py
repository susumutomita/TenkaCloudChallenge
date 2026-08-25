"""Author-side check: break the reference on purpose and confirm the hidden suite notices.

Every mutant below is a line a learner actually mistypes: the wrong modulus for s, a
forgotten reflection, the tangent slope without the `a`, an inverse by p-1 instead of
p-2, an order counted from 0, a nonce-reuse division done mod p. Each must be KILLED by
`tests/hidden/check_schnorr_drill.py`.

The verifier-level mutations at the end cannot be expressed as a broken submission: they
check that the value grader itself refuses the near-misses a learner pastes — a shown
fixture value, another line's value, the right point with the coordinates swapped, a
boolean, and another seed's answer.
"""

from __future__ import annotations

import os
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from fixtures.generate import GRADED, setting  # noqa: E402
from tests.hidden import check_schnorr_drill  # noqa: E402
from verifier.expected import expected_for  # noqa: E402

REFERENCE = (ROOT / "reference" / "schnorr_drill.py").read_text(encoding="utf-8")
SEED = "mutation-suite-seed"

MUTATIONS: dict[str, tuple[str, str]] = {
    "field-neg without reduction": ("    return (-t) % p", "    return -t"),
    "inverse by p-1 instead of p-2": ("    return pow(t, p - 2, p)", "    return pow(t, p - 1, p)"),
    "chord slope without the inverse": (
        "    return ((Qy - Gy) * pow(Qx - Gx, p - 2, p)) % p",
        "    return ((Qy - Gy) * (Qx - Gx)) % p",
    ),
    "forgot to reflect y3": (
        "    y3 = (lam * (Gx - x3) - Gy) % p\n    return (x3, y3)\n\n\ndef double",
        "    y3 = (lam * (Gx - x3) + Gy) % p\n    return (x3, y3)\n\n\ndef double",
    ),
    "tangent slope without a": (
        "    lam = ((3 * Gx * Gx + a) * pow(2 * Gy, p - 2, p)) % p",
        "    lam = ((3 * Gx * Gx) * pow(2 * Gy, p - 2, p)) % p",
    ),
    "order counted from 0": ("    R, k = G, 1", "    R, k = G, 0"),
    "response reduced mod p-ish (no reduction)": ("    return (r + e * x) % n", "    return r + e * x"),
    "nonce reuse divided the wrong way round": (
        "    return ((s1 - s2) * pow(e1 - e2, n - 2, n)) % n",
        "    return ((s2 - s1) * pow(e1 - e2, n - 2, n)) % n",
    ),
    "transfer kept the first curve's order": (
        "    n2 = order(G2, p2, a2)\n    return (r2 + e2p * x2) % n2",
        "    return (r2 + e2p * x2) % 29",
    ),
}


def _different(expected, *candidates):
    """The first near-miss that is not accidentally the right answer for this seed."""
    for candidate in candidates:
        if tuple(candidate) != tuple(expected):
            return candidate
    raise RuntimeError("every near-miss equals the expected value; pick another seed")


def _load(source: str) -> types.ModuleType:
    module = types.ModuleType("schnorr_drill_mutant")
    exec(compile(source, "schnorr_drill_mutant", "exec"), module.__dict__)  # noqa: S102 - author tooling
    return module


def main() -> int:
    survivors: list[str] = []

    reference = _load(REFERENCE)
    failures = check_schnorr_drill.run(reference, SEED)
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
            failures = check_schnorr_drill.run(mutant, SEED)
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
        "field-inv accepts the shown t": ("field-inv", str(pub["t"])),
        "order accepts the field size p": ("order", str(pub["p"])),
        "double accepts the shown point Q": ("double", list(pub["Q"])),
        "verify accepts the commitment R": ("verify", list(exp["commit"])),
        "verify accepts the public key P": ("verify", list(exp["pubkey"])),
        "add-points accepts the unreflected third intersection": (
            "add-points",
            _different(exp["add-points"], [exp["add-points"][0], (-exp["add-points"][1]) % pub["p"]],
                       [exp["add-points"][1], exp["add-points"][0]]),
        ),
        "response accepts a boolean": ("response", True),
        "response accepts the value reduced mod p instead of n": (
            "response",
            _different([exp["response"]], [(pub["r"] + pub["e"] * pub["x"]) % pub["p"]], [exp["response"] + 1])[0],
        ),
        "nonce-reuse accepts another deployment's secret": ("nonce-reuse", other["nonce-reuse"]),
        "transfer accepts the first curve's response": ("transfer", exp["response"]),
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
