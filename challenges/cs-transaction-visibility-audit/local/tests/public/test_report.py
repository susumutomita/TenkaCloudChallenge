"""Public examples.  They intentionally never commit between two report reads."""

from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from fixtures.generate import ReportCase, public_cases  # noqa: E402

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def _load_submission():
    submission = Path(os.environ.get("SUBMISSION_DIR", str(ROOT / "starter"))) / "report.py"
    spec = importlib.util.spec_from_file_location("participant_report", submission)
    if spec is None or spec.loader is None:
        raise RuntimeError("report.py could not be loaded")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


REPORT = _load_submission()


def _run(case: ReportCase) -> dict[str, object]:
    result = REPORT.build_report(case.ledger(), case.account_ids)
    assert isinstance(result, dict), "build_report must return a dict"
    assert set(result) == {"revision", "balances", "total"}, "the report keys changed"
    return result


def _expected(case: ReportCase) -> dict[str, object]:
    state = case.starting_revision
    balances = {account: state.balances[account] for account in case.account_ids}
    return {
        "revision": state.number,
        "balances": balances,
        "total": sum(balances.values()),
    }


def test_no_interleaving() -> None:
    case = public_cases(SEED)[0]
    assert _run(case) == _expected(case)


def test_commit_before_report() -> None:
    case = public_cases(SEED)[1]
    assert _run(case) == _expected(case)


def test_commit_after_report() -> None:
    case = public_cases(SEED)[2]
    assert _run(case) == _expected(case)


def test_single_account() -> None:
    case = public_cases(SEED)[3]
    assert _run(case) == _expected(case)


def test_total_matches_returned_balances() -> None:
    for case in public_cases(SEED):
        report = _run(case)
        balances = report["balances"]
        assert isinstance(balances, dict)
        assert report["total"] == sum(balances.values())


def main() -> int:
    only = ""
    if "--only" in sys.argv:
        index = sys.argv.index("--only")
        only = sys.argv[index + 1] if index + 1 < len(sys.argv) else ""

    failures = 0
    selected = 0
    for name, function in sorted(globals().items()):
        if not name.startswith("test_") or not callable(function):
            continue
        if only and only not in name:
            continue
        selected += 1
        try:
            function()
            print(f"PASS {name}")
        except Exception as error:  # noqa: BLE001 - public runner reports all examples
            failures += 1
            print(f"FAIL {name}: {error or type(error).__name__}")
    if selected == 0:
        print(f"no public test matched --only {only!r}")
        return 1
    print()
    print("public tests:", "all passed" if failures == 0 else f"{failures} failed")
    print("These examples contain no commit between row reads.")
    print("Green does not show what happens when a commit lands in the middle.")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
