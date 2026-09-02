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


def _bit(signal: str, index: int) -> str:
    return f"{signal}.b{index}"


def range_constraints(signal: str, bits: int) -> list[dict]:
    """Horner form: value = ((b_{n-1} * 2 + b_{n-2}) * 2 + ...) * 2 + b_0.

    `bits` boolean constraints, then for each lower digit one doubling `add`
    (same signal on both sides) and one `add` that appends the digit -- 3 * bits - 2
    constraints, linear in the width. A one-bit range is the boolean constraint on
    the signal itself.
    """
    if bits == 1:
        return [{"id": f"range-{signal}-bit0", "kind": "boolean", "signal": signal}]
    constraints: list[dict] = [
        {"id": f"range-{signal}-bit{index}", "kind": "boolean", "signal": _bit(signal, index)}
        for index in range(bits)
    ]
    accumulator = _bit(signal, bits - 1)
    for index in range(bits - 2, -1, -1):
        doubled = f"{signal}.d{index}"
        total = signal if index == 0 else f"{signal}.s{index}"
        constraints.append(
            {"id": f"range-{signal}-double{index}", "kind": "add", "left": accumulator, "right": accumulator, "out": doubled}
        )
        constraints.append(
            {"id": f"range-{signal}-sum{index}", "kind": "add", "left": doubled, "right": _bit(signal, index), "out": total}
        )
        accumulator = total
    return constraints


def range_witness(signal: str, value: int, bits: int) -> dict[str, int]:
    if bits == 1:
        return {signal: value}
    witness: dict[str, int] = {signal: value}
    for index in range(bits):
        witness[_bit(signal, index)] = (value // 2**index) % 2
    accumulator = witness[_bit(signal, bits - 1)]
    for index in range(bits - 2, -1, -1):
        doubled = accumulator * 2
        witness[f"{signal}.d{index}"] = doubled
        accumulator = doubled + witness[_bit(signal, index)]
        if index != 0:
            witness[f"{signal}.s{index}"] = accumulator
    return witness
