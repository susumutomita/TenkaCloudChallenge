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


_MODULE = None

def _load():
    if _MODULE is None:
        raise RuntimeError('Public tests require a bounded learner session.')
    return _MODULE


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


def run_cases(module, only=''):
    global _MODULE
    _MODULE = module
    selected = {name: test for name, test in TESTS.items() if only in name}
    failures, lines = [], []
    try:
        if not selected:
            return ['no public test matched'], 'no public test matched'
        for name, test in selected.items():
            try:
                test()
                lines.append('pass '+name)
            except Exception as error:
                failures.append(name)
                lines.append('FAIL '+name+': '+type(error).__name__)
        lines.append(f'{len(failures)} failed' if failures else f'all passed ({len(selected)})')
        return failures, '\n'.join(lines)
    finally:
        _MODULE = None

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--only', default='')
    args = parser.parse_args()
    sys.path.insert(0, str(ROOT))
    from participant.execution import LearnerSession
    from participant.isolation import protect_supervisor
    protect_supervisor()
    try:
        with LearnerSession({'fftdomain.py': SUBMISSION.read_text()}) as session:
            failures, output = run_cases(session.module(), args.only)
        print(output)
        return int(bool(failures))
    except Exception:
        print('Public tests could not complete.')
        return 1

if __name__ == '__main__':
    raise SystemExit(main())
