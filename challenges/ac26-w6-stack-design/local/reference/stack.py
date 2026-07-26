"""Reference solution. Ships inside the image so the mutation suite can break it on purpose.

The eight functions are one model, not eight exercises, and that is why they are short. Three
tables decide everything: `LICENCE` says what a transformation may change, `AUTHORISED` says
which nodes an architecture allowed to hold such a transformation, and the graph's own
`obligations` say what it promised to deliver and where. Every other function reads the answer
off `_violations` or off `_required`, and there is deliberately no second opinion about what a
contract says anywhere in this file. Two checkers that agree most of the time are two
architectures, and the seam between them is where a composition failure lives.

The line most worth arguing about is in `_required`, and it is the `if not arrivals: continue`.
A node with nothing arriving invents its output rather than transforming one, so there is no
before to compare against: what a source node emits is the architecture's premise, and a premise
is not a claim you can catch it breaking. Treating premises as claims makes every architecture
look broken at its own front door, which is the same as making none of them look broken at all.

`counterexample` and `repair` are the only two that search, and they search the same space --
one change to one edge attribute, one node's trust domain, or one node's transformation. That
they are the same space is the point of the pair: the cheapest way to break an architecture and
the cheapest way to fix one are the same kind of move, and only the direction differs.
"""

from __future__ import annotations

from fixtures.generate import (
    ALGEBRAS,
    ATTRIBUTES,
    AUTHORISED,
    CLASS_OF,
    CLASSIFICATIONS,
    CONSUMES,
    COST_OF,
    COST_ORDER,
    KEY_DOMAINS,
    LICENCE,
    PROPERTIES,
    PROPERTY_OF,
    REPRESENTATIONS,
    SERIALIZATIONS,
    TRANSFORMATIONS,
    TRUST_OF,
    edges_by_id,
    incoming,
    nodes_by_id,
    outgoing,
)


# ---------------------------------------------------------------------------
# what a value has to be by the time it gets there
# ---------------------------------------------------------------------------


def _merged(arrivals: tuple, attribute: str):
    """What everything that arrived at one node adds up to, for one attribute.

    A node with two inputs does not transform a value, it merges two, and merging is not the
    same rule for every attribute. Secret wins on classification, because a function of a secret
    is a secret. An identity may be carried forward but not invented, so the answer is the set of
    identities that arrived and any one of them will do. Everything else has to agree, and where
    it does not, no single value is honest.
    """
    if not arrivals:
        return None
    if attribute == "classification":
        return "secret" if any(edge["classification"] == "secret" for edge in arrivals) else "public"
    carried = [edge[attribute] for edge in arrivals if edge[attribute] is not None]
    if not carried:
        return None
    if attribute == "identity":
        return frozenset(carried)
    return carried[0] if len(set(carried)) == 1 else frozenset(carried)


def _required(built: dict) -> dict:
    out: dict = {}
    for node in built["nodes"]:
        arrivals = incoming(built, node["id"])
        for after in outgoing(built, node["id"]):
            pinned = {}
            if arrivals:
                for attribute in ATTRIBUTES:
                    if node["transformation"] not in LICENCE[attribute]:
                        pinned[attribute] = _merged(arrivals, attribute)
            out[after["id"]] = pinned
    return out


def carried(built: dict) -> dict:
    """Edge id -> the attributes that edge is not free to choose, and what they have to be."""
    return _required(built)


# ---------------------------------------------------------------------------
# every way one architecture is not the architecture it says it is
# ---------------------------------------------------------------------------


def _crossings(built: dict) -> tuple[str, ...]:
    known = nodes_by_id(built)
    return tuple(
        sorted(
            edge["id"]
            for edge in built["edges"]
            if known[edge["source"]]["domain"] != known[edge["target"]]["domain"]
        )
    )


def _violations(built: dict) -> set:
    out: set = set()
    pinned = _required(built)
    for edge in built["edges"]:
        for attribute, want in pinned[edge["id"]].items():
            got = edge[attribute]
            if isinstance(want, frozenset):
                ok = got in want if attribute == "identity" else False
            else:
                ok = got == want
            if not ok:
                out.add((edge["id"], CLASS_OF[attribute]))

    known = edges_by_id(built)
    for edge_id, promises in built["obligations"].items():
        for attribute, promise in promises.items():
            value, boundary = promise
            if known[edge_id][attribute] != value:
                out.add((edge_id, boundary))

    policy = built["policy"]
    for node in built["nodes"]:
        entry = AUTHORISED.get(node["transformation"])
        if entry is None or node["id"] in policy[entry[0]]:
            continue
        # Being licensed to open a secret is a statement about the operation. Being allowed to
        # is a statement about who is running it, and the second one is what a repair cannot
        # grant itself.
        out |= {(edge["id"], entry[1]) for edge in outgoing(built, node["id"])}

    for group in policy["distinctDomains"]:
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

    out |= {
        (edge_id, "cost-communication-boundary")
        for edge_id in _crossings(built)[policy["maxCrossings"] :]
    }
    return out


