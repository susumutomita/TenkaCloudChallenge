"""Reference solution. Ships inside the image so the mutation suite can break it on purpose.

The whole linear layer of a co-SNARK prover is one identity applied party by party. What
takes the space is everything around it: rejecting a relation that does not describe a field,
checking the sharing before touching it, and reporting what the log says rather than what the
implementer believes it says.
"""

from __future__ import annotations

from fixtures.generate import field_id


def parse_relation(relation: dict) -> dict:
    prime = relation.get("p")
    width = relation.get("width")
    parties = relation.get("parties")
    field = relation.get("fieldId")

    for name, value in (("p", prime), ("width", width), ("parties", parties)):
        if isinstance(value, bool) or not isinstance(value, int):
            raise ValueError(f"relation {name} must be an integer")
    if prime < 2:
        raise ValueError("relation p must be a prime modulus of at least 2")
    if field != field_id(prime):
        raise ValueError(f"relation fieldId {field!r} does not name the field of p={prime}")
    if width < 1:
        raise ValueError("a relation row needs at least one witness position")
    if parties < 2:
        raise ValueError("a shared witness needs at least two parties")

    vectors = {}
    for name in ("a", "b"):
        raw = relation.get(name)
        if not isinstance(raw, (list, tuple)):
            raise ValueError(f"coefficient vector {name} must be a sequence")
        if len(raw) != width:
            raise ValueError(f"coefficient vector {name} has {len(raw)} entries, width is {width}")
        if any(isinstance(c, bool) or not isinstance(c, int) for c in raw):
            raise ValueError(f"coefficient vector {name} holds a non-integer")
        # The canonical representative, not the one that arrived. -3 in F_97 is 94.
        vectors[name] = tuple(c % prime for c in raw)

    return {
        "a": vectors["a"],
        "b": vectors["b"],
        "p": prime,
        "width": width,
        "parties": parties,
        "fieldId": field,
    }


def validate_shared_witness(runtime, relation: dict, shares) -> dict:
    width, parties = relation["width"], relation["parties"]
    field = relation["fieldId"]

    if not isinstance(shares, (list, tuple)):
        raise ValueError("the shared witness must be a sequence of sharings")
    if len(shares) != width:
        raise ValueError(f"the witness has {len(shares)} sharings, the relation declares {width}")

    seen: set[str] = set()
    identifiers = []
    for index, sharing in enumerate(shares):
        if not isinstance(sharing, (list, tuple)):
            raise ValueError(f"witness position {index} is not a sharing")
        if len(sharing) != parties:
            raise ValueError(
                f"witness position {index} holds {len(sharing)} shares, {parties} parties declared"
            )
        row = []
        for party, share in enumerate(sharing):
            if getattr(share, "party", None) != party:
                raise ValueError(
                    f"witness position {index} is not in party order at slot {party}"
                )
            if getattr(share, "field", None) != field:
                raise ValueError(
                    f"witness position {index} party {party} lives in {share.field}, not {field}"
                )
            if share.id in seen:
                raise ValueError(f"share {share.id!r} appears at more than one witness position")
            seen.add(share.id)
            row.append(share.id)
        identifiers.append(tuple(row))

    return {
        "width": width,
        "parties": parties,
        "fieldId": field,
        "shareIds": tuple(identifiers),
    }


def shared_linear_combination(runtime, coefficients, shares) -> tuple:
    parties = runtime.setting["parties"]
    out = []
    for party in range(parties):
        with runtime.party_scope(party):
            total = runtime.zero()
            for coefficient, sharing in zip(coefficients, shares):
                total = runtime.add(total, runtime.mul_public(sharing[party], coefficient))
            out.append(total)
    return tuple(out)


def prove_linear(runtime, relation: dict, shares) -> dict:
    parsed = parse_relation(relation)
    validate_shared_witness(runtime, parsed, shares)
    return {
        "A": shared_linear_combination(runtime, parsed["a"], shares),
        "B": shared_linear_combination(runtime, parsed["b"], shares),
    }


def no_reconstruction_report(runtime, relation: dict, shares) -> dict:
    parsed = parse_relation(relation)
    proof = prove_linear(runtime, relation, shares)

    owner_of = {share.id: share.party for sharing in shares for share in sharing}
    issued = True
    single_party = True
    for results in (proof["A"], proof["B"]):
        for party, result in enumerate(results):
            if not runtime.issued(result):
                issued = False
                continue
            owners = {
                owner_of[identifier]
                for identifier in runtime.ancestry(result)
                if identifier in owner_of
            }
            if owners - {party}:
                single_party = False

    return {
        "issued": issued,
        "singleParty": single_party,
        "violations": len(runtime.violations()),
        "reconstructAvailable": hasattr(runtime, "reconstruct"),
        "width": parsed["width"],
    }


def communication_report(runtime, relation: dict, shares) -> dict:
    prove_linear(runtime, relation, shares)
    events = runtime.events()
    return {
        "operations": len(events),
        "rounds": sum(1 for event in events if event.get("communication")),
        "messages": sum(int(event.get("messages", 0)) for event in events),
        "parties": tuple(sorted({event["party"] for event in events})),
        "localOnly": not any(event.get("communication") for event in events),
    }
