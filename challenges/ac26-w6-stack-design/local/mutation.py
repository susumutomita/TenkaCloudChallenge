"""Mutation suite: break the reference on purpose, assert the hidden tests notice.

It also measures the thing this problem is about. Every mutation is run twice: once through the
hidden checker, and once through a **weak probe** that asks the two questions anybody writing a
test for an architecture checker asks first -- *does a sound architecture come back with nothing
wrong with it, and does a broken one come back with something?* Both are stated outright in the
problem text, both are one call away from a fixture the learner was handed, and neither of them
asks what broke, where it broke first, what it cost, or what it would take to put back. The
count of mutations the weak probe cannot see is printed on every run and both READMEs quote it.
If a later edit makes the checkpoints cheaper, that number moves and the claim moves with it.

Every replacement below is asserted to have changed the reference text. A mutation whose anchor
has drifted out of the reference would otherwise be reported as killed while testing nothing.
"""

from __future__ import annotations

import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures.generate import (  # noqa: E402
    CASES,
    VARIANTS,
    broken,
    graph,
)
from tests.hidden.check_stack import LABELS, run  # noqa: E402

SEED = "mutation-suite-seed"
REFERENCE = (Path(__file__).resolve().parent / "reference" / "stack.py").read_text("utf-8")

# -- what everything that arrived adds up to ---------------------------------

_MERGED_SECRET_WINS = """    if attribute == "classification":
        return "secret" if any(edge["classification"] == "secret" for edge in arrivals) else "public"
"""

_MERGED_ABSENT = """    carried = [edge[attribute] for edge in arrivals if edge[attribute] is not None]
"""

_MERGED_IDENTITY = """    if attribute == "identity":
        return frozenset(carried)
"""

_MERGED_AGREE = """    return carried[0] if len(set(carried)) == 1 else frozenset(carried)
"""

# -- what an edge is not free to choose --------------------------------------

_REQUIRED_PREMISE = """            if arrivals:
"""

_REQUIRED_LICENCE = """                    if node["transformation"] not in LICENCE[attribute]:
"""

_CARRIED_RETURN = """    return _required(built)
"""

# -- every way it is not the architecture it says it is ----------------------

_CROSSING_TEST = """            if known[edge["source"]]["domain"] != known[edge["target"]]["domain"]
"""

_LICENCE_BLOCK = """    pinned = _required(built)
    for edge in built["edges"]:
        for attribute, want in pinned[edge["id"]].items():
            got = edge[attribute]
            if isinstance(want, frozenset):
                ok = got in want if attribute == "identity" else False
            else:
                ok = got == want
            if not ok:
                out.add((edge["id"], CLASS_OF[attribute]))
"""

_LICENCE_FANIN = """                ok = got in want if attribute == "identity" else False
"""

_LICENCE_CLASS = """                out.add((edge["id"], CLASS_OF[attribute]))
"""

_OBLIGATION_BLOCK = """    known = edges_by_id(built)
    for edge_id, promises in built["obligations"].items():
        for attribute, promise in promises.items():
            value, boundary = promise
            if known[edge_id][attribute] != value:
                out.add((edge_id, boundary))
"""

_OBLIGATION_CLASS = """                out.add((edge_id, boundary))
"""

_AUTH_GUARD = """        if entry is None or node["id"] in policy[entry[0]]:
            continue
"""

_AUTH_REPORT = """        out |= {(edge["id"], entry[1]) for edge in outgoing(built, node["id"])}
"""

_TRUST_BLOCK = """    for group in policy["distinctDomains"]:
        seen: dict = {}
        for node_id in group:
            domain = nodes_by_id(built)[node_id]["domain"]
            if domain in seen:
                for offender in (seen[domain], node_id):
                    out |= {
                        (edge["id"], "trust-collusion-assumption")
                        for edge in outgoing(built, offender)
                    }
            else:
                seen[domain] = node_id
"""

_TRUST_PAIR = """                for offender in (seen[domain], node_id):
"""

