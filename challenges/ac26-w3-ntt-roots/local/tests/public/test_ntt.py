"""Intentionally incomplete public tests: the shipped starter passes all of them.

Every parameter set here is one where the starter's fixed base-3 rule happens to land on
an element of the right order. That is the blind spot the hidden phases work in.
"""

from __future__ import annotations

import argparse
import importlib.util
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SUBMISSION = Path(os.environ.get("SUBMISSION_DIR", ROOT / "starter")) / "ntt.py"


def _load():
    spec = importlib.util.spec_from_file_location("participant_ntt", SUBMISSION)
    if spec is None or spec.loader is None:
        raise AssertionError("could not load ntt.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    for name in ("transform", "inverse_transform"):
        if not hasattr(module, name):
            raise AssertionError(f"ntt.py must define {name}()")
    return module


def _evaluate(coefficients, point, prime):
    total = 0
    for coefficient in reversed(coefficients):
        total = (total * point + coefficient) % prime
    return total


def test_transform_evaluates_at_the_powers_of_its_omega() -> None:
    module = _load()
    result = module.transform([1, 2, 3, 4], 17, 4)
    assert result["ok"] is True
    omega = result["omega"]
    assert result["values"] == [_evaluate([1, 2, 3, 4], pow(omega, i, 17), 17) for i in range(4)]


def test_round_trip_recovers_the_coefficients() -> None:
    module = _load()
    forward = module.transform([5, 0, 9], 29, 4)
    back = module.inverse_transform(forward["values"], 29, 4, forward["omega"])
    assert back["coefficients"] == [5, 0, 9, 0]


def test_a_larger_order_still_round_trips() -> None:
    module = _load()
    coefficients = [3, 1, 4, 1, 5, 9, 2, 6]
    forward = module.transform(coefficients, 113, 16)
    back = module.inverse_transform(forward["values"], 113, 16, forward["omega"])
    assert back["coefficients"] == coefficients + [0] * 8


def test_order_one_is_a_single_evaluation() -> None:
    module = _load()
    assert module.transform([7], 17, 1)["values"] == [7]


def test_invalid_input_is_rejected() -> None:
    module = _load()
    assert module.transform([1], 4, 2) == {"ok": False, "error": "invalid_prime"}
    assert module.transform([1], 17, 5) == {"ok": False, "error": "invalid_order"}
    assert module.transform([17], 17, 4) == {"ok": False, "error": "invalid_coefficients"}


def test_output_shape() -> None:
    module = _load()
    result = module.transform([1, 1], 17, 4)
    assert set(result) == {"ok", "omega", "values"}
    assert all(isinstance(value, int) and 0 <= value < 17 for value in result["values"])


TESTS = {n: v for n, v in globals().items() if n.startswith("test_") and callable(v)}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", default="")
    args = parser.parse_args()
    selected = {n: t for n, t in TESTS.items() if args.only in n}
    if not selected:
        print("no public test matched", file=sys.stderr)
        return 2
    failures = []
    for name, test in selected.items():
        try:
            test()
            print(f"pass {name}")
        except Exception as error:  # noqa: BLE001 - the runner reports each failure
            failures.append(name)
            print(f"FAIL {name}: {type(error).__name__}: {error}")
    if failures:
        print(f"{len(failures)} failed")
        return 1
    print(f"all passed ({len(selected)})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