def contract_violations(built: dict) -> tuple[tuple[str, str], ...]:
    """Every `(edge, boundary class)` this architecture breaks, sorted."""
    return tuple(sorted(_violations(built)))


# ---------------------------------------------------------------------------
# where it broke first
# ---------------------------------------------------------------------------


def _flow_order(built: dict) -> tuple[str, ...]:
    seen: list[str] = []
    remaining = {edge["id"]: edge for edge in built["edges"]}
    needed = {node["id"]: len(incoming(built, node["id"])) for node in built["nodes"]}
    arrived = {node["id"]: 0 for node in built["nodes"]}
    produced = {node_id for node_id, count in needed.items() if count == 0}
    while remaining:
        ready = [edge for edge in remaining.values() if edge["source"] in produced]
        if not ready:
            # A cycle, or a wire whose source nothing reaches. Take the lowest id so the answer
            # stays a function of the graph rather than of the order a dict was built in.
            ready = [min(remaining.values(), key=lambda edge: edge["id"])]
        step = min(ready, key=lambda edge: edge["id"])
        seen.append(step["id"])
        del remaining[step["id"]]
        # A node has produced nothing until everything it was waiting for has arrived. A walk
        # that releases a fan-in node on its first input reports the merge as happening before
        # one of the values it merged.
        arrived[step["target"]] += 1
        if arrived[step["target"]] == needed[step["target"]]:
            produced.add(step["target"])
    return tuple(seen)


def first_failure(built: dict) -> str | None:
    """The earliest edge in the flow whose contract is broken, or `None` for a sound graph."""
    broken = {edge for edge, _ in _violations(built)}
    for edge_id in _flow_order(built):
        if edge_id in broken:
            return edge_id
    return None


# ---------------------------------------------------------------------------
# what the primitive is actually vouching for
# ---------------------------------------------------------------------------


def _accepts(built: dict, node_id: str) -> bool:
    allowed = CONSUMES[nodes_by_id(built)[node_id]["transformation"]]
    return all(edge["representation"] in allowed for edge in incoming(built, node_id))


def _local_checks_pass(built: dict) -> bool:
    return all(_accepts(built, node["id"]) for node in built["nodes"])


def _whole(built: dict) -> bool:
    """Every contract holds, and every component can run what it was handed."""
    return not _violations(built) and _local_checks_pass(built)


def underwrites(built: dict) -> dict:
    """Node id -> the end-to-end properties the primitive itself vouches for there.

    Nothing outside `primitive-inside`, and nothing at a node whose own check failed or whose
    incident wires broke a contract. A primitive vouches for what it received and for what it
    produced; anything else it is credited with was credited to it by the reader.
    """
    broken = {edge for edge, _ in _violations(built)}
    out: dict = {}
    for node in built["nodes"]:
        incident = incoming(built, node["id"]) + outgoing(built, node["id"])
        covered = (
            node["layer"] == "primitive-inside"
            and _accepts(built, node["id"])
            and not any(edge["id"] in broken for edge in incident)
        )
        out[node["id"]] = ("correctness", "privacy") if covered else ()
    return out


# ---------------------------------------------------------------------------
# which wire carries which property
# ---------------------------------------------------------------------------


def property_map(built: dict) -> dict:
    """Property -> the edges that property depends on, sorted. All five keys, always."""
    pinned = _required(built)
    out: dict = {name: set() for name in PROPERTIES}
    for edge in built["edges"]:
        classes = {CLASS_OF[attribute] for attribute in pinned[edge["id"]]}
        for promise in built["obligations"].get(edge["id"], {}).values():
            classes.add(promise[1])
        for boundary in classes:
            for name in PROPERTY_OF[boundary]:
                out[name].add(edge["id"])
    return {name: tuple(sorted(edges)) for name, edges in out.items()}


# ---------------------------------------------------------------------------
# one change, in either direction
# ---------------------------------------------------------------------------


