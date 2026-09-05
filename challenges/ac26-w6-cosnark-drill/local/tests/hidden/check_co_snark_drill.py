"""Hidden suite: the fourteen functions against this seed's expected values.

No checkpoint of this problem runs learner code — the grade is the pasted value. This
suite exists for the author path: the mutation suite breaks the reference on purpose
and expects these checks to notice, and CI proves the reference produces the expected
value of every line on every seed. Each `check_*` returns a list of failure strings;
empty means the function agrees with the seed's expected value.

`check_crafted` re-derives the assignment `co-snark-prove`'s own worked example by hand
(modulus 97, witness [3, 5], coefficients [1, 2] / [4, 1], Beaver triple a=5/b=9/c=45,
with the README's own share randomness r0=1/r1=2/ra=1/rb=4/rc=20) and checks every
function against numbers that can be verified against the README with pencil and paper.
This is the group's analogue of the rotation drill's overshoot probes: some arithmetic
slips (adding the `d * e` correction to every party's share instead of only the first
one, for instance) can coincidentally survive a handful of seed draws, so this test does
not depend on a seed at all.

`check_normalizer` exercises `fixtures.generate.normalize_scalar` / `normalize_answer`
directly for every kind the shared shape grammar defines (int / bool / hex / str, scalar
and fixed-width tuple) — not only "int" and ("int", width), the only two kinds this
drill's own SHAPES table uses — because the grammar is shared with the sibling drills
ac26-w6-zkvm-trace-drill (bool / bool-tuple) and ac26-w6-nullifier-drill (hex /
hex-tuple), and this is where the group's normalizer contract is checked in one place.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fixtures.generate import (  # noqa: E402
    SHAPES,
    normalize_answer,
    normalize_scalar,
    setting,
)
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


def check_wiring(module, seed: str) -> list[str]:
    """Lines 1-4: the witness view, the share split, reconstruct, and the no-leak sweep."""
    pub = setting(seed)["public"]
    exp = expected_for(seed)
    p, w, r0, r1 = pub["p"], pub["w"], pub["r0"], pub["r1"]
    failures: list[str] = []
    got, err = _call(module, "witness", p, w)
    failures += [err] if err else _compare("witness", got, exp["witness"])
    got, err = _call(module, "shares", p, w, r0, r1)
    failures += [err] if err else _compare("shares", got, exp["shares"])
    got, err = _call(module, "reconstruct", p, w, r0, r1)
    failures += [err] if err else _compare("reconstruct", got, exp["reconstruct"])
    got, err = _call(module, "noleak", p, w, r0)
    failures += [err] if err else _compare("noleak", got, exp["noleak"])
    return failures


def check_linear(module, seed: str) -> list[str]:
    """Lines 5-8: A and B on shares, opened, and the share-wise product that must NOT match."""
    pub = setting(seed)["public"]
    exp = expected_for(seed)
    p, w, r0, r1, ca, cb = pub["p"], pub["w"], pub["r0"], pub["r1"], pub["ca"], pub["cb"]
    failures: list[str] = []
    got, err = _call(module, "ashares", p, w, r0, r1, ca)
    failures += [err] if err else _compare("ashares", got, exp["ashares"])
    got, err = _call(module, "aopen", p, w, r0, r1, ca)
    failures += [err] if err else _compare("aopen", got, exp["aopen"])
    got, err = _call(module, "bshares", p, w, r0, r1, cb)
    failures += [err] if err else _compare("bshares", got, exp["bshares"])
    got, err = _call(module, "crossmul", p, w, r0, r1, ca, cb)
    failures += [err] if err else _compare("crossmul", got, exp["crossmul"])
    return failures


def check_beaver(module, seed: str) -> list[str]:
    """Lines 9-14: the triple check, the one open, C's shares, C, and the two closing checks."""
    pub = setting(seed)["public"]
    exp = expected_for(seed)
    p, w = pub["p"], pub["w"]
    r0, r1, ca, cb = pub["r0"], pub["r1"], pub["ca"], pub["cb"]
    a, b, ra, rb, rc = pub["a"], pub["b"], pub["ra"], pub["rb"], pub["rc"]
    failures: list[str] = []
    got, err = _call(module, "triple", p, a, b, ra, rb, rc)
    failures += [err] if err else _compare("triple", got, exp["triple"])
    got, err = _call(module, "beaveropen", p, w, r0, r1, ca, cb, a, b, ra, rb)
    failures += [err] if err else _compare("beaveropen", got, exp["beaveropen"])
    got, err = _call(module, "cshares", p, w, r0, r1, ca, cb, a, b, ra, rb, rc)
    failures += [err] if err else _compare("cshares", got, exp["cshares"])
    got, err = _call(module, "csum", p, w, r0, r1, ca, cb, a, b, ra, rb, rc)
    failures += [err] if err else _compare("csum", got, exp["csum"])
    got, err = _call(module, "expand", p, w, r0, r1, ca, cb, a, b, ra, rb)
    failures += [err] if err else _compare("expand", got, exp["expand"])
    got, err = _call(module, "nolink", p, w, r0, r1, ca, cb, a, b, ra, rb)
    failures += [err] if err else _compare("nolink", got, exp["nolink"])
    return failures


