"""Reference solution: bind identity before awaiting completion."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from typing import Any


async def _collect_one(
    job: dict[str, Any],
    start_io: Callable[[dict[str, Any]], asyncio.Future[Any]],
) -> dict[str, Any]:
    """Keep the job in this coroutine's closure while its Future completes."""
    try:
        value = await start_io(job)
    except Exception as error:
        return {"jobId": job["id"], "ok": False, "error": str(error)}
    return {"jobId": job["id"], "ok": True, "value": value}


async def collect(
    jobs: list[dict[str, Any]],
    start_io: Callable[[dict[str, Any]], asyncio.Future[Any]],
) -> list[dict[str, Any]]:
    """Start concurrently; gather preserves input order without losing identity."""
    return list(await asyncio.gather(*(_collect_one(job, start_io) for job in jobs)))