_COST_BLOCK = """    out |= {
        (edge_id, "cost-communication-boundary")
        for edge_id in _crossings(built)[policy["maxCrossings"] :]
    }
"""

_COST_SLICE = """        for edge_id in _crossings(built)[policy["maxCrossings"] :]
"""

_CONTRACT_RETURN = """    return tuple(sorted(_violations(built)))
"""

# -- where it broke first ----------------------------------------------------

_FLOW_ARRIVED = """        arrived[step["target"]] += 1
        if arrived[step["target"]] == needed[step["target"]]:
            produced.add(step["target"])
"""

_FIRST_LOOP = """    for edge_id in _flow_order(built):
        if edge_id in broken:
            return edge_id
    return None
"""

# -- what the primitive is vouching for --------------------------------------

_ACCEPTS = """    return all(edge["representation"] in allowed for edge in incoming(built, node_id))
"""

_UNDERWRITES_INCIDENT = """        incident = incoming(built, node["id"]) + outgoing(built, node["id"])
"""

_UNDERWRITES_COVERED = """        covered = (
            node["layer"] == "primitive-inside"
            and _accepts(built, node["id"])
            and not any(edge["id"] in broken for edge in incident)
        )
"""

_UNDERWRITES_VALUE = """        out[node["id"]] = ("correctness", "privacy") if covered else ()
"""

# -- which wire carries which property ---------------------------------------

_PROPERTY_INIT = """    out: dict = {name: set() for name in PROPERTIES}
"""

_PROPERTY_OBLIGATIONS = """        for promise in built["obligations"].get(edge["id"], {}).values():
            classes.add(promise[1])
"""

_PROPERTY_COST = """        for boundary in classes:
            for name in PROPERTY_OF[boundary]:
                out[name].add(edge["id"])
"""

_PROPERTY_RETURN = """    return {name: tuple(sorted(edges)) for name, edges in out.items()}
"""

# -- one change, in either direction -----------------------------------------

_NEIGHBOUR_IDENTITY = """        "identity": tuple(sorted({edge["identity"] for edge in built["edges"]} - {None})) + (None,),
"""

_NEIGHBOUR_DOMAIN = """        for value in domains:
            if value != node["domain"]:
                yield _with_node(built, node["id"], "domain", value)
"""

_NEIGHBOUR_TRANSFORMATION = """        for value in TRANSFORMATIONS:
            if value != node["transformation"]:
                yield _with_node(built, node["id"], "transformation", value)
"""

_CE_LOCAL = """        if not _local_checks_pass(candidate):
            continue
"""

_CE_TARGET = """        if prop in at_risk:
            return candidate
"""

_WHOLE = """    return not _violations(built) and _local_checks_pass(built)
"""

_REPAIR_SOUND = """    if _whole(built):
        return built
"""

_REPAIR_LOOP = """    for candidate in _neighbours(built):
        if _whole(candidate):
            return candidate
    return built
"""

# -- choosing a stack --------------------------------------------------------

_SELECT_ZK = """    if use_case["checkedByOutsider"]:
        chosen.append("zk")
"""

_SELECT_MPC = """    if use_case["computedBy"] == "the-parties-themselves" and use_case["holders"] > 1:
        chosen.append("mpc")
"""

_SELECT_FHE = """    if use_case["computedBy"] == "an-outside-service" and use_case["resultVisibleTo"] != "everyone":
        chosen.append("fhe")
"""

_SELECT_PRIMITIVES = """    primitives = tuple(sorted(chosen)) if chosen else ("none",)
"""

_SELECT_PROOF = """    if "zk" in primitives:
        # A proof is a thing that exists and is looked at. Leaving it off the published list is
        # publishing something the design did not admit to publishing.
        public.add("proof")
"""

_SELECT_SECRET = """        "secret": tuple(sorted(set(use_case["holds"]) - public)),
"""

_SELECT_COST = """        "dominantCost": max((COST_OF[name] for name in primitives), key=COST_ORDER.index),
"""


