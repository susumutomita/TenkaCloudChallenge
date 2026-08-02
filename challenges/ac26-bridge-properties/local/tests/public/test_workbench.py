"""Public contract for the browser workbench.

The portal starts this problem from a browser, so the participant must be able to
inspect the seeded instance, edit both submission files, run the public checks,
and prepare every portal submission without leaving that browser journey.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from verifier.server import (  # noqa: E402
    inspect_payload,
    prepare_submissions,
    run_public_tests,
    starter_payload,
)

SEED = "public-workbench-test"


def test_inspect_explains_the_properties_and_seeded_evidence() -> None:
    payload = inspect_payload(SEED)
    assert set(payload["definitions"]) == {"complete", "sound", "private"}
    assert set(payload["verifiers"]) == {"p1", "p2", "p3"}
    assert set(payload["statement"]) == {"a", "b", "c", "p", "lo", "hi"}
    assert set(payload["boundaryStatement"]) == {"a", "b", "c", "p", "lo", "hi"}
    assert payload["transcript"]["protocol"] == "p3"


def test_starter_returns_both_editable_files() -> None:
    payload = starter_payload()
    assert set(payload) == {"classify.py", "counterexamples.py"}
    assert "def classify" in payload["classify.py"]
    assert "def incompleteness_witness" in payload["counterexamples.py"]


def test_public_tests_run_the_browser_sources() -> None:
    result = run_public_tests(SEED, starter_payload())
    assert result["passed"] is True
    assert "public tests: all passed" in result["output"]


def test_public_tests_report_invalid_browser_source() -> None:
    sources = starter_payload()
    sources["classify.py"] = "def classify(:\n"
    result = run_public_tests(SEED, sources)
    assert result["passed"] is False
    assert result["output"]


def test_prepare_submissions_returns_all_portal_checkpoints() -> None:
    result = prepare_submissions(SEED, starter_payload())
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


def test_workbench_assets_expose_the_browser_only_journey() -> None:
    html = (ROOT / "workbench" / "index.html").read_text(encoding="utf-8")
    script = (ROOT / "workbench" / "app.js").read_text(encoding="utf-8")
    for term in ("completeness", "soundness", "privacy", "terminal-input"):
        assert term in html
    for command in ("inspect", "test", "prepare", "reset"):
        assert f'case "{command}"' in script
    assert "copyText" in script


def main() -> int:
    failures = 0
    for name, function in sorted(globals().items()):
        if not name.startswith("test_") or not callable(function):
            continue
        try:
            function()
            print(f"PASS {name}")
        except Exception as error:  # noqa: BLE001 - compact public test runner
            failures += 1
            print(f"FAIL {name}: {type(error).__name__}: {error}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