#: The assignment `co-snark-prove` README's own worked example, by hand: modulus 97,
#: witness [3, 5], coeffs_a = [1, 2] (-> A = 13), coeffs_b = [4, 1] (-> B = 17), Beaver
#: triple a=5/b=9/c=45 with the README's own share randomness (a_sh=[1,4], b_sh=[4,5],
#: c_sh=[20,25]). No deployment ever draws these numbers (see EXCLUDED_* in
#: fixtures/generate.py); this is a fixed, hand-checkable example independent of seed.
_CRAFTED = dict(p=97, w=(3, 5), r0=1, r1=2, ca=(1, 2), cb=(4, 1), a=5, b=9, ra=1, rb=4, rc=20)
_CRAFTED_EXPECTED = {
    "witness": (97, (3, 5)),
    "shares": (2, 3),
    "reconstruct": (3, 5),
    "ashares": [5, 8],
    "aopen": (13, 13),
    "bshares": (6, 11, 17),
    "crossmul": (21, 27),
    "triple": (5, 9, 45, 45),
    "beaveropen": (8, 8),
    "cshares": [27, 0],
    "csum": 27,
    "expand": 27,
}


def check_crafted(module) -> list[str]:
    """Every function against the README's own numbers, worked out by hand (see above)."""
    c = _CRAFTED
    failures: list[str] = []
    got, err = _call(module, "witness", c["p"], c["w"])
    failures += [err] if err else _compare("crafted witness", got, _CRAFTED_EXPECTED["witness"])
    got, err = _call(module, "shares", c["p"], c["w"], c["r0"], c["r1"])
    failures += [err] if err else _compare("crafted shares", got, _CRAFTED_EXPECTED["shares"])
    got, err = _call(module, "reconstruct", c["p"], c["w"], c["r0"], c["r1"])
    failures += (
        [err] if err else _compare("crafted reconstruct", got, _CRAFTED_EXPECTED["reconstruct"])
    )
    got, err = _call(module, "ashares", c["p"], c["w"], c["r0"], c["r1"], c["ca"])
    failures += [err] if err else _compare("crafted ashares", got, _CRAFTED_EXPECTED["ashares"])
    got, err = _call(module, "aopen", c["p"], c["w"], c["r0"], c["r1"], c["ca"])
    failures += [err] if err else _compare("crafted aopen", got, _CRAFTED_EXPECTED["aopen"])
    got, err = _call(module, "bshares", c["p"], c["w"], c["r0"], c["r1"], c["cb"])
    failures += [err] if err else _compare("crafted bshares", got, _CRAFTED_EXPECTED["bshares"])
    got, err = _call(module, "crossmul", c["p"], c["w"], c["r0"], c["r1"], c["ca"], c["cb"])
    failures += [err] if err else _compare("crafted crossmul", got, _CRAFTED_EXPECTED["crossmul"])
    got, err = _call(module, "triple", c["p"], c["a"], c["b"], c["ra"], c["rb"], c["rc"])
    failures += [err] if err else _compare("crafted triple", got, _CRAFTED_EXPECTED["triple"])
    beaver_args = (c["p"], c["w"], c["r0"], c["r1"], c["ca"], c["cb"], c["a"], c["b"], c["ra"], c["rb"])
    got, err = _call(module, "beaveropen", *beaver_args)
    failures += (
        [err] if err else _compare("crafted beaveropen", got, _CRAFTED_EXPECTED["beaveropen"])
    )
    got, err = _call(module, "cshares", *beaver_args, c["rc"])
    failures += [err] if err else _compare("crafted cshares", got, _CRAFTED_EXPECTED["cshares"])
    got, err = _call(module, "csum", *beaver_args, c["rc"])
    failures += [err] if err else _compare("crafted csum", got, _CRAFTED_EXPECTED["csum"])
    got, err = _call(module, "expand", *beaver_args)
    failures += [err] if err else _compare("crafted expand", got, _CRAFTED_EXPECTED["expand"])
    return failures