def _with_edge(built: dict, edge_id: str, attribute: str, value) -> dict:
    return {
        **built,
        "nodes": tuple(dict(node) for node in built["nodes"]),
        "edges": tuple(
            {**edge, attribute: value} if edge["id"] == edge_id else dict(edge)
            for edge in built["edges"]
        ),
    }


def _with_node(built: dict, node_id: str, attribute: str, value) -> dict:
    return {
        **built,
        "edges": tuple(dict(edge) for edge in built["edges"]),
        "nodes": tuple(
            {**node, attribute: value} if node["id"] == node_id else dict(node)
            for node in built["nodes"]
        ),
    }


def _neighbours(built: dict):
    """Every architecture one allowed change away from this one, in a fixed order."""
    vocabulary = {
        "representation": REPRESENTATIONS,
        "classification": CLASSIFICATIONS,
        "algebra": ALGEBRAS + (None,),
        "keyDomain": KEY_DOMAINS + (None,),
        "identity": tuple(sorted({edge["identity"] for edge in built["edges"]} - {None})) + (None,),
        "serialization": SERIALIZATIONS,
    }
    for edge in built["edges"]:
        for attribute in ATTRIBUTES:
            for value in vocabulary[attribute]:
                if value != edge[attribute]:
                    yield _with_edge(built, edge["id"], attribute, value)
    domains = tuple(sorted({node["domain"] for node in built["nodes"]})) + tuple(
        node["id"] for node in built["nodes"]
    )
    for node in built["nodes"]:
        for value in domains:
            if value != node["domain"]:
                yield _with_node(built, node["id"], "domain", value)
        for value in TRANSFORMATIONS:
            if value != node["transformation"]:
                yield _with_node(built, node["id"], "transformation", value)


def counterexample(built: dict, prop: str) -> dict:
    """One change that keeps every component happy and costs this architecture `prop`.

    A component's own check reads the shape of what arrived and nothing else, so anything that
    leaves the shapes alone leaves every local check passing. That is the whole counterexample:
    the failure is not that some part stopped working, it is that no part was ever looking.
    """
    for candidate in _neighbours(built):
        if not _local_checks_pass(candidate):
            continue
        at_risk = {name for _, boundary in _violations(candidate) for name in PROPERTY_OF[boundary]}
        if prop in at_risk:
            return candidate
    return built


def repair(built: dict) -> dict:
    """The same architecture with the fewest changes that make every contract hold.

    The policy and the obligations are not in the search space, and leaving them out is the
    whole discipline of this function. Authorising the node that opened the secret satisfies the
    contract in one move and is not a repair: it lowers the requirement to meet the deployment,
    which is the deployment writing its own acceptance criteria.

    Whole means two things and not one. Every contract holds, **and** every component can run
    what it was handed -- one of the deployments breaks no boundary at all and still leaves a
    primitive holding a shape it has no way to consume.
    """
    if _whole(built):
        return built
    for candidate in _neighbours(built):
        if _whole(candidate):
            return candidate
    return built


# ---------------------------------------------------------------------------
# choosing a stack for something nobody has built yet
# ---------------------------------------------------------------------------


def select(use_case: dict) -> dict:
    """Which primitives this brief needs, what it publishes, what it trusts, what it spends.

    Three independent questions. None of them excludes another, and the temptation the rule is
    written against is answering with the one primitive that came to mind first.
    """
    chosen = []
    if use_case["checkedByOutsider"]:
        chosen.append("zk")
    if use_case["computedBy"] == "the-parties-themselves" and use_case["holders"] > 1:
        chosen.append("mpc")
    if use_case["computedBy"] == "an-outside-service" and use_case["resultVisibleTo"] != "everyone":
        chosen.append("fhe")
    primitives = tuple(sorted(chosen)) if chosen else ("none",)

    public = set(use_case["publishes"])
    if "zk" in primitives:
        # A proof is a thing that exists and is looked at. Leaving it off the published list is
        # publishing something the design did not admit to publishing.
        public.add("proof")
    trust: set = set()
    for name in primitives:
        trust |= set(TRUST_OF[name])
    return {
        "primitives": primitives,
        "public": tuple(sorted(public)),
        "secret": tuple(sorted(set(use_case["holds"]) - public)),
        "trust": tuple(sorted(trust)),
        # A combination costs what its most expensive member costs. The expensive one does not
        # get cheaper for standing next to something cheap.
        "dominantCost": max((COST_OF[name] for name in primitives), key=COST_ORDER.index),
    }