def _mutations() -> list[tuple[str, str]]:
    return [
        # -- what everything that arrived adds up to ---------------------------
        (
            "a secret merged with a public value comes out public",
            REFERENCE.replace(
                _MERGED_SECRET_WINS,
                '    if attribute == "classification":\n'
                '        return arrivals[0]["classification"]\n',
            ),
        ),
        (
            "an attribute nothing carried counts as an attribute somebody carried",
            REFERENCE.replace(
                _MERGED_ABSENT, "    carried = [edge[attribute] for edge in arrivals]\n"
            ),
        ),
        (
            "an identity may be invented as long as one arrived",
            REFERENCE.replace(_MERGED_IDENTITY, ""),
        ),
        (
            "inputs that were supposed to agree are merged by taking the first",
            REFERENCE.replace(_MERGED_AGREE, "    return carried[0]\n"),
        ),
        # -- what an edge is not free to choose --------------------------------
        (
            "the architecture's premise is graded as one of its claims",
            REFERENCE.replace(_REQUIRED_PREMISE, "            if True:\n"),
        ),
        (
            "a licensed change is a change the contract still pins",
            REFERENCE.replace(
                _REQUIRED_LICENCE, '                    if node["transformation"] in LICENCE[attribute]:\n'
            ),
        ),
        (
            "an edge nothing constrains is an edge nobody described",
            REFERENCE.replace(
                _CARRIED_RETURN,
                "    return {key: value for key, value in _required(built).items() if value}\n",
            ),
        ),
        # -- every way it is not the architecture it says it is -----------------
        (
            "a message that stays inside one trust domain is counted as one that leaves it",
            REFERENCE.replace(
                _CROSSING_TEST,
                '            if known[edge["source"]]["domain"] == known[edge["target"]]["domain"]\n',
            ),
        ),
        (
            "nothing a node was not licensed to change is checked at all",
            REFERENCE.replace(_LICENCE_BLOCK, ""),
        ),
        (
            "a value that could have come from either input came from neither",
            REFERENCE.replace(_LICENCE_FANIN, "                ok = True\n"),
        ),
        (
            "every unlicensed change is the same kind of failure",
            REFERENCE.replace(
                _LICENCE_CLASS, '                out.add((edge["id"], "data-classification"))\n'
            ),
        ),
        (
            "what the architecture promised to deliver is not checked",
            REFERENCE.replace(_OBLIGATION_BLOCK, ""),
        ),
        (
            "a broken promise is classed by the attribute rather than by the promise",
            REFERENCE.replace(
                _OBLIGATION_CLASS,
                "                out.add((edge_id, CLASS_OF[attribute]))\n",
            ),
        ),
        (
            "authorising one node authorises every node",
            REFERENCE.replace(
                _AUTH_GUARD, "        if entry is None or policy[entry[0]]:\n            continue\n"
            ),
        ),
        (
            "a node may hold any operation it is licensed to perform",
            REFERENCE.replace(
                _AUTH_GUARD, "        if entry is not None:\n            continue\n"
            ),
        ),
        (
            "an unapproved operation is reported against what went into it",
            REFERENCE.replace(
                _AUTH_REPORT,
                '        out |= {(edge["id"], entry[1]) for edge in incoming(built, node["id"])}\n',
            ),
        ),
        (
            "two parties on one machine are two parties",
            REFERENCE.replace(_TRUST_BLOCK, ""),
        ),
        (
            "only the party that arrived second is in the wrong place",
            REFERENCE.replace(_TRUST_PAIR, "                for offender in (node_id,):\n"),
        ),
        (
            "the communication budget is not a boundary",
            REFERENCE.replace(_COST_BLOCK, ""),
        ),
        (
            "the communication budget is one message looser than it says",
            REFERENCE.replace(
                _COST_SLICE,
                '        for edge_id in _crossings(built)[policy["maxCrossings"] + 1 :]\n',
            ),
        ),
        (
            "the findings come back in whatever order they were found",
            REFERENCE.replace(
                _CONTRACT_RETURN, "    return tuple(sorted(_violations(built), reverse=True))\n"
            ),
        ),
        # -- where it broke first ----------------------------------------------
        (
            "a merge is reported as happening before one of the values it merged",
            REFERENCE.replace(
                _FLOW_ARRIVED, '        produced.add(step["target"])\n'
            ),
        ),
        (
            "the first failure is the first one alphabetically",
            REFERENCE.replace(
                _FIRST_LOOP,
                "    return sorted(broken)[0] if broken else None\n",
            ),
        ),
        (
            "the last symptom is reported as the diagnosis",
            REFERENCE.replace(
                _FIRST_LOOP,
                "    found = [edge_id for edge_id in _flow_order(built) if edge_id in broken]\n"
                "    return found[-1] if found else None\n",
            ),
        ),
        # -- what the primitive is vouching for ---------------------------------
        (
            "a component is content if anything it was handed is a shape it takes",
            REFERENCE.replace(
                _ACCEPTS,
                '    return any(edge["representation"] in allowed for edge in incoming(built, node_id))\n',
            ),
        ),
        (
            "a component checks what it produced rather than what it was handed",
            REFERENCE.replace(
                _ACCEPTS,
                '    return all(edge["representation"] in allowed for edge in outgoing(built, node_id))\n',
            ),
        ),
        (
            "the primitive vouches for what it produced whatever it received",
            REFERENCE.replace(
                _UNDERWRITES_INCIDENT,
                '        incident = outgoing(built, node["id"])\n',
            ),
        ),
        (
            "the primitive vouches for what it received whatever it produced",
            REFERENCE.replace(
                _UNDERWRITES_INCIDENT,
                '        incident = incoming(built, node["id"])\n',
            ),
        ),
        (
            "a guarantee holds whether or not its assumption did",
            REFERENCE.replace(
                _UNDERWRITES_COVERED,
                "        covered = (\n"
                '            node["layer"] == "primitive-inside"\n'
                '            and _accepts(built, node["id"])\n'
                "        )\n",
            ),
        ),
        (
            "a component that never ran still vouches for the run",
            REFERENCE.replace(
                _UNDERWRITES_COVERED,
                "        covered = (\n"
                '            node["layer"] == "primitive-inside"\n'
                '            and not any(edge["id"] in broken for edge in incident)\n'
                "        )\n",
            ),
        ),
        (
            "everything that is not host orchestration is inside the primitive",
            REFERENCE.replace(
                '            node["layer"] == "primitive-inside"\n',
                '            node["layer"] != "host-orchestration"\n',
            ),
        ),
        (
            "the primitive underwrites every property there is",
            REFERENCE.replace(
                _UNDERWRITES_VALUE,
                '        out[node["id"]] = PROPERTIES if covered else ()\n',
            ),
        ),
        # -- which wire carries which property ----------------------------------
        (
            "a property no wire carries is a property nobody asked about",
            REFERENCE.replace(
                _PROPERTY_INIT,
                "    out: dict = {}\n",
            ),
        ),
        (
            "what the architecture promised about a wire is not what the wire carries",
            REFERENCE.replace(_PROPERTY_OBLIGATIONS, ""),
        ),
        (
            "a boundary class costs the first property it costs",
            REFERENCE.replace(
                _PROPERTY_COST,
                "        for boundary in classes:\n"
                "            out[PROPERTY_OF[boundary][0]].add(edge[\"id\"])\n",
            ),
        ),
        (
            "the map comes back in whatever order the wires were read",
            REFERENCE.replace(
                _PROPERTY_RETURN,
                "    return {name: tuple(sorted(edges, reverse=True)) for name, edges in out.items()}\n",
            ),
        ),
        # -- one change, in either direction ------------------------------------
        (
            "an identity can be given but never taken away",
            REFERENCE.replace(
                _NEIGHBOUR_IDENTITY,
                '        "identity": tuple(sorted({edge["identity"] for edge in built["edges"]} - {None})),\n',
            ),
        ),
        (
            "a computation is where it is and a repair cannot move it",
            REFERENCE.replace(_NEIGHBOUR_DOMAIN, ""),
        ),
        (
            "a counterexample has to break a component to be a counterexample",
            REFERENCE.replace(
                _CE_LOCAL, "        if _local_checks_pass(candidate):\n            continue\n"
            ),
        ),
        (
            "any property lost is the property that was asked for",
            REFERENCE.replace(_CE_TARGET, "        if at_risk:\n            return candidate\n"),
        ),
        (
            "a whole architecture is repaired anyway",
            REFERENCE.replace(_REPAIR_SOUND, ""),
        ),
        (
            "every boundary holding is the whole of being repaired",
            REFERENCE.replace(
                _WHOLE, "    return not _violations(built)\n"
            ),
        ),
        (
            "a repair that leaves fewer breaches than it found is a repair",
            REFERENCE.replace(
                _REPAIR_LOOP,
                "    for candidate in _neighbours(built):\n"
                "        if len(_violations(candidate)) < len(_violations(built)):\n"
                "            return candidate\n"
                "    return built\n",
            ),
        ),
        (
            "the node that opened the secret is authorised to have opened it",
            REFERENCE.replace(
                _REPAIR_LOOP,
                "    everyone = tuple(node[\"id\"] for node in built[\"nodes\"])\n"
                "    granted = {\n"
                "        **built,\n"
                "        \"policy\": {\n"
                "            **built[\"policy\"],\n"
                "            \"mayDeclassify\": everyone,\n"
                "            \"mayCombine\": everyone,\n"
                "            \"mayKeySwitch\": everyone,\n"
                "            \"mayLift\": everyone,\n"
                "        },\n"
                "    }\n"
                "    if _whole(granted):\n"
                "        return granted\n"
                "    for candidate in _neighbours(built):\n"
                "        if _whole(candidate):\n"
                "            return candidate\n"
                "    return built\n",
            ),
        ),
        (
            "the promise it failed to keep is edited out instead",
            REFERENCE.replace(
                _REPAIR_LOOP,
                "    relaxed = {**built, \"obligations\": {}}\n"
                "    if _whole(relaxed):\n"
                "        return relaxed\n"
                "    for candidate in _neighbours(built):\n"
                "        if _whole(candidate):\n"
                "            return candidate\n"
                "    return built\n",
            ),
        ),
        # -- choosing a stack ---------------------------------------------------
        (
            "nobody outside ever has to be convinced",
            REFERENCE.replace(_SELECT_ZK, ""),
        ),
        (
            "one holder computing alone is a multi-party computation",
            REFERENCE.replace(
                _SELECT_MPC,
                '    if use_case["computedBy"] == "the-parties-themselves":\n'
                '        chosen.append("mpc")\n',
            ),
        ),
        (
            "an outside service that may see the answer still may not see the input",
            REFERENCE.replace(
                _SELECT_FHE,
                '    if use_case["computedBy"] == "an-outside-service":\n'
                '        chosen.append("fhe")\n',
            ),
        ),
        (
            "the first primitive that came to mind is the design",
            REFERENCE.replace(
                _SELECT_PRIMITIVES,
                '    primitives = (sorted(chosen)[0],) if chosen else ("none",)\n',
            ),
        ),
        (
            "needing nothing is answered with nothing rather than with saying so",
            REFERENCE.replace(
                _SELECT_PRIMITIVES, "    primitives = tuple(sorted(chosen))\n"
            ),
        ),
        (
            "a proof is not something the design publishes",
            REFERENCE.replace(_SELECT_PROOF, ""),
        ),
        (
            "something published is also something kept",
            REFERENCE.replace(
                _SELECT_SECRET,
                '        "secret": tuple(sorted(use_case["holds"])),\n',
            ),
        ),
        (
            "a combination costs what its cheapest member costs",
            REFERENCE.replace(
                _SELECT_COST,
                '        "dominantCost": min((COST_OF[name] for name in primitives), key=COST_ORDER.index),\n',
            ),
        ),
    ]


