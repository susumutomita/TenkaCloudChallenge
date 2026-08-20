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
    if isinstance(expected, tuple) and isinstance(got, (list, tuple)):
        got = tuple(got)
    if got != expected:
        return [f"{line}: value differs from this deployment's value"]
    return []


def check_setup(module, seed: str) -> list[str]:
    cfg = setting(seed)
    pub, exp = cfg["public"], cfg["expected"]
    p = pub["p"]
    y0, y1, _out = exp["circuit"]
    failures: list[str] = []
    got, err = _call(module, "layer", pub["x1"], pub["x2"], pub["x3"], pub["x4"], p)
    failures += [err] if err else _compare("circuit", got, exp["circuit"])
    got, err = _call(module, "mle3", y0, y1, p)
    failures += [err] if err else _compare("mle", got, exp["mle"])
    got, err = _call(module, "grid", y0, y1, p)
    failures += [err] if err else _compare("grid", got, exp["grid"])
    got, err = _call(module, "grid_total", y0, y1, p)
    failures += [err] if err else _compare("grid-total", got, exp["grid-total"])
    return failures


def check_rounds(module, seed: str) -> list[str]:
    cfg = setting(seed)
    pub, exp = cfg["public"], cfg["expected"]
    p = pub["p"]
    y0, y1, _out = exp["circuit"]
    failures: list[str] = []
    got, err = _call(module, "p1_sum", pub["c0"], pub["c1"], pub["c2"], p)
    failures += [err] if err else _compare("p1-sum", got, exp["p1-sum"])
    got, err = _call(module, "round1", pub["c0"], pub["c1"], pub["c2"], pub["r1"], p)
    failures += [err] if err else _compare("round1", got, exp["round1"])
    got, err = _call(module, "p2_sum", pub["b1"], pub["b2"], p)
    failures += [err] if err else _compare("p2-sum", got, exp["p2-sum"])
    got, err = _call(
        module, "final_check", y0, y1, pub["b1"], pub["b2"], pub["r1"], pub["r2"], p
    )
    failures += [err] if err else _compare("final-check", got, exp["final-check"])
    return failures


def check_lie(module, seed: str) -> list[str]:
    cfg = setting(seed)
    pub, exp = cfg["public"], cfg["expected"]
    p = pub["p"]
    y0, y1, _out = exp["circuit"]
    failures: list[str] = []
    got, err = _call(module, "lie", pub["c0"], pub["c1"], pub["c2"], pub["d"], pub["r1"], p)
    failures += [err] if err else _compare("lie", got, exp["lie"])
    got, err = _call(
        module, "lie_caught",
        pub["c0"], pub["c1"], pub["c2"], pub["b1"], pub["b2"],
        pub["d"], pub["m"], pub["r1"], pub["r2"], y0, y1, p,
    )
    failures += [err] if err else _compare("lie-caught", got, exp["lie-caught"])
    got, err = _call(
        module, "miss_points",
        pub["c0"], pub["c1"], pub["c2"], pub["b1"], pub["b2"],
        pub["d"], pub["m"], pub["r1"], y0, y1, p,
    )
    failures += [err] if err else _compare("miss-points", tuple(got) if got else got, exp["miss-points"])
    return failures


def run(module, seed: str) -> list[str]:
    failures: list[str] = []
    for phase in (check_setup, check_rounds, check_lie):
        failures.extend(phase(module, seed))
    return failures
