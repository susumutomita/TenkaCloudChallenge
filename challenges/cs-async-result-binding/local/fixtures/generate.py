"""Seeded fixtures for the async result-binding lab (stdlib only)."""

from __future__ import annotations

import hashlib
from typing import Any


def _number(seed: str, label: str) -> int:
    digest = hashlib.sha256(f"{seed}:{label}".encode()).digest()
    return int.from_bytes(digest[:8], "big")


def health_token(seed: str) -> str:
    return f"future-gate-{hashlib.sha256(seed.encode()).hexdigest()[:12]}"


def jobs_for(seed: str, count: int = 5) -> list[dict[str, Any]]:
    """Return distinct identities; two deliberately share the same endpoint."""
    tenant = 10 + _number(seed, "tenant") % 90
    shared = f"/v1/tenants/{tenant}/objects/shared"
    jobs: list[dict[str, Any]] = []
    for index in range(count):
        suffix = hashlib.sha256(f"{seed}:job:{index}".encode()).hexdigest()[:6]
        endpoint = shared if index in (1, 3) else f"/v1/objects/{suffix}"
        jobs.append(
            {
                "id": f"req-{index + 1}-{suffix}",
                "endpoint": endpoint,
                "query": {"cursor": index, "view": "summary"},
            }
        )
    return jobs


def values_for(seed: str, jobs: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        job["id"]: {
            "receipt": hashlib.sha256(f"{seed}:value:{job['id']}".encode()).hexdigest()[:10],
            "bytes": 128 + _number(seed, f"bytes:{job['id']}") % 4096,
        }
        for job in jobs
    }


def completion_permutation(seed: str, count: int) -> list[int]:
    """Rotate 2..count-1 positions, leaving at least one correct row."""
    if count < 3:
        return list(reversed(range(count)))
    width = 2 + _number(seed, "width") % (count - 2)
    start = _number(seed, "start") % (count - width + 1)
    selected = list(range(start, start + width))
    rotated = selected[1:] + selected[:1]
    order = list(range(count))
    order[start : start + width] = rotated
    return order


def audit_evidence(seed: str) -> dict[str, Any]:
    jobs = jobs_for(seed)
    values = values_for(seed, jobs)
    order = completion_permutation(seed, len(jobs))
    completion = [
        {"position": position, "sourceJobId": jobs[index]["id"], "value": values[jobs[index]["id"]]}
        for position, index in enumerate(order)
    ]
    stored = [
        {"index": index, "jobId": job["id"], "value": completion[index]["value"]}
        for index, job in enumerate(jobs)
    ]
    return {
        "jobs": jobs,
        "completionTrace": completion,
        "storedRows": stored,
    }


def audit_answer(seed: str) -> list[int]:
    evidence = audit_evidence(seed)
    source_at = {
        row["value"]["receipt"]: row["sourceJobId"] for row in evidence["completionTrace"]
    }
    return [
        row["index"]
        for row in evidence["storedRows"]
        if source_at[row["value"]["receipt"]] != row["jobId"]
    ]
