"""Break the reference nine ways and require the hidden properties to notice."""

from __future__ import annotations

import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tests.hidden.check_ntt import run

REFERENCE = (Path(__file__).parent / "reference" / "ntt.py").read_text(encoding="utf-8")
SEED = "mutation-suite-seed"

MUTATIONS: list[tuple[str, str, str]] = [
    (
        "accepts any element whose order merely divides n",
        "    if pow(candidate, order, prime) != 1:\n"
        "        return False\n"
        "    return all(pow(candidate, order // q, prime) != 1 for q in _prime_factors(order))",
        "    return pow(candidate, order, prime) == 1",
    ),
    (
        "keeps the textbook base-3 rule and never checks the result",
        "    exponent = (prime - 1) // order\n"
        "    for base in range(2, prime):\n"
        "        candidate = pow(base, exponent, prime)\n"
        "        if has_order(candidate, order, prime):\n"
        "            return candidate\n"
        "    return None",
        "    return pow(3, (prime - 1) // order, prime)",
    ),
    (
        "checks only the smallest prime factor of n",
        "    return all(pow(candidate, order // q, prime) != 1 for q in _prime_factors(order))",
        "    return pow(candidate, order // min(_prime_factors(order)), prime) != 1",
    ),
    (
        "drops the 1/n factor from the inverse",
        "        coefficients.append(_evaluate(parsed, point, prime) * inverse_order % prime)",
        "        coefficients.append(_evaluate(parsed, point, prime))",
    ),
    (
        "walks the inverse forwards instead of backwards",
        "    inverse_omega = pow(omega, prime - 2, prime)",
        "    inverse_omega = omega",
    ),
    (
        "trusts the omega it is handed",
        "    if type(omega) is not int or not has_order(omega, order, prime):\n"
        '        return _error("invalid_omega")',
        "    if type(omega) is not int or omega % prime == 0:\n"
        '        return _error("invalid_omega")',
    ),
    (
        "lets the order skip the divisibility rule",
        '    if (prime - 1) % order != 0:\n        return "invalid_order"',
        '    if False:\n        return "invalid_order"',
    ),
    (
        "evaluates at 0, 1, 2, ... instead of the powers of omega",
        "        point = point * omega % prime",
        "        point = (point + 1) % prime",
    ),
    (
        "accepts a coefficient from outside the field",
        "        if type(item) is not int or not 0 <= item < prime:",
        "        if type(item) is not int:",
    ),
]


def _load(source: str) -> types.ModuleType:
    module = types.ModuleType("mutant")
    module.__dict__["__file__"] = "<mutant>"
    exec(compile(source, "<mutant>", "exec"), module.__dict__)  # noqa: S102 - author-only test
    return module


def main() -> int:
    baseline = run(_load(REFERENCE), SEED)
    if baseline:
        print("the reference does not pass its hidden suite:")
        for failure in baseline:
            print(f"  {failure}")
        return 1
    print("reference: passes")

    survivors: list[str] = []
    for name, before, after in MUTATIONS:
        if before not in REFERENCE:
            print(f"BROKEN {name}: mutation target is missing")
            survivors.append(name)
            continue
        try:
            failures = run(_load(REFERENCE.replace(before, after, 1)), SEED)
        except Exception as error:  # noqa: BLE001 - a crashing mutant is killed
            failures = [type(error).__name__]
        if failures:
            print(f"killed {name}")
        else:
            print(f"SURVIVED {name}")
            survivors.append(name)

    if survivors:
        print(f"{len(survivors)} mutation(s) survived")
        return 1
    print(f"all {len(MUTATIONS)} mutations killed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
