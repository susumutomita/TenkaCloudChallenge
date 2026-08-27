"""Public tests. They show the shape of an answer; they do not prove one correct.

They check that the trace runs and that an honest trace has zero residuals. They never
tamper with a row, never interpolate, never ask where a violation is, and never ask what
the transition constraints fail to say.

An implementation with no boundary constraints at all passes this file.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "starter"))

import air as submission  # noqa: E402

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def _load_public_evidence() -> dict:
    """This deployment's setting, domain and public-label trace -- what `show.py` prints,
    and what this file has always compared `execute` against.

    Issue 537/538 (Issue 543 option B2): this file used to import `fixtures.generate`
    directly. That module derives the setting every checkpoint is graded against, and its
    `honest_trace` is by its own docstring the reference answer for the trace checkpoint;
    it shipped in the same image as `tests/hidden/check_air.py`, which states the residual
    count, the row a transition failure belongs to, and every condition an underconstrained
    witness is accepted on. Neither ships in the `participant` Docker stage any more (see
    ../../Dockerfile). This deployment's own verifier is the only source for the public
    half now: `PUBLIC_EVIDENCE_JSON` when the Portal has already fetched it, or
    `VERIFIER_PUBLIC_URL` fetched directly when it has not.
    """
    injected = os.environ.get("PUBLIC_EVIDENCE_JSON")
    if injected:
        return json.loads(injected)
    verifier_public_url = os.environ.get("VERIFIER_PUBLIC_URL")
    if verifier_public_url:
        from urllib.request import urlopen

        with urlopen(verifier_public_url, timeout=10) as response:  # noqa: S310
            return json.loads(response.read().decode("utf-8"))
    # Neither is set: this only resolves when `fixtures/` is actually on disk, which is
    # true for a checkout (this file run directly, e.g. by
    # scripts/ac26-w4-arithmetization.test.ts) and the verifier/author Docker stages, and
    # never inside a built `participant` image -- so this branch does not reopen the leak
    # above.
    from fixtures.generate import public_payload

    return public_payload(SEED)


PUBLIC = _load_public_evidence()


def _setting() -> dict:
    cfg = dict(PUBLIC["setting"])
    cfg["start"] = tuple(cfg["start"])
    return cfg


def _trace() -> list[tuple[int, int]]:
    return [tuple(row) for row in PUBLIC["trace"]]


def check_the_trace_runs() -> str:
    cfg = _setting()
    trace = submission.execute(dict(cfg))
    if not isinstance(trace, list) or len(trace) != cfg["steps"]:
        return "the trace does not have one row per step"
    if [tuple(row) for row in trace] != _trace():
        return "the trace is not what the machine produces"
    return ""


def check_honest_residuals_vanish() -> str:
    cfg = _setting()
    residuals = submission.transition_residuals(_trace(), dict(cfg))
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
