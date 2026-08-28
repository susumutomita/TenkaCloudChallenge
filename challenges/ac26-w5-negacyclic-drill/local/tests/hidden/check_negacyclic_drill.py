"""Hidden suite: the twelve functions against this seed's expected values.

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


def check_ring(module, seed: str) -> list[str]:
    """Lines 1–5: the ring's constants and the accident side of the flip."""
    pub = setting(seed)["public"]
    exp = expected_for(seed)
    v = [1] * pub["n"]
    failures: list[str] = []
    got, err = _call(module, "params", pub["p"], pub["n"])
    failures += [err] if err else _compare("params", got, exp["params"])
    got, err = _call(module, "wrap", pub["low_probe"], pub["high_probe"], pub["n"])
    failures += [err] if err else _compare("wrap", got, exp["wrap"])
    got, err = _call(module, "signs", v, tuple(pub["probes"]))
    failures += [err] if err else _compare("signs", got, exp["signs"])
    got, err = _call(module, "boundary", v)
    failures += [err] if err else _compare("boundary", got, exp["boundary"])
    got, err = _call(module, "hazard", v, pub["low_probe"])
    failures += [err] if err else _compare("hazard", got, exp["hazard"])
    return failures


def check_gate(module, seed: str) -> list[str]:
    """Lines 6–10: the same flip as the mechanism — encoding to the closed NAND table."""
    pub = setting(seed)["public"]
    exp = expected_for(seed)
    failures: list[str] = []
    got, err = _call(module, "encoding", pub["p"])
    failures += [err] if err else _compare("encoding", got, exp["encoding"])
    got, err = _call(module, "phases", pub["p"])
    failures += [err] if err else _compare("phases", got, exp["phases"])
    got, err = _call(module, "rotations", pub["p"], pub["n"], pub["noise_a"], pub["noise_b"])
    failures += [err] if err else _compare("rotations", got, exp["rotations"])
    got, err = _call(module, "constants", pub["p"], pub["n"], pub["noise_a"], pub["noise_b"])
    failures += [err] if err else _compare("constants", got, exp["constants"])
    got, err = _call(module, "nand_table")
    failures += [err] if err else _compare("nand", got, exp["nand"])
    return failures


def check_closure(module, seed: str) -> list[str]:
    """Lines 11–12: the sweep over every allowed noise, and the margin that permits it."""
    pub = setting(seed)["public"]
    exp = expected_for(seed)
    failures: list[str] = []
    got, err = _call(module, "noise_sweep", pub["p"], pub["n"], pub["dmax"])
    failures += [err] if err else _compare("noise-sweep", got, exp["noise-sweep"])
    got, err = _call(module, "margin", pub["p"], pub["n"])
    failures += [err] if err else _compare("margin", got, exp["margin"])
    return failures


def run(module, seed: str) -> list[str]:
    failures: list[str] = []
    for phase in (check_ring, check_gate, check_closure):
        failures.extend(phase(module, seed))
    return failures