def check_normalizer() -> list[str]:
    """`normalize_scalar` / `normalize_answer` across every kind the shape grammar defines.

    This drill's own SHAPES only uses "int" and ("int", width); the checks below for
    "bool", "hex" and "str" exercise the same normalizer the sibling drills' graded
    lines rely on, so the group shares one tested contract rather than three untested
    copies.
    """
    failures: list[str] = []

    def expect(label: str, got, expected) -> None:
        if got != expected:
            failures.append(f"normalizer {label}: got {got!r}, expected {expected!r}")

    # int: digits, whitespace, and a bool must never pass as an int.
    expect("int digit string", normalize_scalar("int", "42"), 42)
    expect("int padded string", normalize_scalar("int", "  42  "), 42)
    expect("int passthrough", normalize_scalar("int", 42), 42)
    expect("int rejects bool", normalize_scalar("int", True), None)
    expect("int rejects garbage", normalize_scalar("int", "not-a-number"), None)

    # bool: case-insensitive text, native bool, nothing else.
    expect("bool text True", normalize_scalar("bool", "True"), True)
    expect("bool text false", normalize_scalar("bool", "false"), False)
    expect("bool native", normalize_scalar("bool", False), False)
    expect("bool rejects int", normalize_scalar("bool", 1), None)

    # hex: quotes (single, double, or none) and case are all accepted; comparison is
    # lower-cased; invalid hex digits are rejected.
    expect("hex bare", normalize_scalar("hex", "a1b2c3"), "a1b2c3")
    expect("hex upper", normalize_scalar("hex", "A1B2C3"), "a1b2c3")
    expect("hex single-quoted", normalize_scalar("hex", "'a1b2c3'"), "a1b2c3")
    expect("hex double-quoted", normalize_scalar("hex", '"a1b2c3"'), "a1b2c3")
    expect("hex rejects non-hex", normalize_scalar("hex", "zzzzzz"), None)
    expect("hex rejects empty", normalize_scalar("hex", "''"), None)

    # str: quotes stripped, case preserved, empty rejected.
    expect("str single-quoted", normalize_scalar("str", "'rejected'"), "rejected")
    expect("str bare", normalize_scalar("str", "rejected"), "rejected")
    expect("str rejects non-string", normalize_scalar("str", 5), None)
    expect("str rejects empty", normalize_scalar("str", "''"), None)

    # normalize_answer: tuple splitting (parens, brackets, bare) on this drill's own
    # ("int", width) shapes, plus width and unknown-line rejection.
    expect("answer tuple parens", normalize_answer("shares", "(2, 3)"), (2, 3))
    expect("answer tuple brackets", normalize_answer("shares", "[2, 3]"), (2, 3))
    expect("answer tuple bare", normalize_answer("shares", "2, 3"), (2, 3))
    expect("answer tuple from list", normalize_answer("shares", [2, 3]), (2, 3))
    expect("answer scalar", normalize_answer("csum", "27"), 27)
    expect("answer rejects wrong width", normalize_answer("shares", "(2, 3, 4)"), None)
    expect("answer rejects unknown line", normalize_answer("not-a-line", "1"), None)
    expect("answer rejects bool for int shape", normalize_answer("csum", True), None)

    # Every graded line's shape round-trips its own expected value through
    # normalize_answer, using the crafted example so the check needs no live seed.
    for line, value in {
        "shares": _CRAFTED_EXPECTED["shares"],
        "ashares": tuple(_CRAFTED_EXPECTED["ashares"]),
        "aopen": _CRAFTED_EXPECTED["aopen"],
        "bshares": _CRAFTED_EXPECTED["bshares"],
        "crossmul": _CRAFTED_EXPECTED["crossmul"],
        "beaveropen": _CRAFTED_EXPECTED["beaveropen"],
        "cshares": tuple(_CRAFTED_EXPECTED["cshares"]),
        "csum": _CRAFTED_EXPECTED["csum"],
    }.items():
        assert line in SHAPES, f"{line} missing from SHAPES"
        text = str(list(value)) if isinstance(value, tuple) else str(value)
        got = normalize_answer(line, text)
        expect(f"round-trip {line}", got, value)

    return failures


def run(module, seed: str) -> list[str]:
    failures: list[str] = []
    for phase_check in (check_wiring, check_linear, check_beaver):
        failures.extend(phase_check(module, seed))
    failures.extend(check_crafted(module))
    failures.extend(check_normalizer())
    return failures
