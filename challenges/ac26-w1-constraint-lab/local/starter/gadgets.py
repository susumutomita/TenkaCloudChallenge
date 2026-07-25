"""Gadgets: turning a program condition into constraints. The third file you edit.

A gadget is a small group of constraints that together force a signal to behave a
certain way. Naming a signal `flag` does not make it a boolean; a constraint does.
"""

from __future__ import annotations


def boolean_constraint(signal: str) -> dict:
    """Constraints forcing `signal` to be 0 or 1, and nothing else.

    Return a single constraint dict. The starter returns a constraint that every
    value satisfies, so `flag = 2` sails through.
    """
    return {"id": f"bool-{signal}", "kind": "const", "signal": signal, "value": 0}


def membership_constraints(signal: str, allowed: list[int]) -> list[dict]:
    """Constraints forcing `signal` into `allowed`, and nothing else.

    Return a list of constraint dicts. The starter allows everything.
    """
    return []
