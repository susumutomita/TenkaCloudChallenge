"""Reference solution. Ships inside the image so the mutation suite can break it on purpose.

The multiplication itself is four lines. What takes the space is everything that makes those
four lines checkable: refusing a triple that was drawn for another statement, opening `d` and
`e` under one round id rather than two, folding the public `d*e` into exactly one party's
share, and reporting what the runtime's records say rather than what the implementer knows
the answer to be.
"""

from __future__ import annotations

# Issue 543 option B2: the supplied layer moved out of `fixtures/` into
# `participant/mpc.py`, which is what the participant image ships. `verifier/server.py`'s
# runner preloads it before the Issue 591 guard drops the problem root from `sys.path`, so
# this top-level import resolves when the reference is graded as a submission.
from participant.mpc import field_id

#: The local operations one Beaver multiplication needs, sorted. `open` is not among them,
#: which is the entire point of the plan: it is the one thing in this step that communicates.
LOCAL_OPERATIONS = ("add", "add-public", "mul-public", "sub")


def multiplication_plan(relation: dict, products: int = 1) -> dict:
    prime = relation.get("p")
    parties = relation.get("parties")
    field = relation.get("fieldId")

    for name, value in (("p", prime), ("parties", parties), ("products", products)):
        if isinstance(value, bool) or not isinstance(value, int):
            raise ValueError(f"{name} must be an integer")
    if prime < 2:
        raise ValueError("relation p must be a prime modulus of at least 2")
    if field != field_id(prime):
        raise ValueError(f"relation fieldId {field!r} does not name the field of p={prime}")
    if parties < 2:
        raise ValueError("a shared witness needs at least two parties")
    if products < 0:
        raise ValueError("a layer cannot hold a negative number of multiplications")

    return {
        "products": products,
        "triples": products,
        "opens": 2 * products,
        # One round for the whole layer, however wide it is -- and no round at all for a
        # layer with nothing in it. Asserting 1 is the mistake this field exists to catch.
        "rounds": 1 if products else 0,
        "messages": 2 * products * parties,
        "local": LOCAL_OPERATIONS if products else (),
        "fieldId": field,
        "relationId": relation.get("relationId"),
    }


def reserve_fresh_triple(runtime, relation: dict, triple) -> dict:
    # The runtime checks a triple against the *setting*. Whether it belongs to the statement
    # being proved is a question only the caller holding the relation can ask.
    if getattr(triple, "fieldId", None) != relation.get("fieldId"):
        raise ValueError("the triple was drawn for another field than the relation's")
    if getattr(triple, "parties", None) != relation.get("parties"):
        raise ValueError("the triple was drawn for another party count than the relation's")

    reserved = runtime.reserve_triple(triple)
    return {
        "tripleId": reserved.id,
        "fieldId": reserved.fieldId,
        "parties": reserved.parties,
        "consumed": tuple(runtime.consumed_triples()),
    }


def masked_operands(runtime, triple, halves: dict) -> dict:
    parties = runtime.setting["parties"]
    d_shares, e_shares = [], []
    for party in range(parties):
        with runtime.party_scope(party):
            d_shares.append(runtime.sub(halves["A"][party], triple.x[party]))
            e_shares.append(runtime.sub(halves["B"][party], triple.y[party]))
    return {"d": tuple(d_shares), "e": tuple(e_shares)}


def open_masks(runtime, round_id: str, masked: dict) -> dict:
    d = runtime.open(round_id, masked["d"])
    e = runtime.open(round_id, masked["e"])
    records = runtime.openings()
    return {
        "d": d,
        "e": e,
        "roundId": round_id,
        "openings": len(records),
        "rounds": len({record["roundId"] for record in records}),
    }


def shared_product(runtime, triple, d: int, e: int) -> tuple:
    prime = runtime.setting["p"]
    parties = runtime.setting["parties"]
    out = []
    for party in range(parties):
        with runtime.party_scope(party):
            total = runtime.add(triple.z[party], runtime.mul_public(triple.y[party], d))
            total = runtime.add(total, runtime.mul_public(triple.x[party], e))
            if party == 0:
                # Public constants are added once, not once per party. Which party does it
                # is arbitrary; that exactly one does is not.
                total = runtime.add_public(total, (d * e) % prime)
            out.append(total)
    return tuple(out)


def prove_product(runtime, relation: dict, halves: dict, triple) -> dict:
    reservation = reserve_fresh_triple(runtime, relation, triple)
    masked = masked_operands(runtime, triple, halves)
    round_id = f"{relation['relationId']}:mul"
    opened = open_masks(runtime, round_id, masked)
    product = shared_product(runtime, triple, opened["d"], opened["e"])
    return {
        "A": tuple(halves["A"]),
        "B": tuple(halves["B"]),
        "C": product,
        "d": opened["d"],
        "e": opened["e"],
        "tripleId": reservation["tripleId"],
        "roundId": round_id,
        "rounds": opened["rounds"],
    }


def proof_artifact(runtime, relation: dict, halves: dict, triple) -> dict:
    proof = prove_product(runtime, relation, halves, triple)
    return {
        "relationId": relation["relationId"],
        "fieldId": relation["fieldId"],
        "parties": relation["parties"],
        "A": proof["A"],
        "B": proof["B"],
        "C": proof["C"],
        "tripleId": proof["tripleId"],
        "roundId": proof["roundId"],
    }


def privacy_audit(runtime, relation: dict, halves: dict, triple) -> dict:
    prove_product(runtime, relation, halves, triple)
    records = runtime.openings()
    return {
        "opened": len(records),
        "rounds": len({record["roundId"] for record in records}),
        "unmasked": sum(1 for record in records if not record["maskedBy"]),
        "violations": len(runtime.violations()),
        "triplesConsumed": tuple(runtime.consumed_triples()),
        "reconstructAvailable": hasattr(runtime, "reconstruct"),
    }
