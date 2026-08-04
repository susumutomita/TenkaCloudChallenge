"""Public tests: they show you the shape of the answer. They do not prove it.

Read them, then read `misconception.public-tests-are-complete` in the README. These
tests pass for at least one implementation that the hidden tests reject.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SUBMISSION_DIR = os.environ.get("SUBMISSION_DIR")
sys.path.insert(0, str(ROOT))
sys.path.insert(0, SUBMISSION_DIR or str(ROOT / "starter"))

from counter import advance  # noqa: E402
from fixtures.generate import (  # noqa: E402
    corrupted_trace,
    health_token,
    public_case,
    walkback_case,
)
from verifier.server import (  # noqa: E402
    inspect_payload,
    prepare_submissions,
    run_public_tests,
    starter_payload,
)

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")
WORKBENCH_TEST_SEED = "public-workbench-test"


def test_trace_has_one_entry_per_round() -> None:
    case = public_case(SEED)
    assert len(advance(**case.as_dict())) == case.rounds


def test_zero_rounds_is_empty() -> None:
    case = public_case(SEED)
    assert advance(case.start, case.step, 0, case.modulus) == []


def test_every_entry_is_in_range() -> None:
    case = public_case(SEED)
    for value in advance(**case.as_dict()):
        assert 0 <= value < case.modulus


def test_first_entry_is_start_plus_step() -> None:
    case = public_case(SEED)
    trace = advance(**case.as_dict())
    assert trace[0] == (case.start + case.step) % case.modulus


def test_workbench_inspect_shows_seeded_evidence_without_answers() -> None:
    payload = inspect_payload(WORKBENCH_TEST_SEED)
    assert payload["environment"]["healthToken"] == health_token(WORKBENCH_TEST_SEED)
    assert set(payload["predict"]) == {"start", "step", "rounds", "modulus"}
    # The trace is evidence; the broken index and the predicted final value are
    # the answers, so they must not appear.
    assert set(payload["firstBroken"]) == {"start", "step", "rounds", "modulus", "trace"}
    assert isinstance(payload["firstBroken"]["trace"], list)


def test_the_broken_trace_actually_leaves_the_range_it_is_asked_about() -> None:
    # first-broken asks which entry first leaves [0, modulus). If skipping the
    # reduction happened on a round that would not have wrapped, the corrupted trace
    # equals the clean one and the question has no answer at all. Pin the property
    # over many seeds, because a per-deploy seed picks a different case every time.
    for index in range(200):
        case, trace, broke_at = corrupted_trace(f"range-guard-{index}")
        outside = [i for i, value in enumerate(trace) if not 0 <= value < case.modulus]
        assert outside == [broke_at], f"seed {index}: outside={outside} broke_at={broke_at}"


def test_the_walkback_case_really_walks_back() -> None:
    # The motivation for the whole problem is that this walk is reversible. If the
    # printed arithmetic did not actually recover `rounds`, the evidence would be
    # telling the learner something false.
    walk = walkback_case(WORKBENCH_TEST_SEED)
    assert walk["step"] * walk["undoStep"] % walk["modulus"] == 1
    assert walk["recoveredRounds"] == walk["rounds"]


def test_workbench_starter_returns_the_editable_file() -> None:
    payload = starter_payload()
    assert set(payload) == {"counter.py"}
    assert "def advance" in payload["counter.py"]


def test_workbench_public_tests_fail_the_shipped_starter() -> None:
    # The starter never reduces mod `modulus`, so the range test must fail. If
    # this starts passing, the starter no longer demonstrates the misconception.
    result = run_public_tests(WORKBENCH_TEST_SEED, starter_payload())
    assert result["passed"] is False
    assert "FAIL test_every_entry_is_in_range" in result["output"]


def test_workbench_public_tests_report_invalid_browser_source() -> None:
    result = run_public_tests(WORKBENCH_TEST_SEED, {"counter.py": "def advance(:\n"})
    assert result["passed"] is False
    assert result["output"]


def test_workbench_prepare_returns_the_producible_portal_values() -> None:
    result = prepare_submissions(WORKBENCH_TEST_SEED, starter_payload())
    assert result["ok"] is True
    submissions = result["submissions"]
    # predict and first-broken are worked out by the learner, never produced here.
    assert set(submissions) == {"environment", "generalize"}
    assert submissions["environment"] == health_token(WORKBENCH_TEST_SEED)
    assert "def advance" in submissions["generalize"]


def test_workbench_prepare_rejects_an_empty_source() -> None:
    result = prepare_submissions(WORKBENCH_TEST_SEED, {"counter.py": "   "})
    assert result["ok"] is False


def test_workbench_assets_expose_browser_only_journey() -> None:
    html = (ROOT / "workbench" / "index.html").read_text(encoding="utf-8")
    script = (ROOT / "workbench" / "app.js").read_text(encoding="utf-8")
    for term in ("predict", "first-broken", "generalize", "terminal-input"):
        assert term in html
    for command in ("inspect", "test", "prepare", "reset"):
        assert f'case "{command}"' in script
    assert "copyText" in script


def main() -> int:
    # `--only <substring>` backs `make test-one ID=...`: iterate on one behaviour
    # without re-reading the whole run.
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
    print("Passing these does not mean you are done. They only use one set of")
    print("parameters, and they never use a negative or zero step.")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
