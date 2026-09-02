"""Mutation suite: break the reference on purpose, assert the hidden tests notice.

The mutations target this problem's actual failure modes — treating a constraint as
an if-statement, letting a name stand in for a constraint, proving soundness from one
valid example, teaching the submission's own evaluator a kind the grader never had,
sorting a trace back into id order, building a range gadget that lists values instead
of decomposing them, and hiding a single out-of-range value behind a selector so that
only an exact admitted-set check, not a sampled one, can see it.

Run inside the image (or in CI):  python mutation.py
"""

from __future__ import annotations

import json
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tests.hidden.check_circuit import run

SEED = "mutation-suite-seed"
REFERENCE = Path(__file__).resolve().parent / "reference"


def _load(name: str, source: str, deps: dict[str, types.ModuleType]) -> types.ModuleType:
    module = types.ModuleType(name)
    module.__dict__.update({k: v for k, v in deps.items()})
    exec(compile(source, f"<{name}>", "exec"), module.__dict__)  # noqa: S102 - our own fixtures
    return module


def _reference_source(name: str) -> str:
    return (REFERENCE / name).read_text(encoding="utf-8")


def _gadgets_override(extra: str) -> str:
    """The reference gadgets with some functions redefined afterwards.

    Appending keeps every other gadget intact, so a mutation is killed for the defect
    it carries and not for a function it forgot to define.
    """
    return _reference_source("gadgets.py") + "\n\n" + extra


# The product chain: x (x - 1) ... (x - (2**bits - 1)) = 0 spelled out with const /
# add / mul. It is a correct range gadget whose size is 2 * 2**bits, so it fits the
# 5 x bits budget only for bits <= 2 -- the budget is what rejects it on wider ranges.
_PRODUCT_CHAIN = '''
def range_constraints(signal, bits):
    count = 2 ** bits
    out = [
        {"id": "one", "kind": "const", "signal": "one", "value": 1},
        {"id": "zero", "kind": "const", "signal": "zero", "value": 0},
    ]
    previous = signal
    for k in range(1, count):
        out.append({"id": f"y{k}", "kind": "add", "left": f"y{k}", "right": "one", "out": previous})
        previous = f"y{k}"
    product = signal
    for k in range(1, count):
        target = "zero" if k == count - 1 else f"p{k}"
        out.append({"id": f"p{k}", "kind": "mul", "left": product, "right": f"y{k}", "out": target})
        product = target
    return out

def range_witness(signal, value, bits):
    count = 2 ** bits
    witness = {signal: value, "one": 1, "zero": 0}
    for k in range(1, count):
        witness[f"y{k}"] = value - k
    product = value
    for k in range(1, count - 1):
        product = product * (value - k)
        witness[f"p{k}"] = product
    return witness
'''

# A gadget that is sound on every value a sampled check is likely to try and unsound on
# exactly one other. A boolean selector `sel` gates two behaviours: with sel = 0 the
# reference Horner decomposition binds the signal as usual (that is the witness
# `range_witness` hands over for every in-range value); with sel = 1 the digit sum is
# forced to zero, so every digit is zero, and the signal is pushed to 2**bits + 1. The
# gadget therefore admits 0 .. 2**bits - 1 plus 2**bits + 1 -- a value that is neither
# the boundary 2**bits, nor p - 1, nor their midpoint, so a checker that probes a few
# out-of-range samples never sees it. It stays inside the 5 x bits budget from bits = 2
# (3 * bits - 2 + 6 constraints) and falls back to the honest gadget at bits = 1.
# Killing it needs the exact admitted-set computation in check_range. The same source
# is what probes/range_exactness.py runs, so the probe and this suite cannot drift.
_SELECTOR_GADGET = '''
_full_range_constraints = range_constraints
_full_range_witness = range_witness

def range_constraints(signal, bits):
    if bits < 2:
        return _full_range_constraints(signal, bits)
    digits = signal + ".h"
    out = []
    for c in _full_range_constraints(signal, bits):
        c = dict(c)
        for key in ("left", "right", "out", "signal"):
            if c.get(key) == signal:
                c[key] = digits
        out.append(c)
    out += [
        {"id": "sel", "kind": "boolean", "signal": "sel"},
        {"id": "zero", "kind": "const", "signal": "zero", "value": 0},
        {"id": "gate", "kind": "mul", "left": digits, "right": "sel", "out": "zero"},
        {"id": "big", "kind": "const", "signal": "big", "value": 2 ** bits + 1},
        {"id": "jump", "kind": "mul", "left": "sel", "right": "big", "out": "jump"},
        {"id": "link", "kind": "add", "left": digits, "right": "jump", "out": signal},
    ]
    return out

def range_witness(signal, value, bits):
    witness = _full_range_witness(signal, value, bits)
    if bits >= 2:
        witness[signal + ".h"] = value
        witness.update({"sel": 0, "zero": 0, "big": 2 ** bits + 1, "jump": 0})
    return witness
'''

