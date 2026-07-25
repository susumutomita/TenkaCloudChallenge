"""Public tests: the shape of your answers on the one visible circuit.

They confirm your field normalizes, your trace has the right length and order, and
your gadgets return constraint dicts. They use ONE prime and ONE circuit, so they
cannot tell you whether your boolean gadget rejects `flag = 2` in a different field.
That is the hidden verifier's job, deliberately.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "starter"))

from fixtures.generate import circuit, field_modulus, honest_witness  # noqa: E402
import circuit as circuit_module  # noqa: E402
import field as field_module  # noqa: E402
import gadgets as gadgets_module  # noqa: E402

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def _field():
    return field_module.Field(field_modulus(SEED))


def test_normalize_maps_into_the_field() -> None:
    p = field_modulus(SEED)
    f = _field()
    assert f.normalize(p) == 0, "the modulus itself should normalize to zero"
    assert f.normalize(-1) == p - 1, "a negative value should normalize into [0, p)"


def test_trace_has_one_entry_per_constraint() -> None:
    circ = circuit(SEED)
    entries = circuit_module.trace(circ, honest_witness(SEED), _field())
    assert len(entries) == len(circ), "one entry per constraint"


def test_trace_preserves_circuit_order() -> None:
    circ = circuit(SEED)
    entries = circuit_module.trace(circ, honest_witness(SEED), _field())
    assert [e["id"] for e in entries] == [c["id"] for c in circ]


def test_honest_witness_has_no_broken_constraint() -> None:
    circ = circuit(SEED)
    assert circuit_module.first_broken(circ, honest_witness(SEED), _field()) is None


def test_gadgets_return_constraint_dicts() -> None:
    assert isinstance(gadgets_module.boolean_constraint("b"), dict)
    assert isinstance(gadgets_module.membership_constraints("m", [1, 2]), list)


def main() -> int:
    only = ""
    if "--only" in sys.argv:
        index = sys.argv.index("--only")
        only = sys.argv[index + 1] if index + 1 < len(sys.argv) else ""

    failures = 0
    selected = 0
    for name, fn in sorted(globals().items()):
        if not name.startswith("test_") or not callable(fn):
            continue
        if only and only not in name:
            continue
        selected += 1
        try:
            fn()
            print(f"PASS {name}")
        except AssertionError as error:
            failures += 1
            print(f"FAIL {name}: {error or 'assertion failed'}")
        except Exception as error:  # noqa: BLE001 - an exception is a failing test here
            failures += 1
            print(f"FAIL {name}: raised {type(error).__name__}")
    print()
    if selected == 0:
        print(f"no public test matched --only {only!r}")
        return 1
    print("public tests:", "all passed" if failures == 0 else f"{failures} failed")
    print()
    print("One prime, one circuit. The hidden verifier uses several of each.")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
