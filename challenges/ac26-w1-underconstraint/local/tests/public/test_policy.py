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
SUBMISSION_DIR = os.environ.get("SUBMISSION_DIR")
sys.path.insert(0, str(ROOT))
sys.path.insert(0, SUBMISSION_DIR or str(ROOT / "starter"))

from participant.evaluator import satisfies  # noqa: E402
from participant.evidence import public_evidence  # noqa: E402
import policy  # noqa: E402
from participant.server import (  # noqa: E402
    inspect_payload,
    prepare_submissions,
    run_public_tests,
    starter_payload,
)

# Issue 537/543 option B2: `fixtures/generate.py` does not ship in the participant image
# any more -- `_ISZERO_HALVES` there is both halves of the is-zero gadget as dicts, under
# the exact ids the checkpoints require, which is `intended_circuit()`'s answer.
# `public_evidence()` reads this deployment's public half from the verifier's `GET /public`
# over the Compose-internal network (or `PUBLIC_EVIDENCE_JSON`, or the checkout's own
# fixtures when neither is set) and hands back the same parameters, deployed circuit and
# honest witnesses this file has always used.
SEED = os.environ.get("FLAG_SEED", "local-dev-seed")
WORKBENCH_TEST_SEED = "public-workbench-test"
EVIDENCE = public_evidence()
PARAMS = EVIDENCE["parameters"]
DEPLOYED_CIRCUIT = EVIDENCE["deployedCircuit"]
REVOKED_WITNESS = EVIDENCE["honestWitnesses"]["revokedCredential"]
CLEAN_WITNESS = EVIDENCE["honestWitnesses"]["cleanCredential"]


def test_intended_circuit_returns_constraints() -> None:
    circuit = policy.intended_circuit()
    assert isinstance(circuit, list) and circuit, "expected a non-empty constraint list"
    assert all(isinstance(c, dict) and "id" in c for c in circuit)


def test_intended_circuit_accepts_a_revoked_credential() -> None:
    assert satisfies(policy.intended_circuit(), REVOKED_WITNESS, PARAMS["p"])


def test_intended_circuit_accepts_a_clean_credential() -> None:
    assert satisfies(policy.intended_circuit(), CLEAN_WITNESS, PARAMS["p"])


def test_audit_returns_a_list() -> None:
    assert isinstance(policy.audit([dict(c) for c in DEPLOYED_CIRCUIT]), list)


def test_repair_returns_constraints() -> None:
    repaired = policy.repair([dict(c) for c in DEPLOYED_CIRCUIT])
    assert isinstance(repaired, list) and repaired


def test_workbench_inspect_shows_seeded_evidence_without_answers() -> None:
    payload = inspect_payload()
    assert payload["parameters"] == PARAMS
    assert [c["id"] for c in payload["deployedCircuit"]] == [c["id"] for c in DEPLOYED_CIRCUIT]
    assert set(payload["honestWitnesses"]) == {"revokedCredential", "cleanCredential"}
    assert set(payload["iszeroGadget"]) == {"iszero_a", "iszero_b"}
    # The deployed circuit is evidence; the id of the dropped constraint is the
    # answer to audit, so it must appear nowhere but implicitly, by absence.
    assert set(payload) == {
        "policy",
        "parameters",
        "deployedCircuit",
        "honestWitnesses",
        "iszeroGadget",
        "healthToken",
    }
    # Exactly one half of the is-zero gadget survives in the deployed circuit. The
    # other one is `intended_circuit()`'s answer and is what left the image with
    # `fixtures/` -- so it must not come back over the wire either.
    kinds = [c.get("kind") for c in payload["deployedCircuit"]]
    assert sorted(k for k in kinds if k in ("iszero_a", "iszero_b")) in (
        ["iszero_a"],
        ["iszero_b"],
    )


def test_workbench_starter_returns_the_editable_file() -> None:
    payload = starter_payload()
    assert set(payload) == {"policy.py"}
    for name in ("intended_circuit", "audit", "forge_witness", "repair"):
        assert f"def {name}" in payload["policy.py"]


def test_workbench_public_tests_pass_the_shipped_starter() -> None:
    # The starter deliberately passes every public test while its circuit has no
    # is-zero gadget at all: that is misconception.happy-path-proves-soundness.
    result = run_public_tests(WORKBENCH_TEST_SEED, starter_payload())
    assert result["passed"] is True
    assert "public tests: all passed" in result["output"]


def test_workbench_public_tests_report_invalid_browser_source() -> None:
    result = run_public_tests(WORKBENCH_TEST_SEED, {"policy.py": "def intended_circuit(:\n"})
    assert result["passed"] is False
    assert result["output"]


def test_workbench_prepare_returns_the_code_checkpoints() -> None:
    result = prepare_submissions(WORKBENCH_TEST_SEED, starter_payload())
    assert result["ok"] is True
    submissions = result["submissions"]
    # root-cause is the learner's own diagnosis, never produced here.
    assert set(submissions) == {"build", "audit", "exploit", "repair", "mutation-transfer"}
    for value in submissions.values():
        assert "def intended_circuit" in value


def test_workbench_prepare_rejects_an_empty_source() -> None:
    result = prepare_submissions(WORKBENCH_TEST_SEED, {"policy.py": "   "})
    assert result["ok"] is False


def test_portal_editor_replaces_static_assets() -> None:
    assert not (ROOT / "workbench").exists()
    server = (ROOT / "participant" / "server.py").read_text(encoding="utf-8")
    for endpoint in ("/api/config", "/api/starter", "/api/inspect", "/api/test", "/api/prepare"):
        assert endpoint in server


def test_workbench_cannot_derive_a_verdict_by_itself() -> None:
    """Issue 525/543: the Workbench forwards `/verify`, it never grades.

    Runs inside the participant image, where `verifier/` does not exist at all -- so
    this also fails loudly if a future change copies the grader back in.
    """
    from participant import server

    assert not hasattr(server, "evaluate")
    assert not any(name.startswith("_check_") for name in dir(server))
    body = {"checkpointId": "root-cause", "submission": "anything"}
    assert server.proxy_verdict(body, "") == {"checkpointId": "root-cause", "correct": False}


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
