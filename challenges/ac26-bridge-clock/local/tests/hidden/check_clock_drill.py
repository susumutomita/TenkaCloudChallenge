"""Hidden suite: the ten functions against this seed's expected values.

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


def check_world(module, seed: str) -> list[str]:
    """Lines 1–3: the wrap, and both operations surviving it in either order."""
    pub = setting(seed)["public"]
    exp = expected_for(seed)
    failures: list[str] = []
    got, err = _call(module, "wrap", pub["u"], pub["v"], pub["n"])
    failures += [err] if err else _compare("wrap", got, exp["wrap"])
    got, err = _call(module, "add", pub["u"], pub["v"], pub["n"])
    failures += [err] if err else _compare("add", got, exp["add"])
    got, err = _call(module, "mul", pub["u"], pub["v"], pub["n"])
    failures += [err] if err else _compare("mul", got, exp["mul"])
    return failures


def check_cover(module, seed: str) -> list[str]:
    """Lines 4–7: the cover hiding, the cover coming off, and the flat count."""
    pub = setting(seed)["public"]
    exp = expected_for(seed)
    failures: list[str] = []
    got, err = _call(module, "covered", pub["secret"], pub["cover"], pub["n"])
    failures += [err] if err else _compare("cover", got, exp["cover"])
    got, err = _call(module, "uncovered", pub["secret"], pub["cover"], pub["n"])
    failures += [err] if err else _compare("uncover", got, exp["uncover"])
    got, err = _call(module, "every", pub["secret"], pub["cover"], pub["n"])
    failures += [err] if err else _compare("every", got, exp["every"])
    got, err = _call(module, "count", pub["secret"], pub["cover"], pub["n"])
    failures += [err] if err else _compare("count", got, exp["count"])
    return failures


def check_reuse(module, seed: str) -> list[str]:
    """Lines 8–10: the reused cover cancelling out of the difference."""
    pub = setting(seed)["public"]
    exp = expected_for(seed)
    failures: list[str] = []
    got, err = _call(module, "reuse", pub["secret"], pub["second"], pub["cover"], pub["n"])
    failures += [err] if err else _compare("reuse", got, exp["reuse"])
    got, err = _call(module, "leak", pub["secret"], pub["second"], pub["cover"], pub["n"])
    failures += [err] if err else _compare("leak", got, exp["leak"])
    got, err = _call(module, "same_diff", pub["secret"], pub["second"], pub["cover"], pub["n"])
    failures += [err] if err else _compare("same-diff", got, exp["same-diff"])
    return failures


def run(module, seed: str) -> list[str]:
    failures: list[str] = []
    for phase in (check_world, check_cover, check_reuse):
        failures.extend(phase(module, seed))
    return failures
