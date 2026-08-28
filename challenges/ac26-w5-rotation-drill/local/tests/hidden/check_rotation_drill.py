"""Hidden suite: the twelve functions against this seed's expected values.

No checkpoint of this problem runs learner code — the grade is the pasted value. This
suite exists for the author path: the mutation suite breaks the reference on purpose
and expects these checks to notice, and CI proves the reference produces the expected
value of every line on every seed. Each `check_*` returns a list of failure strings;
empty means the function agrees with the seed's expected value.

One phase probes past the boundary n with crafted arguments. A clean deployment keeps
the rotation index below n on purpose (that is the drill's usable-half constraint), so
the seed's own values can never distinguish `% (2 * n)` from `% n`, or the negated
read from the unnegated one — the overshoot probes are what kills those mutants.
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
    if isinstance(expected, list) and isinstance(got, (list, tuple)):
        got = list(got)
    if got != expected:
        return [f"{line}: value differs from this deployment's value"]
    return []


def check_setting(module, seed: str) -> list[str]:
    """Lines 1–4: the constants, the phase, and the split the drill takes once."""
    pub = setting(seed)["public"]
    exp = expected_for(seed)
    failures: list[str] = []
    got, err = _call(module, "params", pub["p"], pub["q"], pub["n"])
    failures += [err] if err else _compare("params", got, exp["params"])
    got, err = _call(module, "phase", pub["q"], pub["s"], pub["a"], pub["b"])
    failures += [err] if err else _compare("phase", got, exp["phase"])
    got, err = _call(module, "split", pub["p"], pub["q"], pub["s"], pub["a"], pub["b"])
    failures += [err] if err else _compare("split", got, exp["split"])
    got, err = _call(module, "slots", pub["p"], pub["n"])
    failures += [err] if err else _compare("slots", got, exp["slots"])
    return failures


def check_table(module, seed: str) -> list[str]:
    """Lines 5–9: the test polynomial, the rescaling, the rotation, the readout."""
    pub = setting(seed)["public"]
    exp = expected_for(seed)
    failures: list[str] = []
    got, err = _call(module, "testpoly", pub["p"], pub["n"], pub["shift"])
    failures += [err] if err else _compare("testpoly", got, exp["testpoly"])
    got, err = _call(module, "rescale", pub["p"], pub["q"], pub["n"], pub["a"], pub["b"])
    failures += [err] if err else _compare("rescale", got, exp["rescale"])
    got, err = _call(module, "index", pub["q"], pub["n"], pub["s"], pub["a"], pub["b"])
    failures += [err] if err else _compare("index", got, exp["index"])
    got, err = _call(
        module, "readout", pub["p"], pub["q"], pub["n"], pub["s"], pub["a"], pub["b"], pub["shift"]
    )
    failures += [err] if err else _compare("readout", got, exp["readout"])
    got, err = _call(
        module, "programmable", pub["p"], pub["q"], pub["s"], pub["a"], pub["b"], pub["shift"]
    )
    failures += [err] if err else _compare("programmable", got, exp["programmable"])
    return failures


def check_margin(module, seed: str) -> list[str]:
    """Lines 10–12: the width the table's runs buy, and the sweep over every plaintext."""
    pub = setting(seed)["public"]
    exp = expected_for(seed)
    failures: list[str] = []
    for line in ("window", "edge", "sweep"):
        got, err = _call(
            module, line, pub["p"], pub["q"], pub["n"], pub["s"], pub["a"], pub["b"], pub["shift"]
        )
        failures += [err] if err else _compare(line, got, exp[line])
    return failures


def check_overshoot(module, seed: str) -> list[str]:
    """Crafted reads past the boundary n, which a clean deployment never produces.

    With q = 64, n = 16, s = (1,), a = (24,): b̂ = 2 and â.s rescales to 12, so the
    index is (2 - 12) mod 32 = 22 — on the far side of the boundary. Reducing mod n
    instead gives 6, and reading v there without the flip gives +3 instead of -3.
    """
    failures: list[str] = []
    got, err = _call(module, "constant_at", [1, 2, 3, 4], 5)
    failures += [err] if err else _compare("constant_at past the boundary", got, -2)
    got, err = _call(module, "constant_at", [1, 2, 3, 4], 11)
    failures += [err] if err else _compare("constant_at wrapped below it", got, 4)
    got, err = _call(module, "index", 64, 16, (1,), (24,), 4)
    failures += [err] if err else _compare("index past the boundary", got, 22)
    got, err = _call(module, "readout", 8, 64, 16, (1,), (24,), 4, 1)
    failures += [err] if err else _compare("readout past the boundary", got, -3)
    return failures


def run(module, seed: str) -> list[str]:
    failures: list[str] = []
    for phase_check in (check_setting, check_table, check_margin, check_overshoot):
        failures.extend(phase_check(module, seed))
    return failures
