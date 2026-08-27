"""The residual evaluator. Given, not written by the learner -- ac26-w1-constraint-lab
is where that was built. Here it is infrastructure so the attention stays on soundness.
"""

from __future__ import annotations


def residual(constraint: dict, witness: dict[str, int], p: int) -> int:
    kind = constraint["kind"]
    get = lambda name: witness[str(constraint[name])]  # noqa: E731 - local shorthand
    if kind == "boolean":
        v = witness[str(constraint["signal"])]
        return (v * (v - 1)) % p
    if kind == "mul":
        return (get("left") * get("right") - get("out")) % p
    if kind == "add":
        return (get("left") + get("right") - get("out")) % p
    if kind == "const":
        return (witness[str(constraint["signal"])] - int(constraint["value"])) % p  # type: ignore[arg-type]
    if kind == "iszero_a":
        return (get("value") * get("inv") + get("out") - 1) % p
    if kind == "iszero_b":
        return (get("value") * get("out")) % p
    raise ValueError(f"unknown constraint kind: {kind}")


def satisfies(circuit: list[dict], witness: dict[str, int], p: int) -> bool:
    try:
        return all(residual(c, witness, p) == 0 for c in circuit)
    except KeyError:
        return False
