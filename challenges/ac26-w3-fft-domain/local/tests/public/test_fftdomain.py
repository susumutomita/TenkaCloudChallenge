"""Intentionally incomplete public tests: the shipped starter passes all of them.

Every domain here is real — its omega genuinely has the advertised order. That is
the blind spot: over a real domain, code that checked ``omega ** n == 1`` and code
that checked the order exactly are indistinguishable. The hidden phases hand over
omegas for which the two disagree.
"""

from __future__ import annotations

import argparse
import importlib.util
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SUBMISSION = Path(os.environ.get("SUBMISSION_DIR", ROOT / "starter")) / "fftdomain.py"


def _load():
    spec = importlib.util.spec_from_file_location("participant_fftdomain", SUBMISSION)
    if spec is None or spec.loader is None:
        raise AssertionError("could not load fftdomain.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    for name in ("validate_domain", "fft", "ifft", "interpolate_and_evaluate"):
        if not hasattr(module, name):
            raise AssertionError(f"fftdomain.py must define {name}()")
    return module


def _horner(coefficients: list[int], point: int, prime: int) -> int:
    total = 0
    for coefficient in reversed(coefficients):
        total = (total * point + coefficient) % prime
    return total


def test_the_worked_domain_validates() -> None:
    module = _load()
    assert module.validate_domain(17, 4, 13) == {"ok": True, "valid": True}


def test_the_worked_transform_matches_the_handout() -> None:
    module = _load()
    reply = module.fft([1, 2, 3, 4], 13, 17)
    assert reply["ok"] is True
    assert reply["values"] == [10, 6, 15, 7]


def test_the_transform_round_trips() -> None:
    module = _load()
    coefficients = [3, 1, 4, 1, 5, 9, 2, 6]
    forward = module.fft(list(coefficients), 33, 97)
    assert forward["ok"] is True
    back = module.ifft(forward["values"], 33, 97)
    assert back == {"ok": True, "coefficients": coefficients}


def test_a_domain_member_interpolates_to_its_value() -> None:
    module = _load()
    values = [31, 28, 68, 92, 94, 56, 33, 10]
    # 47 is 33 ** 3 mod 97, the fourth point of the domain.
    assert module.interpolate_and_evaluate(list(values), 33, 47, 97) == {
        "ok": True,
        "value": values[3],
    }


def test_a_point_off_the_domain_interpolates_to_the_polynomial() -> None:
    module = _load()
    coefficients = [3, 1, 4, 1, 5, 9, 2, 6]
    forward = module.fft(list(coefficients), 33, 97)
    answer = module.interpolate_and_evaluate(forward["values"], 33, 5, 97)
    assert answer == {"ok": True, "value": _horner(coefficients, 5, 97)}


def test_a_non_prime_field_is_refused() -> None:
    module = _load()
    assert module.validate_domain(16, 4, 3) == {"ok": False, "error": "invalid_prime"}
    assert module.fft([1], 1, 16) == {"ok": False, "error": "invalid_prime"}


def test_malformed_inputs_get_their_names() -> None:
    module = _load()
    assert module.validate_domain(17, 0, 1) == {"ok": False, "error": "invalid_order"}
    assert module.validate_domain(17, 4, "13") == {"ok": False, "error": "invalid_omega"}
    assert module.fft(["x"], 13, 17) == {"ok": False, "error": "invalid_coefficients"}
    assert module.ifft([], 13, 17) == {"ok": False, "error": "invalid_values"}
    assert module.interpolate_and_evaluate([0, 0, 0, 0], 13, 17, 17) == {
        "ok": False,
        "error": "invalid_point",
    }


TESTS = {
    name: value
    for name, value in globals().items()
    if name.startswith("test_") and callable(value)
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", default="")
    args = parser.parse_args()
    selected = {name: test for name, test in TESTS.items() if args.only in name}
    if not selected:
        print("no public test matched", file=sys.stderr)
        return 2
    failures: list[str] = []
    for name, test in selected.items():
        try:
            test()
            print(f"pass {name}")
        except Exception as error:  # noqa: BLE001 - test runner reports each failure
            failures.append(name)
            print(f"FAIL {name}: {type(error).__name__}: {error}")
    if failures:
        print(f"{len(failures)} failed")
        return 1
    print(f"all passed ({len(selected)})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