# (name, {file: source})
MUTATIONS: list[tuple[str, dict[str, str]]] = [
    (
        "evaluate returns the raw subtraction without normalizing",
        {
            "circuit": _reference_source("circuit.py").replace(
                'return field.sub(_get(witness, constraint["signal"]), int(constraint["value"]))',
                'return _get(witness, constraint["signal"]) - int(constraint["value"])',
            )
        },
    ),
    (
        "normalize forgets negative values",
        {
            "field": _reference_source("field.py").replace(
                "return value % self.modulus", "return value if value >= 0 else value"
            )
        },
    ),
    (
        "boolean gadget is a name, not a constraint",
        {
            "gadgets": _gadgets_override(
                '''
def boolean_constraint(signal):
    return {"id": "bool", "kind": "const", "signal": signal, "value": 0}
'''
            )
        },
    ),
    (
        "membership gadget only pins the first allowed value",
        {
            "gadgets": _gadgets_override(
                '''
def membership_constraints(signal, allowed):
    return [{"id": "m", "kind": "const", "signal": signal, "value": int(allowed[0])}]
'''
            )
        },
    ),
    (
        "gadgets invent a kind that only the submission's own evaluate understands",
        {
            "gadgets": _gadgets_override(
                '''
def boolean_constraint(signal):
    return {"id": "bool", "kind": "in-set", "signal": signal, "allowed": [0, 1]}

def membership_constraints(signal, allowed):
    return [{"id": "m", "kind": "in-set", "signal": signal, "allowed": list(allowed)}]
'''
            ),
            "circuit": _reference_source("circuit.py").replace(
                '    raise ValueError(f"unknown constraint kind: {kind}")',
                '    if kind == "in-set":\n'
                '        return 0 if _get(witness, constraint["signal"]) in constraint["allowed"] else 1\n'
                '    raise ValueError(f"unknown constraint kind: {kind}")',
            ),
        },
    ),
    (
        "missing signal treated as zero instead of raising",
        {
            "circuit": _reference_source("circuit.py").replace(
                '''    if name not in witness:
        raise MissingSignal(name)
    return witness[name]''',
                "    return witness.get(name, 0)",
            )
        },
    ),
    (
        "first_broken returns the first constraint regardless of residual",
        {
            "circuit": _reference_source("circuit.py").replace(
                '''    for entry in trace(circuit, witness, field):
        if entry["residual"] != 0:
            return str(entry["id"])
    return None''',
                '    return str(circuit[0]["id"]) if circuit else None',
            )
        },
    ),
    (
        "trace sorts by id descending, losing circuit order",
        {
            "circuit": _reference_source("circuit.py").replace(
                "    return [\n        {\"id\": c[\"id\"], \"residual\": evaluate(c, witness, field)} for c in circuit\n    ]",
                "    ordered = sorted(circuit, key=lambda c: str(c['id']), reverse=True)\n"
                "    return [{'id': c['id'], 'residual': evaluate(c, witness, field)} for c in ordered]",
            )
        },
    ),
    (
        "trace sorts by id ascending, matching the public circuit's order",
        {
            "circuit": _reference_source("circuit.py").replace(
                "    return [\n        {\"id\": c[\"id\"], \"residual\": evaluate(c, witness, field)} for c in circuit\n    ]",
                "    ordered = sorted(circuit, key=lambda c: str(c['id']))\n"
                "    return [{'id': c['id'], 'residual': evaluate(c, witness, field)} for c in ordered]",
            )
        },
    ),
    (
        "evaluate flips the sign of mul and add residuals",
        {
            "circuit": _reference_source("circuit.py")
            .replace(
                'return field.sub(field.mul(left, right), _get(witness, constraint["out"]))',
                'return field.sub(_get(witness, constraint["out"]), field.mul(left, right))',
            )
            .replace(
                'return field.sub(field.add(left, right), _get(witness, constraint["out"]))',
                'return field.sub(_get(witness, constraint["out"]), field.add(left, right))',
            )
        },
    ),
    (
        "range gadget lists every value with a member constraint",
        {
            "gadgets": _gadgets_override(
                '''
def range_constraints(signal, bits):
    return [{"id": "r", "kind": "member", "signal": signal, "allowed": list(range(2 ** bits))}]

def range_witness(signal, value, bits):
    return {signal: value}
'''
            )
        },
    ),
    (
        "range gadget forgets the boolean constraints on the digits",
        {
            "gadgets": _gadgets_override(
                '''
_full_range_constraints = range_constraints

def range_constraints(signal, bits):
    return [c for c in _full_range_constraints(signal, bits) if c["kind"] != "boolean"] or [
        {"id": "keep", "kind": "add", "left": signal, "right": signal, "out": signal + ".twice"}
    ]

_full_range_witness = range_witness

def range_witness(signal, value, bits):
    witness = _full_range_witness(signal, value, bits)
    witness[signal + ".twice"] = 2 * value
    return witness
'''
            )
        },
    ),
    (
        "range gadget uses one digit too many",
        {
            "gadgets": _gadgets_override(
                '''
_full_range_constraints = range_constraints
_full_range_witness = range_witness

def range_constraints(signal, bits):
    return _full_range_constraints(signal, bits + 1)

def range_witness(signal, value, bits):
    return _full_range_witness(signal, value, bits + 1)
'''
            )
        },
    ),
    (
        "range gadget ignores bits and always builds three digits",
        {
            "gadgets": _gadgets_override(
                '''
_full_range_constraints = range_constraints
_full_range_witness = range_witness

def range_constraints(signal, bits):
    return _full_range_constraints(signal, 3)

def range_witness(signal, value, bits):
    return _full_range_witness(signal, value, 3)
'''
            )
        },
    ),
    (
        "range gadget spells out the product of 2**bits factors instead of decomposing",
        {"gadgets": _gadgets_override(_PRODUCT_CHAIN)},
    ),
    (
        "range witness reads the digits in reverse order",
        {
            "gadgets": _gadgets_override(
                '''
_full_range_witness = range_witness

def range_witness(signal, value, bits):
    if bits == 1:
        return {signal: value}
    mirrored = int("".join(str((value // 2 ** i) % 2) for i in range(bits)), 2)
    witness = _full_range_witness(signal, mirrored, bits)
    witness[signal] = value
    return witness
'''
            )
        },
    ),
    (
        "range gadget never links the digit sum to the signal",
        {
            "gadgets": _gadgets_override(
                '''
_full_range_constraints = range_constraints
_full_range_witness = range_witness

def range_constraints(signal, bits):
    out = []
    for c in _full_range_constraints(signal, bits):
        c = dict(c)
        for key in ("left", "right", "out", "signal"):
            if c.get(key) == signal:
                c[key] = signal + ".s0"
        out.append(c)
    return out

def range_witness(signal, value, bits):
    witness = _full_range_witness(signal, value, bits)
    witness[signal + ".s0"] = value
    return witness
'''
            )
        },
    ),
    (
        "range gadget pads wide ranges with free signals multiplied by zero",
        {
            "gadgets": _gadgets_override(
                '''
_full_range_constraints = range_constraints
_full_range_witness = range_witness

def range_constraints(signal, bits):
    if bits < 5:
        return _full_range_constraints(signal, bits)
    padding = [
        {"id": "zero", "kind": "const", "signal": "zero", "value": 0},
        {"id": "zero2", "kind": "const", "signal": "zero2", "value": 0},
    ] + [
        {"id": f"pad{i}", "kind": "mul", "left": "zero", "right": f"free{i}", "out": "zero2"}
        for i in range(4)
    ]
    return padding + _full_range_constraints(signal, bits)

def range_witness(signal, value, bits):
    witness = _full_range_witness(signal, value, bits)
    if bits >= 5:
        witness.update({"zero": 0, "zero2": 0, **{f"free{i}": 0 for i in range(4)}})
    return witness
'''
            )
        },
    ),
    (
        "range gadget hides one extra value behind a boolean selector",
        {"gadgets": _gadgets_override(_SELECTOR_GADGET)},
    ),
]

