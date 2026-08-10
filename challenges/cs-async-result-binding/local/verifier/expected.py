"""Verifier-only expected values derived from participant-visible evidence."""

from __future__ import annotations

from fixtures.generate import audit_evidence


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