def _load(source: str) -> types.ModuleType:
    module = types.ModuleType("mut_stack")
    exec(compile(source, "<mutation>", "exec"), module.__dict__)  # noqa: S102 - our own fixtures
    return module


#: The one variant the weak probe is allowed to look at. Any of the eleven would do; the point is
#: that the probe asks whether *something* is wrong rather than what.
_PROBE_VARIANT = VARIANTS[0]


def _easy_cases_agree(module) -> bool:
    """The two questions a natural test of an architecture checker asks, and nothing else.

    Does a sound architecture come back with nothing wrong with it, and does a broken one come
    back with something? Both are stated in the problem text, both are one call away from a
    fixture the learner was handed, and both are things a checker can get right while
    understanding none of the contracts it is checking. Nothing here asks which contract broke,
    which of several symptoms came first, what the primitive was actually vouching for, which
    wire carries which property, what a repair costs, or which primitives a brief needs -- and
    each of those is a different way to be wrong while still getting these two right.
    """
    for label in LABELS:
        drawn = f"{SEED}:{label}"
        try:
            for case in CASES:
                if tuple(module.contract_violations(graph(drawn, case))) != ():
                    return False
            hurt = broken(drawn, _PROBE_VARIANT)
            if not module.contract_violations(hurt):
                return False
            if module.first_failure(hurt) is None:
                return False
        except Exception:  # noqa: BLE001 - a checker that raises has not answered
            return False
    return True


