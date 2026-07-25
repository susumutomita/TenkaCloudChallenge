"""Mutation suite: break the reference on purpose, assert the hidden tests notice.

The mutations target this problem's actual failure modes — treating a constraint as
an if-statement, letting a name stand in for a constraint, and proving soundness
from one valid example.

Run inside the image (or in CI):  python mutation.py
"""

from __future__ import annotations

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


# (name, which file is replaced, source)
MUTATIONS: list[tuple[str, str, str]] = [
    (
        "normalize forgets negative values",
        "field",
        _reference_source("field.py").replace(
            "return value % self.modulus", "return value if value >= 0 else value"
        ),
    ),
    (
        "boolean gadget is a name, not a constraint",
        "gadgets",
        '''
def boolean_constraint(signal):
    return {"id": "bool", "kind": "const", "signal": signal, "value": 0}

def membership_constraints(signal, allowed):
    return [{"id": "m", "kind": "member", "signal": signal, "allowed": list(allowed)}]
''',
    ),
    (
        "membership gadget only pins the first allowed value",
        "gadgets",
        '''
def boolean_constraint(signal):
    return {"id": "bool", "kind": "boolean", "signal": signal}

def membership_constraints(signal, allowed):
    return [{"id": "m", "kind": "const", "signal": signal, "value": int(allowed[0])}]
''',
    ),
    (
        "missing signal treated as zero instead of raising",
        "circuit",
        _reference_source("circuit.py").replace(
            '''    if name not in witness:
        raise MissingSignal(name)
    return witness[name]''',
            "    return witness.get(name, 0)",
        ),
    ),
    (
        "first_broken returns the first constraint regardless of residual",
        "circuit",
        _reference_source("circuit.py").replace(
            '''    for entry in trace(circuit, witness, field):
        if entry["residual"] != 0:
            return str(entry["id"])
    return None''',
            '    return str(circuit[0]["id"]) if circuit else None',
        ),
    ),
    (
        "trace sorts by id, losing circuit order",
        "circuit",
        _reference_source("circuit.py").replace(
            "    return [\n        {\"id\": c[\"id\"], \"residual\": evaluate(c, witness, field)} for c in circuit\n    ]",
            "    ordered = sorted(circuit, key=lambda c: str(c['id']), reverse=True)\n"
            "    return [{'id': c['id'], 'residual': evaluate(c, witness, field)} for c in ordered]",
        ),
    ),
]


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


def main() -> int:
    base = (
        _reference_source("field.py"),
        _reference_source("circuit.py"),
        _reference_source("gadgets.py"),
    )
    if run(*_modules(*base), SEED):
        print("FAIL reference implementation does not pass the hidden tests")
        return 1
    print("PASS reference implementation passes the hidden tests")

    survivors: list[str] = []
    for name, target, source in MUTATIONS:
        sources = {
            "field": base[0],
            "circuit": base[1],
            "gadgets": base[2],
        }
        sources[target] = source
        failures = run(
            *_modules(sources["field"], sources["circuit"], sources["gadgets"]), SEED
        )
        if failures:
            print(f"KILLED {name} ({failures[0]})")
        else:
            survivors.append(name)
            print(f"SURVIVED {name}")

    from verifier.server import evaluate  # noqa: PLC0415 - imported after sys.path

    if evaluate("first-broken", "c0"):
        survivors.append("verifier accepts the wrong constraint id")
        print("SURVIVED verifier accepts the wrong constraint id")
    else:
        print("KILLED verifier accepts the wrong constraint id")

    print()
    if survivors:
        print(f"{len(survivors)} mutation(s) survived:")
        for name in survivors:
            print(f"  - {name}")
        return 1
    print(f"All {len(MUTATIONS) + 1} mutations killed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
