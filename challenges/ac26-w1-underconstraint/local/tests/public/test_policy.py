"""Public tests: shape only, on the one visible circuit.

They confirm your circuit accepts both honest witnesses and that your functions
return the right types. They do not try a single forgery — that is what the hidden
verifier does, and it is where a circuit that "works" turns out to be unsound.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "starter"))

from fixtures.evaluator import satisfies  # noqa: E402
from fixtures.generate import clean_witness, honest_witness, params, vulnerable_circuit  # noqa: E402
import policy  # noqa: E402

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def test_intended_circuit_returns_constraints() -> None:
    circuit = policy.intended_circuit()
    assert isinstance(circuit, list) and circuit, "expected a non-empty constraint list"
    assert all(isinstance(c, dict) and "id" in c for c in circuit)


def test_intended_circuit_accepts_a_revoked_credential() -> None:
    prm = params(SEED)
    assert satisfies(policy.intended_circuit(), honest_witness(prm), prm["p"])


def test_intended_circuit_accepts_a_clean_credential() -> None:
    prm = params(SEED)
    assert satisfies(policy.intended_circuit(), clean_witness(prm), prm["p"])


def test_audit_returns_a_list() -> None:
    assert isinstance(policy.audit(vulnerable_circuit(SEED)), list)


def test_repair_returns_constraints() -> None:
    repaired = policy.repair(vulnerable_circuit(SEED))
    assert isinstance(repaired, list) and repaired


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
        except Exception as error:  # noqa: BLE001
            failures += 1
            print(f"FAIL {name}: raised {type(error).__name__}")
    print()
    if selected == 0:
        print(f"no public test matched --only {only!r}")
        return 1
    print("public tests:", "all passed" if failures == 0 else f"{failures} failed")
    print()
    print("Not one forgery was attempted above. Passing these says nothing about soundness.")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
