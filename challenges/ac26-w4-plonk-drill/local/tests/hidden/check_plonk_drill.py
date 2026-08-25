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
    def canon(value):
        if isinstance(value, (list, tuple)):
            return tuple(canon(item) for item in value)
        return value

    if canon(got) != canon(expected):
        return [f"{line}: value differs from this deployment's value"]
    return []


def _tables(seed: str):
    pub, exp = setting(seed)["public"], expected_for(seed)
    o0, o1, o2 = exp["outputs"]
    rows = [(pub["a0"], pub["b0"], o0), (pub["a1"], pub["b1"], o1), (o0, o1, o2)]
    bad = [rows[0], rows[1], exp["bad-row"]]
    return pub, exp, rows, bad


def check_table(module, seed: str) -> list[str]:
    pub, exp, rows, bad = _tables(seed)
    p = pub["p"]
    failures: list[str] = []
    got, err = _call(module, "outputs", pub["a0"], pub["b0"], pub["a1"], pub["b1"], p)
    failures += [err] if err else _compare("outputs", got, exp["outputs"])
    got, err = _call(module, "gate_eq", rows, p)
    failures += [err] if err else _compare("gate-eq", got, exp["gate-eq"])
    got, err = _call(module, "copy_check", rows)
    failures += [err] if err else _compare("copy", got, exp["copy"])
    got, err = _call(module, "bad_row", exp["outputs"][0], exp["outputs"][1], pub["g"], p)
    failures += [err] if err else _compare("bad-row", got, exp["bad-row"])
    got, err = _call(module, "bad_passes", rows, bad, p)
    failures += [err] if err else _compare("bad-passes", got, exp["bad-passes"])
    return failures


def check_product(module, seed: str) -> list[str]:
    pub, exp, rows, bad = _tables(seed)
    q, w, beta, gamma = pub["q"], pub["w"], pub["beta"], pub["gamma"]
    failures: list[str] = []
    got, err = _call(module, "addresses", w, q)
    failures += [err] if err else _compare("addresses", got, exp["addresses"])
    got, err = _call(module, "sigma_addresses", w, q)
    failures += [err] if err else _compare("sigma-addresses", got, exp["sigma-addresses"])
    got, err = _call(module, "marks3", rows, w, q, beta, gamma)
    failures += [err] if err else _compare("marks", got, exp["marks"])
    got, err = _call(module, "grand_product", rows, w, q, beta, gamma)
    failures += [err] if err else _compare("grand-product", got, exp["grand-product"])
    got, err = _call(module, "bad_product", bad, w, q, beta, gamma)
    failures += [err] if err else _compare("bad-product", got, exp["bad-product"])
    got, err = _call(module, "multiset", rows, bad, w, q)
    failures += [err] if err else _compare("multiset", got, exp["multiset"])
    return failures


def check_miss(module, seed: str) -> list[str]:
    pub, exp, _rows, bad = _tables(seed)
    got, err = _call(module, "miss_count", bad, pub["w"], pub["q"])
    return [err] if err else _compare("miss-count", got, exp["miss-count"])


def run(module, seed: str) -> list[str]:
    failures: list[str] = []
    for phase in (check_table, check_product, check_miss):
        failures.extend(phase(module, seed))
    return failures
