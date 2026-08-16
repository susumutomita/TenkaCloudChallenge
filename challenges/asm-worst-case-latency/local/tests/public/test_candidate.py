"""Public tests: the shipped starter passes all of them.

They check that a submission is a well-formed, honest measurement — it
assembles, it keeps the contract's shape, and it produces a number. None of them
checks that the number is large, which is the whole task. The starter is a
correct measurement of the fastest instruction on the machine.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SUBMISSION = Path(os.environ.get("SUBMISSION_DIR", ROOT / "starter")) / "candidate.S"

sys.path.insert(0, str(ROOT))
from harness.candidate import CandidateFormatError, build_candidate_object, render_candidate


def _build(workspace: Path) -> Path:
    candidate = workspace / "candidate.o"
    try:
        build_candidate_object(SUBMISSION.read_text(encoding="utf-8"), candidate)
    except CandidateFormatError as error:
        raise AssertionError(str(error)) from None

    binary = workspace / "measure"
    build = subprocess.run(
        [
            "gcc", "-O2", "-I", str(ROOT / "harness"), "-o", str(binary),
            str(ROOT / "harness" / "measure.c"), str(ROOT / "harness" / "arena.c"),
            str(ROOT / "harness" / "baseline.S"), str(candidate),
        ],
        capture_output=True, text=True, timeout=120, check=False,
    )
    if build.returncode != 0:
        raise AssertionError("candidate.S does not build with the harness:\n" + build.stderr)
    return binary


def _measure(seed: int = 1) -> dict:
    with tempfile.TemporaryDirectory() as workspace:
        binary = _build(Path(workspace))
        completed = subprocess.run(
            [str(binary), str(seed)], capture_output=True, text=True, timeout=240, check=False
        )
        if completed.returncode != 0:
            raise AssertionError("the measurement did not complete")
        return json.loads(completed.stdout)


def test_the_candidate_assembles_with_the_harness() -> None:
    with tempfile.TemporaryDirectory() as workspace:
        _build(Path(workspace))


def test_the_submission_is_one_instruction() -> None:
    rendered = render_candidate(SUBMISSION.read_text(encoding="utf-8"))
    assert ".rept TC_SPIN_COUNT" in rendered
    assert "tc_measured_begin" in rendered
    assert "tc_measured_end" in rendered


def test_the_measurement_produces_a_result() -> None:
    result = _measure()
    assert result["candidate"]["robustCycles"] > 0
    assert result["baseline"]["robustCycles"] > 0
    assert result["normalizedScore"] > 0


def test_most_samples_stay_on_one_cpu() -> None:
    result = _measure()
    for side in ("baseline", "candidate"):
        assert result[side]["kept"] >= 51, f"{side} lost too many samples to migration"


def test_the_score_is_a_ratio_not_a_cycle_count() -> None:
    # The harness reports the ratio it actually measured, not either raw cycle
    # count. Two seeds make this load-bearing for both result objects.
    first = _measure(seed=1)
    second = _measure(seed=2)
    for result in (first, second):
        baseline = result["baseline"]["robustCycles"]
        candidate = result["candidate"]["robustCycles"]
        assert baseline > 0
        expected = candidate / baseline
        assert abs(result["normalizedScore"] - expected) <= 0.0001


def test_workbench_contract() -> None:
    if os.environ.get("BROWSER_PUBLIC_TESTS") == "1":
        return
    from workbench import server

    config = server.config_payload()
    assert config["id"] == "asm-worst-case-latency"
    assert [item["id"] for item in config["checkpoints"]] == [
        "environment", "measure", "dependency", "miss", "generalize"
    ]
    prepared = server.prepare_submissions("public-seed", server.starter_payload())
    assert prepared["ok"] is True
    assert set(prepared["submissions"]) == {
        "environment", "measure", "dependency", "miss", "generalize"
    }


TESTS = {
    name: value
    for name, value in globals().items()
    if name.startswith("test_") and callable(value)
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", default="")
    args = parser.parse_args()
    selected = {name: test for name, test in TESTS.items() if args.only in name}
    if not selected:
        print("no public test matched", file=sys.stderr)
        return 2
    failures: list[str] = []
    for name, test in selected.items():
        try:
            test()
            print(f"pass {name}")
        except Exception as error:  # noqa: BLE001 - the runner reports each failure
            failures.append(name)
            print(f"FAIL {name}: {type(error).__name__}: {error}")
    if failures:
        print(f"{len(failures)} failed")
        return 1
    print(f"all passed ({len(selected)})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
