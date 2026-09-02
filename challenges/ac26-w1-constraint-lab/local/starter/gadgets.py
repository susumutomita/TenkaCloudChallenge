"""Gadgets: turning a program condition into constraints. The third file you edit.

A gadget is a small group of constraints that together force a signal to behave a
certain way. Naming a signal `flag` does not make it a boolean; a constraint does.

The grader substitutes values into what these functions return using its own
evaluator, which knows exactly the five documented kinds (mul, add, const, boolean,
member). Your `evaluate` is not consulted here, so a kind it alone understands
does not count.
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


def range_constraints(signal: str, bits: int) -> list[dict]:
    """Constraints forcing `signal` into 0 .. 2**bits - 1, and nothing else.

    Rules (the grader checks each one and names the one that broke):
      - kinds: boolean, add, mul, const only. Never member.
      - at most 5 * bits constraints in the list.
      - auxiliary signals are yours to invent and name; keep every name different
        from `signal`.
      - bits is between 1 and 6, and 2**bits < p always holds.

    Idea: every number in 0..7 is b0 + 2*b1 + 4*b2 with b0, b1, b2 each 0 or 1
    (5 = 1 + 0*2 + 1*4), and 0/1 digits can only ever add up to 0..7. Doubling is
    an `add` with the same signal on both sides:
        {"id": "t1", "kind": "add", "left": "b1", "right": "b1", "out": "t1"}
    says t1 = 2 * b1. The last constraint's `out` must be `signal` itself.

    The starter returns nothing, so every value is admitted.
    """
    return []


def range_witness(signal: str, value: int, bits: int) -> dict[str, int]:
    """The witness -- `signal` AND every auxiliary signal -- when `signal` holds `value`.

    `value` is in 0 .. 2**bits - 1. Return {signal: value, <aux name>: <its value>, ...}:
    the grader substitutes exactly this dict into your range_constraints and expects
    every residual to be 0. For the 3-bit idea above and value 5 that is
    {"x": 5, "b0": 1, "b1": 0, "b2": 1, "t1": 0, ...}. Digit i of `value` is
    `(value // 2**i) % 2` (divide by 2**i, take the remainder by 2).

    The starter returns an empty dict.
    """
    return {}
