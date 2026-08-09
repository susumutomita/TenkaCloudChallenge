"""Hidden phase runner. Reports only the failed property, never fixture values."""

from __future__ import annotations

import argparse
import asyncio
import importlib.util
import sys
from pathlib import Path
from types import ModuleType

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from fixtures.gate import Case, expected_rows, groups_from_order, run_case
from fixtures.generate import completion_permutation, jobs_for, values_for

PHASES = ("check_overlap", "check_bind", "check_failure", "check_generalize")


def load_submission(path: Path) -> ModuleType:
    spec = importlib.util.spec_from_file_location("checked_collector", path)
    if spec is None or spec.loader is None:
        raise AssertionError("collector.py could not be loaded")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    if not callable(getattr(module, "collect", None)):
        raise AssertionError("collector.py must define collect")
    return module


def _case(seed: str, order: list[int], groups: tuple[tuple[int, ...], ...] | None = None) -> Case:
    jobs = jobs_for(seed, len(order))
    values = values_for(seed, jobs)
    completion_groups = (
        tuple(tuple(jobs[index]["id"] for index in group) for group in groups)
        if groups is not None
        else groups_from_order([jobs[index]["id"] for index in order])
    )
    return Case(jobs, completion_groups, values, {}, len(jobs))


def overlap_cases(seed: str) -> list[Case]:
    return [_case(f"{seed}:overlap", [1, 0])]


def bind_cases(seed: str) -> list[Case]:
    count = 5
    return [
        _case(f"{seed}:reverse", list(reversed(range(count)))),
        _case(
            f"{seed}:permutation",
            completion_permutation(f"{seed}:permutation", count),
        ),
    ]


def failure_cases(seed: str) -> list[Case]:
    jobs = jobs_for(f"{seed}:failure", 5)
    values = values_for(f"{seed}:failure", jobs)
    failed_id = jobs[2]["id"]
    order = [4, 2, 0, 3, 1]
    return [
        Case(
            jobs,
            groups_from_order([jobs[index]["id"] for index in order]),
            values,
            {failed_id: "upstream rejected request"},
            len(jobs),
        )
    ]


def generalize_cases(seed: str) -> list[Case]:
    cases: list[Case] = []
    for index in range(4):
        case_seed = f"{seed}:general:{index}"
        count = 3 + index
        order = completion_permutation(case_seed, count)
        cases.append(_case(case_seed, order))
    # Two Futures become ready in one explicit release group. Their values must
    # remain attached to request identity; no completion timestamp exists to sort.
    cases.append(_case(f"{seed}:simultaneous", [2, 0, 3, 1], ((2, 0), (3, 1))))
    cases.extend(failure_cases(f"{seed}:general"))
    return cases


CASES_BY_PHASE = {
    "check_overlap": overlap_cases,
    "check_bind": bind_cases,
    "check_failure": failure_cases,
    "check_generalize": generalize_cases,
}


async def evaluate_module(module: ModuleType, phase: str, seed: str) -> tuple[bool, str]:
    if phase not in CASES_BY_PHASE:
        return False, "unknown phase"
    for case in CASES_BY_PHASE[phase](seed):
        result = await run_case(module.collect, case)
        if result.error is not None:
            return False, "concurrency contract failed"
        if len(result.started_before_release) < case.minimum_started:
            return False, "all work must start before the first completion"
        if result.rows != expected_rows(case):
            return False, "result identity, order, failure, or output shape is wrong"
    return True, "passed"


async def _main(module_path: Path, phase: str, seed: str) -> int:
    try:
        module = load_submission(module_path)
        passed, message = await evaluate_module(module, phase, seed)
    except Exception:
        passed, message = False, "collector could not be checked"
    print(f"{phase}: {'PASS' if passed else 'FAIL'} — {message}")
    return 0 if passed else 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--module", type=Path, required=True)
    parser.add_argument("--phase", choices=PHASES, required=True)
    parser.add_argument("--seed", default="local-dev-seed")
    args = parser.parse_args()
    return asyncio.run(_main(args.module, args.phase, args.seed))


if __name__ == "__main__":
    raise SystemExit(main())
