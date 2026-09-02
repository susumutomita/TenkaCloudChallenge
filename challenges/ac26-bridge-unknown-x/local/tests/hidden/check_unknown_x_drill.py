"""Hidden suite: the eleven functions against this seed's expected values.

No checkpoint of this problem runs learner code — the grade is the pasted value. This
suite exists for the author path: the mutation suite breaks the reference on purpose
and expects these checks to notice, and CI proves the reference produces the expected
value of every line on every seed. Each `check_*` returns a list of failure strings;
empty means the function agrees with the seed's expected value.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fixtures.generate import setting  # noqa: E402
from verifier.expected import expected_for  # noqa: E402


def _call(module, name, *args):
    fn = getattr(module, name, None)
    if fn is None:
        return None, f"{name}: missing"
    try:
        return fn(*args), None
    except Exception as error:  # noqa: BLE001 - a crash is a failure, not a verdict
        return None, f"{name}: raised {type(error).__name__}"


def _compare(line: str, got, expected) -> list[str]:
    if isinstance(expected, tuple) and isinstance(got, (list, tuple)):
        got = tuple(got)
    if got != expected:
        return [f"{line}: value differs from this deployment's value"]
    return []


def check_addition(module, seed: str) -> list[str]:
    """Lines 1–5: the covered addition, small cover and huge cover alike."""
    pub = setting(seed)["public"]
    exp = expected_for(seed)
    failures: list[str] = []
    got, err = _call(module, "covered", pub["a"], pub["b"], pub["x"])
    failures += [err] if err else _compare("covered", got, exp["covered"])
    got, err = _call(module, "sum_covered", pub["a"], pub["b"], pub["x"])
    failures += [err] if err else _compare("sum-covered", got, exp["sum-covered"])
    got, err = _call(module, "sum_plain", pub["a"], pub["b"], pub["x"])
    failures += [err] if err else _compare("sum-plain", got, exp["sum-plain"])
    got, err = _call(module, "same", pub["a"], pub["b"], pub["x"])
    failures += [err] if err else _compare("same", got, exp["same"])
    got, err = _call(module, "huge_gap", pub["a"], pub["b"], pub["huge"])
    failures += [err] if err else _compare("huge", got, exp["huge"])
    return failures


def check_holder(module, seed: str) -> list[str]:
    """Lines 6–9: the holder's view — what comes back, what comes off, what narrows, what leaks."""
    pub = setting(seed)["public"]
    exp = expected_for(seed)
    failures: list[str] = []
    got, err = _call(module, "held", pub["a"], pub["b"], pub["x"])
    failures += [err] if err else _compare("held", got, exp["held"])
    got, err = _call(module, "recover", pub["a"], pub["b"], pub["x"])
    failures += [err] if err else _compare("recover", got, exp["recover"])
    got, err = _call(module, "guesses", pub["a"], pub["x"], pub["n"])
    failures += [err] if err else _compare("guesses", got, exp["guesses"])
    got, err = _call(module, "gap", pub["a"], pub["b"], pub["x"])
    failures += [err] if err else _compare("gap", got, exp["gap"])
    return failures


def check_wall(module, seed: str) -> list[str]:
    """Lines 10–11: the multiplication and the x² it cannot get rid of."""
    pub = setting(seed)["public"]
    exp = expected_for(seed)
    failures: list[str] = []
    got, err = _call(module, "product", pub["a"], pub["b"], pub["x"])
    failures += [err] if err else _compare("product", got, exp["product"])
    got, err = _call(module, "wall", pub["a"], pub["b"], pub["x"])
    failures += [err] if err else _compare("wall", got, exp["wall"])
    return failures


def run(module, seed: str) -> list[str]:
    failures: list[str] = []
    for phase in (check_addition, check_holder, check_wall):
        failures.extend(phase(module, seed))
    return failures
