"""Public tests: answer shape and the browser-only participant contract.

They confirm classify() returns the three keys and that your generators return
integers. They cannot tell you whether the unsound verifier accepts your out-of-range witness —
that is what the hidden verifier does, deliberately.
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

from fixtures.generate import instance, protocol_for, protocol_ids  # noqa: E402
from classify import PROPERTIES, classify  # noqa: E402
from counterexamples import (  # noqa: E402
    extract_witness,
    incompleteness_witness,
    unsoundness_witness,
)
from verifier.server import (  # noqa: E402
    inspect_payload,
    prepare_submissions,
    run_public_tests,
    starter_payload,
)

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")
WORKBENCH_TEST_SEED = "public-workbench-test"


def test_classify_answers_every_protocol() -> None:
    for protocol_id in protocol_ids(SEED):
        answer = classify(protocol_id)
        assert set(answer) == set(PROPERTIES), f"{protocol_id}: expected keys {PROPERTIES}"


def test_classify_returns_booleans() -> None:
    for protocol_id in protocol_ids(SEED):
        for prop, value in classify(protocol_id).items():
            assert isinstance(value, bool), f"{protocol_id}.{prop} is not a boolean"


def test_generators_return_integers() -> None:
    statement = instance(SEED).as_public()
    assert isinstance(incompleteness_witness(statement), int)
    assert isinstance(unsoundness_witness(statement), int)


def test_extractor_returns_an_integer() -> None:
    from fixtures.generate import verify

    inst = instance(SEED)
    _accepted, transcript = verify(protocol_for(SEED, "leaky"), inst, inst.witness)
    assert isinstance(extract_witness(transcript), int)


def test_workbench_inspect_explains_properties_and_seeded_evidence() -> None:
    payload = inspect_payload(WORKBENCH_TEST_SEED)
    assert set(payload["definitions"]) == {"complete", "sound", "private"}
    assert set(payload["verifiers"]) == set(protocol_ids(WORKBENCH_TEST_SEED))
    assert set(payload["statement"]) == {"a", "b", "c", "p", "lo", "hi"}
    assert "boundaryStatement" not in payload
    assert payload["transcript"]["protocol"] == protocol_for(WORKBENCH_TEST_SEED, "leaky")


def test_workbench_starter_returns_both_editable_files() -> None:
    payload = starter_payload()
    assert set(payload) == {"classify.py", "counterexamples.py"}
    assert "def classify" in payload["classify.py"]
    assert "def incompleteness_witness" in payload["counterexamples.py"]


def test_workbench_public_tests_run_browser_sources() -> None:
    result = run_public_tests(WORKBENCH_TEST_SEED, starter_payload())
    assert result["passed"] is True
    assert "public tests: all passed" in result["output"]


def test_workbench_public_tests_report_invalid_browser_source() -> None:
    sources = starter_payload()
    sources["classify.py"] = "def classify(:\n"
    result = run_public_tests(WORKBENCH_TEST_SEED, sources)
    assert result["passed"] is False
    assert result["output"]


def test_workbench_prepare_returns_all_portal_checkpoints() -> None:
    result = prepare_submissions(WORKBENCH_TEST_SEED, starter_payload())
    assert result["ok"] is True
    submissions = result["submissions"]
    assert set(submissions) == {
        "incompleteness",
        "unsoundness",
        "privacy-leak",
        "property-matrix",
        "transfer",
    }
    assert isinstance(submissions["incompleteness"], int)
    assert isinstance(submissions["unsoundness"], int)
    assert isinstance(submissions["privacy-leak"], int)
    assert isinstance(json.loads(submissions["property-matrix"]), dict)
    assert set(json.loads(submissions["transfer"])) == {"classify.py", "counterexamples.py"}


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
    print()
    if selected == 0:
        print(f"no public test matched --only {only!r}")
        return 1
    print("public tests:", "all passed" if failures == 0 else f"{failures} failed")
    print()
    print("These only check the shape of your answers. The starter passes all of")
    print("them while classifying every protocol wrongly and demonstrating nothing.")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
