"""`make inspect` — the three architectures, their contracts, and what they promised.

Everything printed here is public by construction: it is the architecture document a reviewer
would be handed. The private half is not printed, and neither is any answer — which contract
each variant breaks, where it broke first, what a repair costs, and which primitive a brief
needs are the checkpoints, so this file shows you the objects and not the verdicts.

The one thing it does answer is that all three architectures are sound to begin with, because
that is the premise rather than the exercise: every variant below is one change away from a
graph in which every contract holds, so a diagnosis has a baseline to be a diagnosis against.

The tables below are printed from this deployment's public evidence rather than from the
reference stack, so running this gives away no part of the file you are asked to write.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from participant.lab import (
    ATTRIBUTES,
    AUTHORISED,
    BOUNDARY_CLASSES,
    CASES,
    COMPUTED_BY,
    CONSUMES,
    COST_OF,
    COST_ORDER,
    COUNTEREXAMPLE_TARGETS,
    EDGE_FIELDS,
    LAYERS,
    LICENCE,
    NODE_FIELDS,
    PRIMITIVES,
    PROPERTIES,
    PROPERTY_OF,
    RESULT_VISIBLE,
    TRUST_OF,
    USE_CASE_FIELDS,
    VARIANTS,
)

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def public_evidence() -> dict:
    """This deployment's public half -- the same values `verifier/server.py`'s `GET /public`
    serves, and the same architectures, variants and briefs this file has always printed.

    Issue 537/538 (Issue 543 option B2): `fixtures/generate.py` does not ship in the
    `participant` Docker stage any more (see local/Dockerfile). It holds this problem's whole
    ground truth under other names -- `constrained` is `carried`, `underwritten` is
    `underwrites`, `load_bearing` is `property_map`, `violations` is `contract_violations`,
    `first_broken` is `first_failure`, `selection_truth` is `select`, and
    `_one_change_neighbours` with `local_checks_pass` and `_whole` is the search `counterexample`
    and `repair` are graded on -- as well as `BREAKS`, which names what each variant broke,
    identically on every seed. `make inspect` now runs through Compose (see the Makefile) so this
    process can reach the verifier over the network instead.
    """
    injected = os.environ.get("PUBLIC_EVIDENCE_JSON")
    if injected:
        return json.loads(injected)
    verifier_public_url = os.environ.get("VERIFIER_PUBLIC_URL")
    if verifier_public_url:
        from urllib.error import HTTPError, URLError
        from urllib.request import urlopen

        try:
            with urlopen(verifier_public_url, timeout=10) as response:  # noqa: S310
                return json.loads(response.read().decode("utf-8"))
        except (HTTPError, URLError, TimeoutError, OSError, ValueError) as error:
            # Compose health-gates the workbench on the verifier, so this normally cannot
            # happen. When it does -- a `docker compose run` against a torn-down deployment --
            # say which service is missing instead of printing a urllib traceback at somebody
            # trying to read their own architecture.
            raise SystemExit(
                "cannot reach this deployment's verifier "
                f"({verifier_public_url}): {type(error).__name__}.\n"
                "The public evidence lives there since Issue 537/538. "
                "Start it with `make verifier-up` and try again."
            ) from error
    # Neither is set: this resolves only where `fixtures/` is actually on disk -- a checkout,
    # or the verifier/author Docker stage -- and never inside a built `participant` image, so
    # this branch does not reopen the leak above.
    from fixtures.generate import public_payload

    return public_payload(SEED)


def architecture(over_the_wire: dict) -> dict:
    """One architecture as the fixtures used to hand it over: tuples again, all the way down.

    The starter is written against the dict shape `graph(seed, case)` returned, so the wire form
    is turned back into exactly that here rather than leaving every reader to do it. `policy`
    keeps `maxCrossings` an int and `distinctDomains` a tuple of tuples; `obligations` goes back
    to `edge -> attribute -> (value, boundary class)`.
    """
    return {
        "caseId": over_the_wire["caseId"],
        "nodes": tuple(dict(node) for node in over_the_wire["nodes"]),
        "edges": tuple(dict(edge) for edge in over_the_wire["edges"]),
        "policy": {
            key: (
                value
                if isinstance(value, int)
                else tuple(tuple(group) for group in value)
                if key == "distinctDomains"
                else tuple(value)
            )
            for key, value in over_the_wire["policy"].items()
        },
        "obligations": {
            edge_id: {
                attribute: (pair[0], pair[1]) for attribute, pair in promises.items()
            }
            for edge_id, promises in over_the_wire["obligations"].items()
        },
    }


def use_case_record(over_the_wire: dict) -> dict:
    """One brief as the fixtures used to hand it over: its two name lists as tuples again."""
    return {
        **over_the_wire,
        "publishes": tuple(over_the_wire["publishes"]),
        "holds": tuple(over_the_wire["holds"]),
    }


def sound_architectures(evidence: dict) -> dict:
    """Case id -> the sound architecture for it, in the shape the starter expects."""
    return {built["caseId"]: architecture(built) for built in evidence["cases"]}


def broken_architectures(evidence: dict) -> dict:
    """Variant name -> that deployment, in the shape the starter expects.

    This is what `broken(seed, variant)` used to return. The rule that produced them does not
    ship any more -- see `verifier/server.py`'s `GET /public`.
    """
    return {
        variant: architecture(built) for variant, built in evidence["variants"].items()
    }


def briefs(evidence: dict) -> tuple[dict, ...]:
    """The eight briefs, in the order this deployment hands them over."""
    return tuple(use_case_record(entry) for entry in evidence["useCases"])


def main() -> None:
    evidence = public_evidence()
    sound = sound_architectures(evidence)

    print("== the three architectures ==")
    for case in CASES:
        built = sound[case]
        print(
            f"  {case:13s} {len(built['nodes'])} nodes, {len(built['edges'])} edges, "
            f"{len(evidence['crossings'][case])} of them crossing a trust boundary"
        )
    print("  Every one of them is sound: every contract below holds on every wire. That is the")
    print("  baseline, not the exercise -- each variant later on is one change away from it.")
    print()

    built = sound["mpc-prover"]
    print("== one of them, in full ==")
    print("  nodes:")
    print("    " + "".join(f"{name:20s}" for name in NODE_FIELDS))
    for node in built["nodes"]:
        print("    " + "".join(f"{str(node[name]):20s}" for name in NODE_FIELDS))
    print("  edges:")
    print("    " + "".join(f"{name:16s}" for name in EDGE_FIELDS))
    for edge in built["edges"]:
        print("    " + "".join(f"{str(edge[name]):16s}" for name in EDGE_FIELDS))
    # Zero, on all three, and stated rather than computed: it is the premise this problem starts
    # from, and counting it here would mean shipping the counter -- which is `contract_violations`.
    print("  contracts broken: 0")
    print()

    print("== the three levels of contract ==")
    print("  1. LICENCE -- what a transformation may change:")
    for attribute in ATTRIBUTES:
        allowed = ", ".join(LICENCE[attribute]) or "nothing may change it"
        print(f"       {attribute:16s} {allowed}")
    print("  2. policy -- which nodes this architecture allowed to hold one of these:")
    for transformation, (key, boundary) in AUTHORISED.items():
        print(f"       {transformation:11s} policy[{key!r}]   unapproved -> {boundary}")
    print(f"       this case: {built['policy']}")
    print("  3. obligations -- what it promised to deliver, and where:")
    for edge_id, promises in built["obligations"].items():
        for attribute, (value, boundary) in promises.items():
            print(f"       {edge_id}.{attribute} must be {value!r}   otherwise {boundary}")
    print("  A licensed change is not a correct change, and an approved node is not a correct")
    print("  value. All three levels are separate questions and all three are asked.")
    print()

    print("== a component's own check ==")
    for transformation in sorted(CONSUMES):
        allowed = CONSUMES[transformation]
        shown = "any representation" if len(allowed) > 3 else ", ".join(allowed)
        print(f"  {transformation:11s} takes in {shown}")
    print("  That is the whole of it. Classification, key domain, identity and dialect travel")
    print("  through a component unread, which is why every failure here happens with every")
    print("  local check passing.")
    print()

    print("== the eleven boundary classes, and what breaking one costs ==")
    for boundary in BOUNDARY_CLASSES:
        print(f"  {boundary:36s} {', '.join(PROPERTY_OF[boundary])}")
    print(f"  the execution layers a node can sit in: {', '.join(LAYERS)}")
    print(f"  the end-to-end properties: {', '.join(PROPERTIES)}")
    print()

    print("== the deployments you will diagnose ==")
    for variant in VARIANTS:
        print(f"  {variant}")
    print("  Each is one change away from one of the three architectures above. Which contract")
    print("  it breaks, where the value first stopped being what it said it was, and what it")
    print("  costs to put back are the checkpoints, so none of them is printed here.")
    print("  The deployments themselves are yours to read:")
    print("      from show import broken_architectures, public_evidence")
    print("      broken_architectures(public_evidence())[<name>]")
    print()

    print("== the counterexamples you will construct ==")
    for case, prop in COUNTEREXAMPLE_TARGETS:
        print(f"  lose {prop} in {case}, with every component still content")
    print("  Note which of the five properties is never on that list, and ask why nothing you")
    print("  can do to a value in flight costs it. The answer is also one of the keys the")
    print("  property map asks for, so it is not printed here.")
    print()

    print("== the briefs you will design for ==")
    print(f"  a brief says exactly these things: {', '.join(USE_CASE_FIELDS)}")
    print(f"  who computes it:      {', '.join(COMPUTED_BY)}")
    print(f"  who may see it:       {', '.join(RESULT_VISIBLE)}")
    print(f"  what you may reach for: {', '.join(PRIMITIVES)}, or none of them")
    for use_case in briefs(evidence):
        print(
            f"  {use_case['id']}  holders={use_case['holders']} "
            f"computedBy={use_case['computedBy']:23s} "
            f"checkedByOutsider={str(use_case['checkedByOutsider']):5s} "
            f"resultVisibleTo={use_case['resultVisibleTo']}"
        )
        print(
            f"                 publishes={', '.join(use_case['publishes'])}   "
            f"holds={', '.join(use_case['holds'])}"
        )
    print("  what each primitive asks you to trust:")
    for name, assumptions in TRUST_OF.items():
        print(f"    {name:5s} {', '.join(assumptions)}")
    print("  what each one spends:")
    for name, cost in COST_OF.items():
        print(f"    {name:5s} {cost}")
    print(f"  cheapest first: {' < '.join(COST_ORDER)}")
    print("  Which primitives each brief needs is the checkpoint. More than one of them needs")
    print("  more than one.")
    print()

    print(f"health token: {evidence['healthToken']}")


if __name__ == "__main__":
    main()
