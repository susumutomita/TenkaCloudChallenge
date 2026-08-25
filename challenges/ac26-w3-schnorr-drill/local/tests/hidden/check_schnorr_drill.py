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

from fixtures.generate import LINES, order_of, setting  # noqa: E402
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
    if isinstance(expected, tuple):
        got = tuple(got) if isinstance(got, (list, tuple)) else got
    if got != expected:
        return [f"{line}: value differs from this deployment's value"]
    return []


def _expected(seed: str):
    pub = setting(seed)["public"]
    n = order_of(pub["G"], pub["p"], pub["a"])
    return pub, expected_for(seed), n


def check_field(module, seed: str) -> list[str]:
    pub, exp, _n = _expected(seed)
    failures: list[str] = []
    got, err = _call(module, "field_neg", pub["t"], pub["p"])
    failures += [err] if err else _compare("field-neg", got, exp["field-neg"])
    got, err = _call(module, "field_inv", pub["t"], pub["p"])
    failures += [err] if err else _compare("field-inv", got, exp["field-inv"])
    return failures


def check_curve(module, seed: str) -> list[str]:
    pub, exp, _n = _expected(seed)
    failures: list[str] = []
    got, err = _call(module, "lambda_chord", pub["G"], pub["Q"], pub["p"])
    failures += [err] if err else _compare("lambda-chord", got, exp["lambda-chord"])
    got, err = _call(module, "add_points", pub["G"], pub["Q"], pub["p"])
    failures += [err] if err else _compare("add-points", got, exp["add-points"])
    got, err = _call(module, "double", pub["G"], pub["p"], pub["a"])
    failures += [err] if err else _compare("double", got, exp["double"])
    got, err = _call(module, "order", pub["G"], pub["p"], pub["a"])
    failures += [err] if err else _compare("order", got, exp["order"])
    return failures


def check_schnorr(module, seed: str) -> list[str]:
    pub, exp, n = _expected(seed)
    p, a, G = pub["p"], pub["a"], pub["G"]
    failures: list[str] = []
    got, err = _call(module, "pubkey", pub["x"], G, p, a)
    failures += [err] if err else _compare("pubkey", got, exp["pubkey"])
    got, err = _call(module, "commit", pub["r"], G, p, a)
    failures += [err] if err else _compare("commit", got, exp["commit"])
    got, err = _call(module, "response", pub["r"], pub["e"], pub["x"], n)
    failures += [err] if err else _compare("response", got, exp["response"])
    got, err = _call(module, "verify_left", exp["response"], G, p, a)
    failures += [err] if err else _compare("verify", got, exp["verify"])
    got, err = _call(module, "nonce_reuse", pub["s1"], pub["s2"], pub["e1"], pub["e2"], n)
    failures += [err] if err else _compare("nonce-reuse", got, exp["nonce-reuse"])
    return failures


def check_transfer(module, seed: str) -> list[str]:
    pub, exp, _n = _expected(seed)
    got, err = _call(
        module, "transfer", pub["x2"], pub["r2"], pub["e2p"], pub["G2"], pub["p2"], pub["a2"]
    )
    return [err] if err else _compare("transfer", got, exp["transfer"])


def run(module, seed: str) -> list[str]:
    failures: list[str] = []
    for phase in (check_field, check_curve, check_schnorr, check_transfer):
        failures.extend(phase(module, seed))
    assert set(LINES) >= set(), "LINES imported"  # keeps the drill order in one place
    return failures
