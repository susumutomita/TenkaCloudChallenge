"""Hidden suite: the twelve functions against this seed's expected values.

No checkpoint of this problem runs learner code — the grade is the pasted value. This
suite exists for the author path: the mutation suite breaks the reference on purpose and
expects these checks to notice, and CI proves the reference produces the expected value
of every line on every seed. Each `check_*` returns a list of failure strings; empty
means the function agrees with the seed's expected value.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fixtures.generate import setting  # noqa: E402


def _call(module, name, *args):
    fn = getattr(module, name, None)
    if fn is None:
        return None, f"{name}: missing"
    try:
        return fn(*args), None
    except Exception as error:  # noqa: BLE001 - a crash is a failure, not a verdict
        return None, f"{name}: raised {type(error).__name__}"


def _compare(line: str, got, expected) -> list[str]:
    def canon(value):
        if isinstance(value, (list, tuple)):
            return tuple(canon(item) for item in value)
        return value

    if canon(got) != canon(expected):
        return [f"{line}: value differs from this deployment's value"]
    return []


def check_fold(module, seed: str) -> list[str]:
    cfg = setting(seed)
    pub, exp = cfg["public"], cfg["expected"]
    p = pub["p"]
    qs = (pub["q0"], pub["q1"], pub["q2"], pub["q3"])
    failures: list[str] = []
    got, err = _call(module, "poly3", qs, p)
    failures += [err] if err else _compare("poly", got, exp["poly"])
    got, err = _call(module, "split", qs, p)
    failures += [err] if err else _compare("split", got, exp["split"])
    got, err = _call(module, "identity_holds", qs, p)
    failures += [err] if err else _compare("identity", got, exp["identity"])
    got, err = _call(module, "fold", qs, pub["beta"], p)
    failures += [err] if err else _compare("fold", got, exp["fold"])
    got, err = _call(module, "fold2", qs, pub["beta"], pub["beta2"], p)
    failures += [err] if err else _compare("fold2", got, exp["fold2"])
    return failures


def check_query(module, seed: str) -> list[str]:
    cfg = setting(seed)
    pub, exp = cfg["public"], cfg["expected"]
    p = pub["p"]
    qs = (pub["q0"], pub["q1"], pub["q2"], pub["q3"])
    failures: list[str] = []
    got, err = _call(module, "query", qs, pub["x"], p)
    failures += [err] if err else _compare("query", got, exp["query"])
    got, err = _call(module, "recover", qs, pub["x"], p)
    failures += [err] if err else _compare("recover", got, exp["recover"])
    got, err = _call(module, "consistency", qs, pub["beta"], pub["x"], p)
    failures += [err] if err else _compare("consistency", got, exp["consistency"])
    return failures


def check_cheat(module, seed: str) -> list[str]:
    cfg = setting(seed)
    pub, exp = cfg["public"], cfg["expected"]
    p = pub["p"]
    qs = (pub["q0"], pub["q1"], pub["q2"], pub["q3"])
    failures: list[str] = []
    got, err = _call(module, "cheat", qs, pub["beta"], pub["d0"], pub["d1"], p)
    failures += [err] if err else _compare("cheat", got, exp["cheat"])
    got, err = _call(module, "cheat_caught", qs, pub["beta"], pub["x"], pub["d0"], pub["d1"], p)
    failures += [err] if err else _compare("cheat-caught", got, exp["cheat-caught"])
    got, err = _call(module, "miss_points", pub["d0"], pub["d1"], p)
    failures += [err] if err else _compare("miss-points", got, exp["miss-points"])
    got, err = _call(module, "honest_all", qs, pub["beta"], p)
    failures += [err] if err else _compare("honest-all", got, exp["honest-all"])
    return failures


def run(module, seed: str) -> list[str]:
    failures: list[str] = []
    for phase in (check_fold, check_query, check_cheat):
        failures.extend(phase(module, seed))
    return failures
