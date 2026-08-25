"""Public tests: the shape of your answers on the one visible circuit.

They confirm your field normalizes, your trace has the right length and order, and
your gadgets return constraint dicts. They use ONE prime and ONE circuit, so they
cannot tell you whether your boolean gadget rejects `flag = 2` in a different field.
That is the hidden verifier's job, deliberately.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SUBMISSION_DIR = os.environ.get("SUBMISSION_DIR")
sys.path.insert(0, str(ROOT))
sys.path.insert(0, SUBMISSION_DIR or str(ROOT / "starter"))

from fixtures.generate import circuit, field_modulus, honest_witness  # noqa: E402
import circuit as circuit_module  # noqa: E402
import field as field_module  # noqa: E402
import gadgets as gadgets_module  # noqa: E402
from verifier.server import (  # noqa: E402
    inspect_payload,
    prepare_submissions,
    run_public_tests,
    starter_payload,
)

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")
WORKBENCH_TEST_SEED = "public-workbench-test"


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


def test_workbench_inspect_shows_seeded_evidence_without_answers() -> None:
    payload = inspect_payload(WORKBENCH_TEST_SEED)
    assert payload["field"]["p"] == field_modulus(WORKBENCH_TEST_SEED)
    assert isinstance(payload["field"]["allowedSet"], list)
    assert [c["id"] for c in payload["circuit"]] == [c["id"] for c in circuit(WORKBENCH_TEST_SEED)]
    assert isinstance(payload["honestWitness"], dict)
    # The broken witness is evidence; the id of the first violated constraint is
    # the answer to first-broken, so only the witness may appear.
    assert set(payload) == {"field", "circuit", "honestWitness", "brokenWitness", "healthToken"}


def test_workbench_starter_returns_all_editable_files() -> None:
    payload = starter_payload()
    assert set(payload) == {"field.py", "circuit.py", "gadgets.py"}
    assert "class Field" in payload["field.py"]
    assert "def trace" in payload["circuit.py"]
    assert "def boolean_constraint" in payload["gadgets.py"]


# There is deliberately no "the shipped starter fails" self-check in this file.
# `starter_payload()` reads whatever is on disk under `starter/` right now, and `make
# test` bind-mounts the learner's own working copy over that path. A self-check built
# on `starter_payload()` therefore inverts into a false failure the instant a learner
# solves the problem correctly (Issue #526). The author-time version of this
# invariant -- the checked-out, as-shipped `starter/field.py` must fail the public
# suite -- lives in `scripts/ac26-w1-constraint-lab.test.ts`, which reads the real
# repository file directly instead of going through the workbench server.


def test_workbench_public_tests_report_invalid_browser_source() -> None:
    sources = starter_payload()
    sources["field.py"] = "class Field(:\n"
    result = run_public_tests(WORKBENCH_TEST_SEED, sources)
    assert result["passed"] is False
    assert result["output"]


def test_workbench_prepare_returns_the_file_checkpoints() -> None:
    result = prepare_submissions(WORKBENCH_TEST_SEED, starter_payload())
    assert result["ok"] is True
    submissions = result["submissions"]
    # first-broken is read off the trace by the learner, never produced here.
    assert set(submissions) == {"residuals", "boolean", "membership", "transfer"}
    for value in submissions.values():
        assert set(json.loads(value)) == {"field.py", "circuit.py", "gadgets.py"}


def test_workbench_prepare_rejects_a_missing_file() -> None:
    sources = starter_payload()
    del sources["gadgets.py"]
    result = prepare_submissions(WORKBENCH_TEST_SEED, sources)
    assert result["ok"] is False


def test_portal_editor_replaces_static_assets() -> None:
    assert not (ROOT / "workbench").exists()
    server = (ROOT / "verifier" / "server.py").read_text(encoding="utf-8")
    for endpoint in ("/api/config", "/api/starter", "/api/inspect", "/api/test", "/api/prepare"):
        assert endpoint in server


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
        if os.environ.get("BROWSER_PUBLIC_TESTS") == "1" and name.startswith("test_workbench_"):
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