#: Mutations whose kill must come from a specific rule, so that the rule itself is
#: exercised (a mutation killed for an unrelated reason proves nothing about it).
EXPECTED_REASON = {
    "evaluate returns the raw subtraction without normalizing": "not an integer in 0 .. p-1",
    "gadgets invent a kind that only the submission's own evaluate understands": "five documented kinds",
    "trace sorts by id ascending, matching the public circuit's order": "order the circuit was given in",
    "evaluate flips the sign of mul and add residuals": "does not match the constraint's expression",
    "range gadget lists every value with a member constraint": "boolean, add, mul, const",
    "range gadget forgets the boolean constraints on the digits": "outside 0 .. 2^bits - 1",
    "range gadget uses one digit too many": "outside 0 .. 2^bits - 1",
    "range gadget spells out the product of 2**bits factors instead of decomposing": "more than 5 x bits",
    "range gadget never links the digit sum to the signal": "outside 0 .. 2^bits - 1",
    "range gadget pads wide ranges with free signals multiplied by zero": "exceeded its budget",
    "range gadget hides one extra value behind a boolean selector": "outside 0 .. 2^bits - 1",
}


def _modules(field_src: str, circuit_src: str, gadgets_src: str):
    """Build the three modules in dependency order.

    `circuit.py` does `from field import Field`, exactly as the learner's copy does
    inside the /verify workspace. Registering the mutated field module under the name
    `field` keeps the mutation harness running the same import path as the real
    submission, instead of a rewired one that could mask a defect.
    """
    field_module = _load("mut_field", field_src, {})
    sys.modules["field"] = field_module
    circuit_module = _load("mut_circuit", circuit_src, {})
    gadgets_module = _load("mut_gadgets", gadgets_src, {})
    return field_module, circuit_module, gadgets_module


