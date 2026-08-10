"""Author-only mutation suite for common completion/identity mistakes."""

from __future__ import annotations

import asyncio
import importlib.util
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "tests" / "hidden"))

from check_collect import evaluate_module, load_submission


@dataclass(frozen=True)
class Mutant:
    name: str
    phase: str
    source: str


HEADER = """from __future__ import annotations
import asyncio

async def one(job, start_io):
    try:
        value = await start_io(job)
    except Exception as error:
        return {"jobId": job["id"], "ok": False, "error": str(error)}
    return {"jobId": job["id"], "ok": True, "value": value}

"""

MUTANTS = (
    Mutant(
        "zip-input-with-completion",
        "check_bind",
        HEADER
        + """async def collect(jobs, start_io):
    pending = [start_io(job) for job in jobs]
    rows = []
    for job, completed in zip(jobs, asyncio.as_completed(pending)):
        rows.append({"jobId": job["id"], "ok": True, "value": await completed})
    return rows
""",
    ),
    Mutant(
        "return-completion-order",
        "check_bind",
        HEADER
        + """async def collect(jobs, start_io):
    pending = [asyncio.create_task(one(job, start_io)) for job in jobs]
    return [await completed for completed in asyncio.as_completed(pending)]
""",
    ),
    Mutant(
        "endpoint-is-identity",
        "check_bind",
        HEADER
        + """async def collect(jobs, start_io):
    by_endpoint = {job["endpoint"]: job for job in jobs}
    rows = await asyncio.gather(*(one(job, start_io) for job in jobs))
    return [{**row, "jobId": by_endpoint[job["endpoint"]]["id"]} for job, row in zip(jobs, rows)]
""",
    ),
    Mutant(
        "completion-index-counter",
        "check_bind",
        HEADER
        + """async def collect(jobs, start_io):
    pending = [start_io(job) for job in jobs]
    rows = []
    for index, completed in enumerate(asyncio.as_completed(pending)):
        rows.append({"jobId": jobs[index]["id"], "ok": True, "value": await completed})
    return rows
""",
    ),
    Mutant(
        "sequential-await",
        "check_overlap",
        HEADER
        + """async def collect(jobs, start_io):
    rows = []
    for job in jobs:
        rows.append(await one(job, start_io))
    return rows
""",
    ),
    Mutant(
        "drop-failure-and-shift",
        "check_failure",
        HEADER
        + """async def collect(jobs, start_io):
    rows = []
    for result in await asyncio.gather(*(start_io(job) for job in jobs), return_exceptions=True):
        if isinstance(result, Exception):
            continue
        job = jobs[len(rows)]
        rows.append({"jobId": job["id"], "ok": True, "value": result})
    return rows
""",
    ),
    Mutant(
        "sort-simultaneous-values",
        "check_generalize",
        HEADER
        + """async def collect(jobs, start_io):
    rows = list(await asyncio.gather(*(one(job, start_io) for job in jobs)))
    return sorted(rows, key=lambda row: repr(row.get("value", row.get("error"))))
""",
    ),
)


async def main() -> int:
    reference = load_submission(ROOT / "reference" / "collector.py")
    for phase in ("check_overlap", "check_bind", "check_failure", "check_generalize"):
        passed, _ = await evaluate_module(reference, phase, "mutation-reference")
        if not passed:
            print(f"reference failed {phase}")
            return 1

    survivors: list[str] = []
    with tempfile.TemporaryDirectory() as directory:
        for index, mutant in enumerate(MUTANTS):
            path = Path(directory) / f"mutant-{index}.py"
            path.write_text(mutant.source, encoding="utf-8")
            module = load_submission(path)
            passed, _ = await evaluate_module(module, mutant.phase, f"mutation-{mutant.name}")
            if passed:
                survivors.append(mutant.name)
            else:
                print(f"KILLED {mutant.name} ({mutant.phase})")
    if survivors:
        print("SURVIVED " + ", ".join(survivors))
        return 1
    print(f"mutation: PASS — {len(MUTANTS)}/{len(MUTANTS)} killed")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
