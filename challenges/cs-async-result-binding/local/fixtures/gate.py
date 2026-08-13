"""Deterministic asyncio.Future completion gate.

No clock, socket, or scheduler race decides a case. The driver waits for start_io to
record work, then explicitly resolves Futures in the requested groups. A call_soon
barrier only drains callbacks already queued in the same event loop; it never waits
for elapsed time.
"""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Case:
    jobs: list[dict[str, Any]]
    completion_groups: tuple[tuple[str, ...], ...]
    values: dict[str, Any]
    failures: dict[str, str]
    minimum_started: int


@dataclass(frozen=True)
class Result:
    rows: object
    started_before_release: tuple[str, ...]
    error: str | None = None


class FutureGate:
    def __init__(self) -> None:
        self.started: list[str] = []
        self.futures: dict[str, asyncio.Future[Any]] = {}
        self.first_started = asyncio.get_running_loop().create_future()

    def start_io(self, job: dict[str, Any]) -> asyncio.Future[Any]:
        job_id = job["id"]
        if job_id in self.futures:
            raise ValueError("job id must be unique")
        future = asyncio.get_running_loop().create_future()
        self.futures[job_id] = future
        self.started.append(job_id)
        if not self.first_started.done():
            self.first_started.set_result(None)
        return future

    def release(self, job_id: str, value: Any, failure: str | None) -> None:
        future = self.futures[job_id]
        if failure is None:
            future.set_result(value)
        else:
            future.set_exception(RuntimeError(failure))

    def cancel_pending(self) -> None:
        for future in self.futures.values():
            if not future.done():
                future.cancel()


async def ready_barrier() -> None:
    """Run callbacks already queued before this barrier, without sleeping."""
    loop = asyncio.get_running_loop()
    reached = loop.create_future()
    loop.call_soon(reached.set_result, None)
    await reached


async def run_case(
    collect: Callable[[list[dict[str, Any]], Callable[[dict[str, Any]], asyncio.Future[Any]]], Awaitable[object]],
    case: Case,
) -> Result:
    gate = FutureGate()
    task = asyncio.create_task(collect(case.jobs, gate.start_io))
    try:
        await gate.first_started
        # A concurrent implementation may create one coroutine per job. Drain the
        # already-ready callbacks before inspecting the deterministic start ledger.
        await ready_barrier()
        await ready_barrier()
        started = tuple(gate.started)
        if len(started) < case.minimum_started:
            return Result(None, started, "work was serialized before the first release")

        for group in case.completion_groups:
            for job_id in group:
                gate.release(job_id, case.values.get(job_id), case.failures.get(job_id))
            await ready_barrier()
        return Result(await task, started)
    except Exception as error:  # malformed learner output must fail closed
        return Result(None, tuple(gate.started), f"collector raised {type(error).__name__}")
    finally:
        if not task.done():
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        gate.cancel_pending()


def expected_rows(case: Case) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for job in case.jobs:
        job_id = job["id"]
        if job_id in case.failures:
            rows.append({"jobId": job_id, "ok": False, "error": case.failures[job_id]})
        else:
            rows.append({"jobId": job_id, "ok": True, "value": case.values[job_id]})
    return rows


def groups_from_order(order: Sequence[str]) -> tuple[tuple[str, ...], ...]:
    return tuple((job_id,) for job_id in order)
