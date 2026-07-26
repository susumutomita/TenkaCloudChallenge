"""`make inspect` — the three architectures, their contracts, and what they promised.

Everything printed here is public by construction: it is the architecture document a reviewer
would be handed. The private half is not printed, and neither is any answer — which contract
each variant breaks, where it broke first, what a repair costs, and which primitive a brief
needs are the checkpoints, so this file shows you the objects and not the verdicts.

The one thing it does answer is that all three architectures are sound to begin with, because
that is the premise rather than the exercise: every variant below is one change away from a
graph in which every contract holds, so a diagnosis has a baseline to be a diagnosis against.

The tables below are printed from the fixtures rather than from the reference stack, so running
this gives away no part of the file you are asked to write.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures.generate import (
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
    crossings,
    graph,
    health_token,
    use_cases,
    violations,
)

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def main() -> None:
    print("== the three architectures ==")
    for case in CASES:
        built = graph(SEED, case)
        print(
            f"  {case:13s} {len(built['nodes'])} nodes, {len(built['edges'])} edges, "
            f"{len(crossings(built))} of them crossing a trust boundary"
        )
    print("  Every one of them is sound: every contract below holds on every wire. That is the")
    print("  baseline, not the exercise -- each variant later on is one change away from it.")
    print()

    built = graph(SEED, "mpc-prover")
    print("== one of them, in full ==")
    print("  nodes:")
    print("    " + "".join(f"{name:20s}" for name in NODE_FIELDS))
    for node in built["nodes"]:
        print("    " + "".join(f"{str(node[name]):20s}" for name in NODE_FIELDS))
    print("  edges:")
    print("    " + "".join(f"{name:16s}" for name in EDGE_FIELDS))
    for edge in built["edges"]:
        print("    " + "".join(f"{str(edge[name]):16s}" for name in EDGE_FIELDS))
    print(f"  contracts broken: {len(violations(built))}")
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
    for use_case in use_cases(SEED):
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

    print(f"health token: {health_token(SEED)}")


if __name__ == "__main__":
    main()
