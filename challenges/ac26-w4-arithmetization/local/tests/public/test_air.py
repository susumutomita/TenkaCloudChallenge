"""Public tests. They show the shape of an answer; they do not prove one correct.

They check that the trace runs and that an honest trace has zero residuals. They never
tamper with a row, never interpolate, never ask where a violation is, and never ask what
the transition constraints fail to say.

An implementation with no boundary constraints at all passes this file.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "starter"))

import air as submission  # noqa: E402
from fixtures.generate import honest_trace, setting  # noqa: E402

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def check_the_trace_runs() -> str:
    cfg = setting(SEED)
    trace = submission.execute(dict(cfg))
    if not isinstance(trace, list) or len(trace) != cfg["steps"]:
        return "the trace does not have one row per step"
    if [tuple(row) for row in trace] != honest_trace(cfg):
        return "the trace is not what the machine produces"
    return ""


def check_honest_residuals_vanish() -> str:
    cfg = setting(SEED)
    residuals = submission.transition_residuals(honest_trace(cfg), dict(cfg))
    if not isinstance(residuals, list) or not residuals:
        return "there are no transition residuals"
    if any(any(value % cfg["p"] != 0 for value in pair) for pair in residuals):
        return "an honest trace has a non-zero transition residual"
    return ""


CHECKS = (
    ("the-trace-runs", check_the_trace_runs),
    ("honest-residuals-vanish", check_honest_residuals_vanish),
)


def main(argv: list[str]) -> int:
    only = argv[argv.index("--only") + 1] if "--only" in argv else ""
    failed = 0
    for name, check in CHECKS:
        if only and only not in name:
            continue
        try:
            message = check()
        except Exception as error:  # noqa: BLE001 - a crash is a failure, reported as one
            message = f"raised {type(error).__name__}"
        if message:
            print(f"FAIL {name}: {message}")
            failed += 1
        else:
            print(f"ok   {name}")
    print(f"\npublic tests: {failed} failed" if failed else "\npublic tests: all passed")
    if not failed:
        print("\nNothing here tampered with a row or asked about the boundary.")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