SPOOF = "\n".join(
    [
        "import atexit, json",
        'atexit.register(lambda: print(json.dumps({"failures": []})))',
        "",
    ]
)


def main() -> int:
    reference = _load(REFERENCE)
    reference_failures = run(reference, SEED)
    if reference_failures:
        print("FAIL reference implementation does not pass the hidden tests")
        for failure in reference_failures:
            print(f"  {failure}")
        return 1
    print("PASS reference implementation passes the hidden tests")
    if not _easy_cases_agree(reference):
        print("FAIL reference implementation does not get the easy two right")
        return 1
    print("PASS reference implementation gets the easy two right")

    mutations = _mutations()
    survivors: list[str] = []
    invisible: list[str] = []
    for name, source in mutations:
        if source == REFERENCE:
            survivors.append(f"{name} (the mutation did not change the reference)")
            print(f"SURVIVED {name} -- the replacement matched nothing")
            continue
        module = None
        try:
            module = _load(source)
            failures = run(module, SEED)
        except Exception as error:  # noqa: BLE001 - a stack that cannot even load is caught
            failures = [f"the mutated stack raised {type(error).__name__} at import"]
        # The same module object the checker was handed, not a second load of the same source.
        # A mutation that cannot be imported at all has no weak-probe answer to give, and asking
        # for one would raise here rather than in the guarded block above.
        if module is not None and _easy_cases_agree(module):
            invisible.append(name)
        if failures:
            print(f"KILLED {name} ({failures[0]})")
        else:
            survivors.append(name)
            print(f"SURVIVED {name}")

    from verifier.server import evaluate  # noqa: PLC0415 - imported after sys.path

    if evaluate("contracts", SPOOF):
        survivors.append("verifier credits a submission that prints its own verdict")
        print("SURVIVED verifier credits a submission that prints its own verdict")
    else:
        print("KILLED verifier credits a submission that prints its own verdict")

    print()
    print(f"{len(invisible)} of {len(mutations)} broken stacks still get the easy two right:")
    for name in invisible:
        print(f"  - {name}")

    print()
    if survivors:
        print(f"{len(survivors)} mutation(s) survived:")
        for name in survivors:
            print(f"  - {name}")
        return 1
    print(f"All {len(mutations) + 1} mutations killed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
