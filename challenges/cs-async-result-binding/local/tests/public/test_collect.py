"""Public contract checks. The starter intentionally passes all of them."""

from __future__ import annotations

import asyncio
import argparse
import importlib.util
import os
import sys
from pathlib import Path
from types import ModuleType

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from fixtures.gate import Case, expected_rows, groups_from_order, run_case
from fixtures.generate import audit_evidence, jobs_for, values_for


def load_submission() -> ModuleType:
    submission_dir = Path(os.environ.get("SUBMISSION_DIR", ROOT / "starter"))
    path = submission_dir / "collector.py"
    spec = importlib.util.spec_from_file_location("participant_collector", path)
    if spec is None or spec.loader is None:
        raise AssertionError("collector.py could not be loaded")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    if not callable(getattr(module, "collect", None)):
        raise AssertionError("collector.py must define async collect(jobs, start_io)")
    return module


async def check_one_job(module: ModuleType) -> None:
    jobs = jobs_for("public-one", 1)
    values = values_for("public-one", jobs)
    case = Case(jobs, ((jobs[0]["id"],),), values, {}, 1)
    result = await run_case(module.collect, case)
    assert result.error is None
    assert result.rows == expected_rows(case)


async def check_ordered_completion(module: ModuleType) -> None:
    jobs = jobs_for("public-ordered", 3)
    values = values_for("public-ordered", jobs)
    order = [job["id"] for job in jobs]
    case = Case(jobs, groups_from_order(order), values, {}, len(jobs))
    result = await run_case(module.collect, case)
    assert result.error is None
    assert result.started_before_release == tuple(order), "start every job before any result arrives"
    assert result.rows == expected_rows(case), "keep the documented output shape"


def check_audit_fixture() -> None:
    evidence = audit_evidence("public-audit")
    assert len(evidence["jobs"]) == len(evidence["completionTrace"]) == len(evidence["storedRows"])
    input_ids = [row["id"] for row in evidence["jobs"]]
    completion_ids = [row["sourceJobId"] for row in evidence["completionTrace"]]
    assert completion_ids != input_ids
    assert len(
        {
            tuple(
                row["sourceJobId"]
                for row in audit_evidence(f"public-audit-{index}")["completionTrace"]
            )
            for index in range(12)
        }
    ) > 1


async def main(only: str | None = None) -> None:
    module = load_submission()
    checks = {
        "one": lambda: check_one_job(module),
        "ordered": lambda: check_ordered_completion(module),
    }
    selected = [name for name in checks if only is None or only in name]
    if not selected and only is not None:
        raise AssertionError(f"no public check contains {only!r}")
    for name in selected:
        await checks[name]()
    if only is None or only in "audit-fixture":
        check_audit_fixture()
    print("public: PASS — one job, ordered completion, output shape, and overlap")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--only")
    asyncio.run(main(parser.parse_args().only))
