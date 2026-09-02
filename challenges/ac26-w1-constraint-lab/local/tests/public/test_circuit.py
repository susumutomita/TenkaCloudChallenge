"""Public tests: the shape of your answers on the one visible circuit.

They confirm your field normalizes, your trace has the right length and order, your
gadgets return constraint dicts, and your range gadget accepts its own witnesses on
small widths. They use ONE prime and ONE circuit, so they cannot tell you whether
your boolean gadget rejects `flag = 2` in a different field, or whether your range
gadget lets a value outside the range through. That is the hidden verifier's job,
deliberately.
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

import circuit as circuit_module  # noqa: E402
import field as field_module  # noqa: E402
import gadgets as gadgets_module  # noqa: E402

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def _load_public_evidence() -> dict[str, object]:
    """This deployment's public evidence -- the field, the circuit, and an honest and
    a broken witness to compare, the same things `show.py` and the Portal both print.

    Issue 543/537: this file used to import `fixtures.generate` directly. `fixtures/`
    does not ship in the `participant` Docker stage at all any more (see
    ../../Dockerfile) -- keeping the seed-keyed generators reachable here is what let a
    learner skip straight past `first-broken` with nothing but their own container's
    `FLAG_SEED`. This deployment's own verifier is the only source for this evidence
    now: `PUBLIC_EVIDENCE_JSON` when `participant/server.py` has already fetched it
    (the Portal path, and the sandboxed run `make test` also uses), or
    `VERIFIER_PUBLIC_URL` fetched directly when neither is true.
    """
    injected = os.environ.get("PUBLIC_EVIDENCE_JSON")
    if injected:
        return json.loads(injected)
    verifier_public_url = os.environ.get("VERIFIER_PUBLIC_URL")
    if verifier_public_url:
        from urllib.request import urlopen

        with urlopen(verifier_public_url, timeout=10) as response:  # noqa: S310
            return json.loads(response.read().decode("utf-8"))
    # Neither is set: this only resolves when `fixtures/` is actually on disk, which is
    # true for a checkout (this file run directly, e.g. by
    # scripts/ac26-w1-constraint-lab.test.ts) or the verifier/author Docker stage, and
    # never true inside a built `participant` image -- so this branch existing does not
    # reopen Issue 543/537's leak.
    from fixtures.generate import public_payload

    return public_payload(SEED)


PUBLIC = _load_public_evidence()


def _field():
    return field_module.Field(PUBLIC["field"]["p"])


def test_normalize_maps_into_the_field() -> None:
    p = PUBLIC["field"]["p"]
    f = _field()
    assert f.normalize(p) == 0, "the modulus itself should normalize to zero"
    assert f.normalize(-1) == p - 1, "a negative value should normalize into [0, p)"


def test_trace_has_one_entry_per_constraint() -> None:
    circ = PUBLIC["circuit"]
    entries = circuit_module.trace(circ, PUBLIC["honestWitness"], _field())
    assert len(entries) == len(circ), "one entry per constraint"


def test_trace_preserves_circuit_order() -> None:
    circ = PUBLIC["circuit"]
    entries = circuit_module.trace(circ, PUBLIC["honestWitness"], _field())
    assert [e["id"] for e in entries] == [c["id"] for c in circ]


def test_honest_witness_has_no_broken_constraint() -> None:
    circ = PUBLIC["circuit"]
    assert circuit_module.first_broken(circ, PUBLIC["honestWitness"], _field()) is None


def test_gadgets_return_constraint_dicts() -> None:
    assert isinstance(gadgets_module.boolean_constraint("b"), dict)
    assert isinstance(gadgets_module.membership_constraints("m", [1, 2]), list)


# The range checkpoint's rules, on small widths. These use YOUR evaluate to substitute
# your witness into your constraints, so they can show you a value inside the range
# that your own gadget rejects. They cannot show you a value outside the range that
# it admits -- that needs a search over every auxiliary assignment, which is the
# hidden verifier's job. Reason that one out on paper: for 8 = 0 + 0*2 + 0*4 + 8, no
# choice of three 0/1 digits reaches the last constraint.
RANGE_KINDS = ("boolean", "add", "mul", "const")
RANGE_WIDTHS = (1, 2, 3)


def test_range_gadget_uses_only_the_allowed_kinds() -> None:
    for bits in RANGE_WIDTHS:
        constraints = gadgets_module.range_constraints("x", bits)
        assert isinstance(constraints, list) and constraints, (
            f"range_constraints returned no constraints for bits={bits}"
        )
        for constraint in constraints:
            assert isinstance(constraint, dict) and constraint.get("kind") in RANGE_KINDS, (
                "range_constraints may use boolean / add / mul / const only"
            )
        assert len(constraints) <= 5 * bits, (
            f"range_constraints returned more than 5 x bits constraints for bits={bits}"
        )


def test_range_witness_assigns_the_signal() -> None:
    for bits in RANGE_WIDTHS:
        for value in range(2**bits):
            witness = gadgets_module.range_witness("x", value, bits)
            assert isinstance(witness, dict) and witness.get("x") == value, (
                "range_witness must return a dict that assigns `value` to the signal"
            )


def test_range_witness_satisfies_your_own_constraints() -> None:
    f = _field()
    for bits in RANGE_WIDTHS:
        constraints = gadgets_module.range_constraints("x", bits)
        assert constraints, f"range_constraints returned no constraints for bits={bits}"
        for value in range(2**bits):
            witness = gadgets_module.range_witness("x", value, bits)
            entries = circuit_module.trace(constraints, witness, f)
            assert len(entries) == len(constraints), "trace should have one entry per range constraint"
            broken = [e["id"] for e in entries if f.normalize(int(e["residual"])) != 0]
            assert not broken, (
                f"bits={bits}, value {value}: your witness leaves {broken} non-zero (by your own evaluate)"
            )


def test_workbench_inspect_shows_seeded_evidence_without_answers() -> None:
    from participant.server import inspect_payload

    payload = inspect_payload()
    assert payload["field"]["p"] == PUBLIC["field"]["p"]
    assert isinstance(payload["field"]["allowedSet"], list)
    assert [c["id"] for c in payload["circuit"]] == [c["id"] for c in PUBLIC["circuit"]]
    assert isinstance(payload["honestWitness"], dict)
    # The broken witness is evidence; the id of the first violated constraint is
    # the answer to first-broken, so only the witness may appear.
    assert set(payload) == {"field", "circuit", "honestWitness", "brokenWitness", "healthToken"}


def test_workbench_starter_returns_all_editable_files() -> None:
    from participant.server import starter_payload

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
    from participant.server import run_public_tests, starter_payload

    sources = starter_payload()
    sources["field.py"] = "class Field(:\n"
    result = run_public_tests(sources)
    assert result["passed"] is False
    assert result["output"]


def test_workbench_prepare_returns_the_file_checkpoints() -> None:
    from participant.server import prepare_submissions, starter_payload

    result = prepare_submissions(starter_payload())
    assert result["ok"] is True
    submissions = result["submissions"]
    # first-broken is read off the trace by the learner, never produced here.
    assert set(submissions) == {"residuals", "boolean", "membership", "range"}
    for value in submissions.values():
        assert set(json.loads(value)) == {"field.py", "circuit.py", "gadgets.py"}


def test_workbench_prepare_rejects_a_missing_file() -> None:
    from participant.server import prepare_submissions, starter_payload

    sources = starter_payload()
    del sources["gadgets.py"]
    result = prepare_submissions(sources)
    assert result["ok"] is False


def test_portal_editor_replaces_static_assets() -> None:
    assert not (ROOT / "workbench").exists()
    server = (ROOT / "participant" / "server.py").read_text(encoding="utf-8")
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
