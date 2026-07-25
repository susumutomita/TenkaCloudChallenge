"""Reference constraint evaluation. Inside the image only."""

from __future__ import annotations

from field import Field


class MissingSignal(KeyError):
    """A constraint named a signal the witness does not assign."""


def _get(witness: dict[str, int], name: str) -> int:
    if name not in witness:
        raise MissingSignal(name)
    return witness[name]


def evaluate(constraint: dict, witness: dict[str, int], field: Field) -> int:
    kind = constraint["kind"]
    if kind == "mul":
        left = _get(witness, constraint["left"])
        right = _get(witness, constraint["right"])
        return field.sub(field.mul(left, right), _get(witness, constraint["out"]))
    if kind == "add":
        left = _get(witness, constraint["left"])
        right = _get(witness, constraint["right"])
        return field.sub(field.add(left, right), _get(witness, constraint["out"]))
    if kind == "const":
        return field.sub(_get(witness, constraint["signal"]), int(constraint["value"]))
    if kind == "boolean":
        value = _get(witness, constraint["signal"])
        return field.mul(value, field.sub(value, 1))
    if kind == "member":
        value = _get(witness, constraint["signal"])
        product = 1
        for allowed in constraint["allowed"]:
            product = field.mul(product, field.sub(value, int(allowed)))
        return field.normalize(product)
    raise ValueError(f"unknown constraint kind: {kind}")


def trace(circuit: list[dict], witness: dict[str, int], field: Field) -> list[dict]:
    return [
        {"id": c["id"], "residual": evaluate(c, witness, field)} for c in circuit
    ]


def first_broken(circuit: list[dict], witness: dict[str, int], field: Field) -> str | None:
    for entry in trace(circuit, witness, field):
        if entry["residual"] != 0:
            return str(entry["id"])
    return None