def _bundle(sources: dict[str, str]) -> str:
    """The JSON the Workbench's /api/prepare seals for every code checkpoint."""
    return json.dumps({f"{name}.py": text for name, text in sources.items()})


def main() -> int:
    base = {
        "field": _reference_source("field.py"),
        "circuit": _reference_source("circuit.py"),
        "gadgets": _reference_source("gadgets.py"),
    }
    if run(*_modules(base["field"], base["circuit"], base["gadgets"]), SEED):
        print("FAIL reference implementation does not pass the hidden tests")
        return 1
    print("PASS reference implementation passes the hidden tests")

    survivors: list[str] = []
    for name, replaced in MUTATIONS:
        sources = {**base, **replaced}
        failures = run(*_modules(sources["field"], sources["circuit"], sources["gadgets"]), SEED)
        expected = EXPECTED_REASON.get(name)
        if not failures:
            survivors.append(name)
            print(f"SURVIVED {name}")
        elif expected is not None and not any(expected in failure for failure in failures):
            survivors.append(f"{name} (killed, but not by the rule it targets: {failures[0]})")
            print(f"SURVIVED {name} -- killed for the wrong reason ({failures[0]})")
        else:
            print(f"KILLED {name} ({failures[0]})")

    # Verifier-level near misses: the whole /verify path, not just the checker.
    from verifier.server import evaluate  # noqa: PLC0415 - imported after sys.path

    verifier_cases = [
        ("verifier accepts the wrong constraint id", "first-broken", "c0", False, ""),
        ("verifier rejects the reference range gadget", "range", _bundle(base), True, ""),
        ("verifier accepts the starter range gadget", "range", _bundle({**base, "gadgets": (REFERENCE.parent / "starter" / "gadgets.py").read_text(encoding="utf-8")}), False, "no constraints"),
        ("verifier accepts a member-listing range gadget", "range", _bundle({**base, "gadgets": dict(MUTATIONS)["range gadget lists every value with a member constraint"]["gadgets"]}), False, "boolean, add, mul, const"),
        ("verifier accepts an invented-kind boolean gadget", "boolean", _bundle({**base, **dict(MUTATIONS)["gadgets invent a kind that only the submission's own evaluate understands"]}), False, "five documented kinds"),
        ("verifier accepts an id-sorted trace", "residuals", _bundle({**base, **dict(MUTATIONS)["trace sorts by id ascending, matching the public circuit's order"]}), False, "order the circuit was given in"),
    ]
    for name, checkpoint, submission, want_correct, want_in_message in verifier_cases:
        correct, message = evaluate(checkpoint, submission)
        if correct != want_correct or (want_in_message and want_in_message not in message):
            survivors.append(name)
            print(f"SURVIVED {name} (correct={correct}, message={message!r})")
        else:
            print(f"KILLED {name}" if not want_correct else f"PASS {name} -- it does not")

    print()
    if survivors:
        print(f"{len(survivors)} mutation(s) survived:")
        for name in survivors:
            print(f"  - {name}")
        return 1
    print(f"All {len(MUTATIONS) + len(verifier_cases)} mutations killed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
