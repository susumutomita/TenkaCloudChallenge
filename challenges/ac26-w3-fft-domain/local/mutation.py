"""Break the reference eight ways and require the hidden properties to notice."""

from __future__ import annotations

import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tests.hidden.check_fftdomain import run

REFERENCE = (Path(__file__).parent / "reference" / "fftdomain.py").read_text(encoding="utf-8")
SEED = "mutation-suite-seed"

MUTATIONS: list[tuple[str, str, str]] = [
    (
        "keeps only omega ** n == 1 and drops the primitivity half",
        '    return all(pow(candidate, order // q, prime) != 1 for q in _prime_factors(order))',
        "    return True",
    ),
    (
        "drops omega ** n == 1 and keeps only the primitivity half",
        "    if pow(candidate, order, prime) != 1:\n        return False",
        "    if False:\n        return False",
    ),
    (
        "runs the inverse at the powers of omega instead of its inverse",
        "    inverse_omega = pow(omega, prime - 2, prime)",
        "    inverse_omega = omega % prime",
    ),
    (
        "forgets to scale the inverse by n ** -1",
        "    inverse_order = pow(order % prime, prime - 2, prime)",
        "    inverse_order = 1",
    ),
    (
        "returns the evaluations in recursion order rather than index order",
        '        point = point * omega % prime\n    return {"ok": True, "values": values}',
        '        point = point * omega % prime\n    return {"ok": True, "values": values[::-1]}',
    ),
    (
        "answers a constant instead of interpolating",
        '    return {"ok": True, "value": _evaluate(coefficients, point, prime)}',
        '    return {"ok": True, "value": parsed[0]}',
    ),
    (
        "special-cases domain members and hands back zero",
        '    recovered = ifft(parsed, omega, prime)\n    assert recovered.get("ok") is True',
        '    if point in {pow(omega, i, prime) for i in range(len(parsed))}:\n        return {"ok": True, "value": 0}\n    recovered = ifft(parsed, omega, prime)\n    assert recovered.get("ok") is True',
    ),
    (
        "calls every well-formed triple a valid domain",
        '    return {"ok": True, "valid": _domain_ok(omega, order, prime)}',
        '    return {"ok": True, "valid": type(omega) is int}',
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
        source = REFERENCE.replace(before, after, 1)
        try:
            failures = run(_load(source), SEED)
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
