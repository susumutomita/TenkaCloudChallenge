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
    Case,
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


def _assert_contract_shape_and_range(case: Case) -> None:
    numbers = advance(**case.as_dict())
    assert len(numbers) == case.rounds
    for value in numbers:
        assert 0 <= value < case.modulus


def test_the_list_has_one_number_per_round() -> None:
    case = public_case(SEED)
    assert len(advance(**case.as_dict())) == case.rounds


def test_zero_rounds_is_empty() -> None:
    case = public_case(SEED)
    assert advance(case.start, case.step, 0, case.modulus) == []


def test_every_entry_is_in_range() -> None:
    case = public_case(SEED)
    _assert_contract_shape_and_range(case)


def test_negative_step_stays_in_range() -> None:
    case = public_case(SEED)
    _assert_contract_shape_and_range(
        Case(start=0, step=-case.step, rounds=case.rounds, modulus=case.modulus)
    )


def test_start_larger_than_modulus_stays_in_range() -> None:
    case = public_case(SEED)
    _assert_contract_shape_and_range(
        Case(
            start=case.start + case.modulus * 3,
            step=case.step,
            rounds=case.rounds,
            modulus=case.modulus,
        )
    )


def test_step_larger_than_modulus_stays_in_range() -> None:
    case = public_case(SEED)
    _assert_contract_shape_and_range(
        Case(
            start=case.start,
            step=case.step + case.modulus * 3,
            rounds=case.rounds,
            modulus=case.modulus,
        )
    )


def test_first_entry_is_start_plus_step() -> None:
    case = public_case(SEED)
    numbers = advance(**case.as_dict())
    assert numbers[0] == (case.start + case.step) % case.modulus


def test_workbench_inspect_shows_seeded_evidence_without_answers() -> None:
    payload = inspect_payload(WORKBENCH_TEST_SEED)
    assert payload["environment"]["healthToken"] == health_token(WORKBENCH_TEST_SEED)
    assert set(payload["predict"]) == {"start", "step", "rounds", "modulus"}
    # The list of numbers ("trace" on the wire) is evidence; the broken position
    # and the predicted final value are the answers, so they must not appear.
    assert set(payload["firstBroken"]) == {"start", "step", "rounds", "modulus", "trace"}
    assert isinstance(payload["firstBroken"]["trace"], list)


def test_the_broken_list_really_has_a_number_outside_the_range() -> None:
    # first-broken asks which number in the list is the first to leave
    # [0, modulus). If skipping the reduction happened on a round that would not
    # have wrapped, the corrupted list equals the clean one and the question has
    # no answer at all. Pin the property over many seeds, because a per-deploy
    # seed picks a different case every time.
    for index in range(200):
        case, trace, broke_at = corrupted_trace(f"range-guard-{index}")
        outside = [i for i, value in enumerate(trace) if not 0 <= value < case.modulus]
        assert outside == [broke_at], f"seed {index}: outside={outside} broke_at={broke_at}"


def test_the_predict_fixture_does_not_answer_itself() -> None:
    # If the walk ends where it started, `predict` can be answered by copying `start`,
    # and the checkpoint that carries the point of the problem measures nothing.
    for index in range(200):
        case = public_case(f"predict-guard-{index}")
        assert (case.start + case.step * case.rounds) % case.modulus != case.start


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


def test_workbench_public_tests_reject_a_single_subtraction_solution() -> None:
    source = """def advance(start, step, rounds, modulus):
    trace = []
    value = start
    for _ in range(rounds):
        value = value + step
        if value >= modulus:
            value -= modulus
        trace.append(value)
    return trace
"""
    result = run_public_tests(WORKBENCH_TEST_SEED, {"counter.py": source})
    assert result["passed"] is False
    assert "FAIL test_negative_step_stays_in_range" in result["output"]
    assert "FAIL test_start_larger_than_modulus_stays_in_range" in result["output"]
    assert "FAIL test_step_larger_than_modulus_stays_in_range" in result["output"]


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


def test_portal_editor_replaces_static_assets() -> None:
    assert not (ROOT / "workbench").exists()
    server = (ROOT / "verifier" / "server.py").read_text(encoding="utf-8")
    for endpoint in ("/api/config", "/api/starter", "/api/inspect", "/api/test", "/api/prepare"):
        assert endpoint in server


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
    print("Passing these does not mean you are done. They check one visible example")
    print("and a few contract boundaries, but not every unseen combination.")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
