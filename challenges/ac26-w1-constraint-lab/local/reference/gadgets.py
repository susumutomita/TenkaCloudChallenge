"""Reference gadgets. Inside the image only."""

from __future__ import annotations


def boolean_constraint(signal: str) -> dict:
    return {"id": f"bool-{signal}", "kind": "boolean", "signal": signal}


def membership_constraints(signal: str, allowed: list[int]) -> list[dict]:
    return [
        {
            "id": f"member-{signal}",
            "kind": "member",
            "signal": signal,
            "allowed": list(allowed),
        }
    ]
