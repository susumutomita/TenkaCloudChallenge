"""Collect completed I/O results.

The public examples complete in request order, so this implementation looks right.
Inspect the evidence before assuming that completion order is request identity.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from typing import Any


async def collect(
    jobs: list[dict[str, Any]],
    start_io: Callable[[dict[str, Any]], asyncio.Future[Any]],
) -> list[dict[str, Any]]:
    """Start every job and return one result row for every input row."""
    pending = [start_io(job) for job in jobs]
    rows: list[dict[str, Any]] = []

    # BUG: as_completed yields awaitables in completion order. zip supplies jobs
    # in input order. Those are two independent orders.
    for job, completed in zip(jobs, asyncio.as_completed(pending), strict=True):
        try:
            value = await completed
        except Exception as error:  # each job's failure is data for this collector
            rows.append({"jobId": job["id"], "ok": False, "error": str(error)})
        else:
            rows.append({"jobId": job["id"], "ok": True, "value": value})

    return rows
