"""Three architectures, the contracts on the wires between their parts, and the ways one breaks.

Nothing here is copied from the course's `stack-design` material: no case names, no node names,
no property names, no fixtures, no skeleton. The three architectures are the ones Week 6's
applications already built -- an MPC-backed prover, a zkVM proof of exploit, an FHE evaluation
service -- and everything around them is written out below.

## What is being modelled, and what is deliberately not

No cryptography runs here. Not a share, not a proof, not a ciphertext. What is modelled is the
one thing a working primitive cannot check for you: **whether the wires between the primitives
carry what the next primitive assumed they carry.**

```text
a node   one computation, and where it runs
an edge  one value crossing from one computation to the next, and what it is at that moment
```

Every failure this problem is about lives on an edge. A witness that is private on one side of a
wire and public on the other. A share computed in one field handed to a proof system working in
another. A ciphertext returned under the evaluation key instead of the client's. A journal read
as evidence about a program the guest never ran. Each of those is a *composition* failure: every
component on both sides of the wire is correct, tested, and doing what it was built to do.

## Why the graph is typed rather than drawn

A picture of an architecture shows which box talks to which box. That is not the question. The
question is what the value **is** while it is in flight, and there are five things it has to be
at once:

```text
representation  plaintext, secret share, ciphertext, commitment, proof, journal
classification  public or secret
algebra         which field or modulus the value lives in, when that applies
keyDomain       which key it is under, when that applies
identity        which program or statement it is about, when that applies
```

A boundary contract is a rule about how those five may change across one edge. Most of them may
not change at all. The ones that may -- a key switch changes `keyDomain`, an authorised open
changes `classification`, a lift changes `algebra` -- are exactly the nodes an architecture has
to name out loud, because a change nobody named is a change nobody checked.

## Two levels, not one

`LICENCE` says what a *transformation* may change. `POLICY` says which *nodes* an architecture
authorised to hold that transformation. Both are needed and neither implies the other: a
`declassify` is licensed to turn a secret public, and a `declassify` sitting on a party's own
machine is a reconstruct nobody approved. A contract with only the first level can be satisfied
by relabelling the offending box, which is how a repair moves a failure instead of removing it.

On top of both sits `obligations` -- what this architecture promised to *deliver*, and where. A
licensed change is not a correct change: a key switch is authorised to change the key domain,
and being authorised to change it is not being right about what to change it to.

## The three cases

```text
mpc-prover   a witness split across parties, a relation computed on the shares, one proof out
zkvm-exploit a private exploit witness checked inside a guest, one target-bound journal out
fhe-service  a function evaluated on an encrypted input, one ciphertext back under the client key
```

They are toys of the mechanism, and the claim they support is about **composition**, not about
any real system's security. Nothing here says a particular co-SNARK, zkVM or FHE deployment is
safe.
"""

from __future__ import annotations

import hashlib

# ---------------------------------------------------------------------------
# The supplied half, imported rather than defined here
#
# Issue 537/538 (Issue 543 option B2): the vocabulary a boundary contract is written in lives in
# `participant/lab.py` now, because a learner has to be able to import it and this file does not
# ship in the participant image any more. Importing it back here rather than restating it keeps
# one implementation, graded and inspected, instead of two that can drift -- `participant/lab.py`
# is copied into the `verifier` Docker stage for exactly that reason (see ../Dockerfile).
#
# Everything below this import is the half that does NOT ship: the seed derivation, the three
# architectures, the table of breaks, and every ground-truth function the hidden checker grades
# against.
# ---------------------------------------------------------------------------

from participant.lab import (  # noqa: F401 - re-exported for the hidden checker and show.py
    ALGEBRAS,
    ATTRIBUTES,
    AUTHORISED,
    BOUNDARY_CLASSES,
    CASES,
    CLASS_OF,
    CLASSIFICATIONS,
    COMPUTED_BY,
    CONSUMES,
    COST_OF,
    COST_ORDER,
    COUNTEREXAMPLE_TARGETS,
    EDGE_FIELDS,
    KEY_DOMAINS,
    LAYERS,
    LICENCE,
    NODE_FIELDS,
    PRIMITIVES,
    PROPERTIES,
    PROPERTY_OF,
    REPRESENTATIONS,
    RESULT_VISIBLE,
    SERIALIZATIONS,
    TRANSFORMATIONS,
    TRUST_OF,
    USE_CASE_FIELDS,
    VARIANTS,
    edges_by_id,
    incoming,
    nodes_by_id,
    outgoing,
)


# ---------------------------------------------------------------------------
# Drawing one deployment from a seed
# ---------------------------------------------------------------------------


def _stream(seed: str, label: str) -> list[int]:
    out: list[int] = []
    counter = 0
    while len(out) < 512:
        out.extend(hashlib.sha256(f"{seed}:{label}:{counter}".encode()).digest())
        counter += 1
    return out


def _pick(s: list[int], i: int, choices):
    return choices[(s[i % 500] * 256 + s[(i + 1) % 500]) % len(choices)]


# ---------------------------------------------------------------------------
# Building one node and one edge
# ---------------------------------------------------------------------------


def _node(node_id: str, layer: str, domain: str, transformation: str) -> dict:
    return {
        "id": node_id,
        "layer": layer,
        "domain": domain,
        "transformation": transformation,
    }


def _edge(
    edge_id: str,
    source: str,
    target: str,
    representation: str,
    classification: str,
    algebra=None,
    key_domain=None,
    identity=None,
    serialization="canonical-v1",
) -> dict:
    return {
        "id": edge_id,
        "source": source,
        "target": target,
        "representation": representation,
        "classification": classification,
        "algebra": algebra,
        "keyDomain": key_domain,
        "identity": identity,
        "serialization": serialization,
    }


# ---------------------------------------------------------------------------
# The three architectures
# ---------------------------------------------------------------------------


def _mpc_prover(seed: str) -> dict:
    """A witness split across parties, a relation computed on the shares, one proof out.

    The interesting wire is `e5`: the shares are recombined into a prover input, and `recombine`
    is the only node this architecture authorised to turn a share back into a plaintext.
    Recombining anywhere else is a reconstruct nobody approved, and every party's local
    computation stays correct while it happens.
    """
    s = _stream(seed, "mpc")
    field = _pick(s, 0, ALGEBRAS)
    statement = f"stmt-{hashlib.sha256(f'{seed}:mpc'.encode()).hexdigest()[:8]}"
    nodes = (
        _node("intake", "host-orchestration", "client", "carry"),
        _node("split", "host-orchestration", "client", "split"),
        _node("party-a", "primitive-inside", "party-a", "carry"),
        _node("party-b", "primitive-inside", "party-b", "carry"),
        _node("triple", "primitive-inside", "preprocessing", "carry"),
        _node("recombine", "primitive-above", "prover", "combine"),
        _node("prove", "primitive-above", "prover", "prove"),
        _node("publish", "host-orchestration", "prover", "declassify"),
        _node("artifact", "host-orchestration", "public", "carry"),
    )
    edges = (
        _edge("intake", "intake", "split", "plaintext", "secret", algebra=field),
        _edge("share-a", "split", "party-a", "secret-share", "secret", algebra=field),
        _edge("share-b", "split", "party-b", "secret-share", "secret", algebra=field),
        _edge("triple-a", "triple", "party-a", "secret-share", "secret", algebra=field),
        _edge("partial-a", "party-a", "recombine", "secret-share", "secret", algebra=field),
        _edge("partial-b", "party-b", "recombine", "secret-share", "secret", algebra=field),
        _edge("prover-in", "recombine", "prove", "plaintext", "secret", algebra=field),
        _edge("sealed", "prove", "publish", "proof", "secret", algebra=field, identity=statement),
        _edge("published", "publish", "artifact", "proof", "public", algebra=field, identity=statement),
    )
    policy = {
        "mayDeclassify": ("publish",),
        "mayCombine": ("recombine",),
        "mayKeySwitch": (),
        "mayLift": (),
        # The two parties and the source of the preprocessing material are three trust domains.
        # Two of them in one domain is not a smaller deployment, it is a reconstruct.
        "distinctDomains": (("party-a", "party-b", "triple"),),
        "maxCrossings": 6,
    }
    obligations = {
        # A triple that has a name is a triple somebody else can name. Preprocessing material is
        # drawn for one run and belongs to no run after it.
        "triple-a": {"identity": (None, "randomness-preprocessing-lifetime")},
        "sealed": {"identity": (statement, "statement-witness-binding")},
        "published": {
            "identity": (statement, "statement-witness-binding"),
            "classification": ("public", "artifact-publication"),
        },
    }
    return {
        "caseId": "mpc-prover",
        "nodes": nodes,
        "edges": edges,
        "policy": policy,
        "obligations": obligations,
    }


def _zkvm_exploit(seed: str) -> dict:
    """A private exploit witness checked inside a guest, one target-bound journal out.

    The interesting wire is `e6`: the journal leaves the guest carrying the identity it was sealed
    under, and the verifier reads it as evidence about exactly that identity. An identity that
    changes on the way out is a valid proof about something nobody asked about.
    """
    s = _stream(seed, "zkvm")
    field = _pick(s, 4, ALGEBRAS)
    program = f"img-{hashlib.sha256(f'{seed}:zkvm'.encode()).hexdigest()[:8]}"
    nodes = (
        _node("statement", "host-orchestration", "verifier", "carry"),
        _node("witness", "host-orchestration", "prover", "carry"),
        _node("ingest", "host-orchestration", "prover", "carry"),
        _node("guest", "primitive-inside", "guest", "carry"),
        _node("seal", "primitive-above", "guest", "seal"),
        _node("verify", "primitive-above", "verifier", "carry"),
        _node("publish", "host-orchestration", "verifier", "declassify"),
        _node("artifact", "host-orchestration", "public", "carry"),
    )
    edges = (
        _edge("statement", "statement", "ingest", "plaintext", "public", algebra=field, identity=program),
        _edge("witness", "witness", "ingest", "plaintext", "secret", algebra=field),
        _edge("guest-in", "ingest", "guest", "plaintext", "secret", algebra=field, identity=program),
        _edge("guest-out", "guest", "seal", "plaintext", "secret", algebra=field, identity=program),
        _edge("receipt", "seal", "verify", "journal", "secret", algebra=field, identity=program),
        _edge("checked", "verify", "publish", "journal", "secret", algebra=field, identity=program),
        _edge("published", "publish", "artifact", "journal", "public", algebra=field, identity=program),
    )
    policy = {
        "mayDeclassify": ("publish",),
        "mayCombine": (),
        "mayKeySwitch": (),
        "mayLift": (),
        # The party being proved about and the party checking the proof are not one trust domain.
        "distinctDomains": (("witness", "statement"),),
        "maxCrossings": 4,
    }
    obligations = {
        "receipt": {"identity": (program, "statement-witness-binding")},
        "published": {
            "identity": (program, "program-version-identity"),
            "classification": ("public", "artifact-publication"),
        },
    }
    return {
        "caseId": "zkvm-exploit",
        "nodes": nodes,
        "edges": edges,
        "policy": policy,
        "obligations": obligations,
    }


def _fhe_service(seed: str) -> dict:
    """A function evaluated on an encrypted input, one ciphertext back under the client key.

    The interesting wire is `e6`: the result comes home, and it has to come home under
    `key-client`. Both key switches on the way are licensed and both are authorised -- and a
    licensed change is not a correct change. The server's evaluation is right either way, the
    ciphertext looks the same either way, and the client finds out by not being able to decrypt
    it, or, worse, by being handed something the server can.
    """
    s = _stream(seed, "fhe")
    field = _pick(s, 8, ALGEBRAS)
    nodes = (
        _node("client", "host-orchestration", "client", "carry"),
        _node("encrypt", "host-orchestration", "client", "encrypt"),
        _node("evaluate", "primitive-inside", "server", "carry"),
        _node("bootstrap", "primitive-inside", "server", "key-switch"),
        _node("switch", "primitive-inside", "server", "key-switch"),
        _node("return", "host-orchestration", "server", "carry"),
        _node("decrypt", "host-orchestration", "client", "decrypt"),
        _node("consume", "host-orchestration", "client", "carry"),
    )
    edges = (
        _edge("cleartext", "client", "encrypt", "plaintext", "secret", algebra=field),
        _edge(
            "request", "encrypt", "evaluate", "ciphertext", "secret",
            algebra=field, key_domain="key-client",
        ),
        _edge(
            "evaluated", "evaluate", "bootstrap", "ciphertext", "secret",
            algebra=field, key_domain="key-client",
        ),
        _edge(
            "bootstrapped", "bootstrap", "switch", "ciphertext", "secret",
            algebra=field, key_domain="key-boot",
        ),
        _edge(
            "switched", "switch", "return", "ciphertext", "secret",
            algebra=field, key_domain="key-client",
        ),
        _edge(
            "response", "return", "decrypt", "ciphertext", "secret",
            algebra=field, key_domain="key-client",
        ),
        _edge("result", "decrypt", "consume", "plaintext", "secret", algebra=field),
    )
    policy = {
        "mayDeclassify": (),
        "mayCombine": (),
        # Bootstrapping leaves the ciphertext under the key it bootstrapped with; the switch
        # after it is what brings the result home. Both are the server's, and both are named.
        "mayKeySwitch": ("bootstrap", "switch"),
        "mayLift": (),
        "distinctDomains": (("client", "evaluate"),),
        "maxCrossings": 2,
    }
    obligations = {
        "response": {"keyDomain": ("key-client", "key-ciphertext-domain")},
        # An FHE result is not an artifact. The client asked a question it did not want asked in
        # public, and answering it in public answers a different question.
        "result": {"classification": ("secret", "artifact-publication")},
    }
    return {
        "caseId": "fhe-service",
        "nodes": nodes,
        "edges": edges,
        "policy": policy,
        "obligations": obligations,
    }


_BUILDERS = {
    "mpc-prover": _mpc_prover,
    "zkvm-exploit": _zkvm_exploit,
    "fhe-service": _fhe_service,
}


def graph(seed: str, case_id: str) -> dict:
    """The sound architecture for one case, drawn from the seed.

    Sound means every boundary contract holds, which is not the same as "the system is secure"
    and is not claimed to be. It is the baseline the broken variants below are one change away
    from.
    """
    if case_id not in _BUILDERS:
        raise ValueError(f"{case_id!r} is not one of {CASES}")
    return _BUILDERS[case_id](seed)


# ---------------------------------------------------------------------------
# Ground truth: what a boundary contract actually says
#
# Everything from here down exists so a hidden checker can tell a right answer from a
# convincing one. The hidden checker imports this; a submission module must not.
# ---------------------------------------------------------------------------


def _expected(arrivals: tuple, attribute: str):
    """What an unlicensed node must put on its outgoing edge, given everything that arrived.

    Fan-in is where this stops being a table lookup. A node with two inputs does not transform a
    value, it **merges** two, and merging has its own rule per attribute:

    ```text
    classification  secret wins. One secret input makes the output secret, because the output
                    is a function of it and a function of a secret is a secret
    identity        an identity may be carried forward but not invented: the output may name an
                    identity some input named, and otherwise names none
    the rest        every input that carries one has to agree, and the output is that value
    ```

    The `zkvm-exploit` case is the one that makes this concrete: a public statement and a secret
    witness meet at one node, and the value that leaves is secret and is about the statement.
    A contract that compared the output against each input separately would call that edge two
    violations, which is a model that cannot express the architecture it is modelling.
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


def constrained(built: dict) -> dict:
    """Edge id -> the attributes that edge is not free to choose, and what they have to be.

    This is the typed data-flow itself: the premises are whatever the source nodes declare, and
    everything downstream of them is pinned by what arrived plus what the node in between was
    licensed to change. An attribute a node **is** licensed to change is not listed, because the
    contract has nothing to say about it -- that is the whole meaning of licensing it.

    Read from the declared upstream values rather than from a recomputed ideal, so a graph that
    broke once is not reported as broken everywhere downstream of the break.
    """
    out: dict = {}
    for node in built["nodes"]:
        arrivals = incoming(built, node["id"])
        for after in outgoing(built, node["id"]):
            required = {}
            if arrivals:
                # A source node invents its output rather than transforming one, so there is no
                # before to compare against. What it is allowed to invent is the architecture's
                # premise rather than one of its edges.
                for attribute in ATTRIBUTES:
                    if node["transformation"] in LICENCE[attribute]:
                        continue
                    required[attribute] = _expected(arrivals, attribute)
            out[after["id"]] = required
    return out


def _licence_violations(built: dict) -> set:
    """Every change a node made that its transformation was not licensed to make."""
    out = set()
    required = constrained(built)
    for edge in built["edges"]:
        for attribute, want in required[edge["id"]].items():
            got = edge[attribute]
            if isinstance(want, frozenset):
                # More than one value arrived carrying this attribute. Carrying either one
                # forward is honest; inventing a third is not, and neither is silently picking
                # one for an attribute where the inputs were supposed to agree.
                ok = got in want if attribute == "identity" else False
            else:
                ok = got == want
            if not ok:
                out.add((edge["id"], CLASS_OF[attribute]))
    return out


def _obligation_violations(built: dict) -> set:
    """Every promise this architecture made about what it delivers, and did not keep."""
    out = set()
    known = edges_by_id(built)
    for edge_id, required in built["obligations"].items():
        edge = known[edge_id]
        for attribute, (value, boundary) in required.items():
            if edge[attribute] != value:
                out.add((edge_id, boundary))
    return out


def _authorisation_violations(built: dict) -> set:
    """Every node holding a transformation this architecture never authorised it to hold.

    Reported against everything that leaves the node, because everything that leaves it was
    produced by an operation nobody approved.
    """
    out = set()
    policy = built["policy"]
    for node in built["nodes"]:
        entry = AUTHORISED.get(node["transformation"])
        if entry is None:
            continue
        key, boundary = entry
        if node["id"] in policy[key]:
            continue
        for edge in outgoing(built, node["id"]):
            out.add((edge["id"], boundary))
    return out


def _trust_violations(built: dict) -> set:
    """Every pair of nodes an architecture kept apart that a deployment put together."""
    out = set()
    known = nodes_by_id(built)
    for group in built["policy"]["distinctDomains"]:
        seen: dict = {}
        for node_id in group:
            domain = known[node_id]["domain"]
            if domain in seen:
                for offender in (seen[domain], node_id):
                    for edge in outgoing(built, offender):
                        out.add((edge["id"], "trust-collusion-assumption"))
            else:
                seen[domain] = node_id
    return out


def crossings(built: dict) -> tuple[str, ...]:
    """The edges that leave one trust domain and arrive in another, in id order.

    Every one of them is a message somebody has to send, so the count is the architecture's
    communication cost as well as its trust surface. Moving one computation to another machine
    changes both at once, which is why it is one boundary class rather than two.
    """
    known = nodes_by_id(built)
    return tuple(
        sorted(
            edge["id"]
            for edge in built["edges"]
            if known[edge["source"]]["domain"] != known[edge["target"]]["domain"]
        )
    )


def _cost_violations(built: dict) -> set:
    over = crossings(built)[built["policy"]["maxCrossings"] :]
    return {(edge_id, "cost-communication-boundary") for edge_id in over}


def violations(built: dict) -> tuple[tuple[str, str], ...]:
    """Every `(edge, boundary class)` this architecture breaks, sorted.

    An edge is named rather than a node, because a contract is a statement about a value in
    flight: the node is where it happened and the edge is what it happened to.

    Five things can be broken and they are not the same kind of thing. A licence violation is a
    node changing what it was not licensed to change. An obligation is a promise about what
    arrives somewhere. An authorisation is a node holding an operation nobody approved for it.
    A trust violation is two domains that were supposed to stay apart. A cost violation is a
    deployment that sends more messages than the architecture budgeted for.
    """
    return tuple(
        sorted(
            _licence_violations(built)
            | _obligation_violations(built)
            | _authorisation_violations(built)
            | _trust_violations(built)
            | _cost_violations(built)
        )
    )


def _order(built: dict) -> tuple[str, ...]:
    """The edges in the order the value reaches them, so "first" means something.

    A stack fails once and then keeps failing. Reporting the fifth symptom is reporting the
    place a repair does nothing, which is why the first broken boundary is its own checkpoint.
    """
    seen: list[str] = []
    remaining = {edge["id"]: edge for edge in built["edges"]}
    needed = {node["id"]: len(incoming(built, node["id"])) for node in built["nodes"]}
    arrived = {node["id"]: 0 for node in built["nodes"]}
    produced = {node_id for node_id, count in needed.items() if count == 0}
    while remaining:
        ready = [edge for edge in remaining.values() if edge["source"] in produced]
        if not ready:
            ready = [min(remaining.values(), key=lambda edge: edge["id"])]
        step = min(ready, key=lambda edge: edge["id"])
        seen.append(step["id"])
        del remaining[step["id"]]
        # A node has produced nothing until **everything** it was waiting for has arrived. A
        # walk that releases a fan-in node on its first input reports a merge as happening
        # before one of the values it merged, which is exactly the ordering this is here to get
        # right.
        arrived[step["target"]] += 1
        if arrived[step["target"]] == needed[step["target"]]:
            produced.add(step["target"])
    return tuple(seen)


def first_broken(built: dict) -> str | None:
    """The earliest edge in the flow whose contract is broken, or `None` for a sound graph."""
    broken_edges = {edge for edge, _ in violations(built)}
    for edge_id in _order(built):
        if edge_id in broken_edges:
            return edge_id
    return None


# ---------------------------------------------------------------------------
# Ground truth: local checks, and what a primitive is actually vouching for
# ---------------------------------------------------------------------------


def accepts(built: dict, node_id: str) -> bool:
    """Whether every value arriving at this node is a shape its transformation can consume.

    This is the whole of a component's own test, and it is the reason this problem exists. A
    primitive validates what it was handed the only way it can -- by shape -- and every other
    attribute travels through it unread. Classification, key domain, identity and dialect are
    all invisible here, so an architecture can have every local check passing and no end-to-end
    property left.
    """
    node = nodes_by_id(built)[node_id]
    allowed = CONSUMES[node["transformation"]]
    return all(edge["representation"] in allowed for edge in incoming(built, node_id))


def local_checks_pass(built: dict) -> bool:
    """Whether every component in this architecture is content with what it was handed."""
    return all(accepts(built, node["id"]) for node in built["nodes"])


def underwritten(built: dict) -> dict:
    """Node id -> the end-to-end properties the primitive itself vouches for there.

    A primitive underwrites `correctness` and `privacy` for the computation it runs **inside**
    itself, and only while its own assumptions were met. Two things void it:

    ```text
    the node was handed a shape it cannot consume     its own local check failed
    a contract broke on a value it took in or gave    it vouches for what it received and for
    out                                               what it produced, and for nothing else
    ```

    Everywhere else the answer is nothing at all. Application code sitting on top of a primitive
    is covered by the primitive the way a bank vault covers what you carry out of the building.
    This function is the sentence "primitive assumptions are not silently promoted to end-to-end
    guarantees", written so a machine can check it.
    """
    broken_edges = {edge for edge, _ in violations(built)}
    out: dict = {}
    for node in built["nodes"]:
        incident = incoming(built, node["id"]) + outgoing(built, node["id"])
        covered = (
            node["layer"] == "primitive-inside"
            and accepts(built, node["id"])
            and not any(edge["id"] in broken_edges for edge in incident)
        )
        out[node["id"]] = ("correctness", "privacy") if covered else ()
    return out


# ---------------------------------------------------------------------------
# Ground truth: which component carries which end-to-end property
# ---------------------------------------------------------------------------

#: Which boundary classes, when broken, cost which end-to-end property. One class can cost two,
def properties_at_risk(built: dict) -> tuple[str, ...]:
    """Every end-to-end property this architecture no longer has, sorted."""
    out: set = set()
    for _, boundary in violations(built):
        out |= set(PROPERTY_OF[boundary])
    return tuple(sorted(out))


def classes_at(built: dict) -> dict:
    """Edge id -> the boundary classes that edge is able to break, sorted.

    Two things take an attribute off an edge's list:

    ```text
    the node is licensed to change it   the contract has nothing to say about it there
    nothing upstream constrained it     a source edge is the architecture's premise, not one
                                        of its claims
    ```

    A third rule suggests itself and is deliberately **not** here: skipping an attribute whose
    value is absent on both sides, on the grounds that a contract about an attribute the value
    does not carry is not a contract. It reads well and it changes no answer -- an edge with an
    absent key domain is always an edge that already carries `key-ciphertext-domain`'s two
    properties through some other class -- so it would be a rule nobody could ever observe being
    followed. A model keeps the rules that decide something.

    Deliberately restricted to what an **edge** can break. Two of the eleven classes are not
    properties of any one wire: a trust domain and a communication budget are statements about
    where the computation sits, and moving a computation is not a change to a value in flight.
    """
    required = constrained(built)
    out: dict = {}
    for edge in built["edges"]:
        found = {CLASS_OF[attribute] for attribute in required[edge["id"]]}
        for _, boundary in built["obligations"].get(edge["id"], {}).values():
            found.add(boundary)
        out[edge["id"]] = tuple(sorted(found))
    return out


def load_bearing(built: dict) -> dict:
    """Property -> the edges that property depends on, sorted. The property-to-component map.

    An edge carries a property when some class it is able to break costs that property. Every
    one of the five is a key, including the ones no edge carries: `availability` is not a
    property of any wire in these three architectures, it is a property of where the computation
    was put, and an answer that finds something for every property has not read the tables.
    """
    exposure = classes_at(built)
    out: dict = {name: set() for name in PROPERTIES}
    for edge_id, found in exposure.items():
        for boundary in found:
            for name in PROPERTY_OF[boundary]:
                out[name].add(edge_id)
    return {name: tuple(sorted(edges)) for name, edges in out.items()}


# ---------------------------------------------------------------------------
# Breaking one on purpose
# ---------------------------------------------------------------------------


def _replace_edge(built: dict, edge_id: str, attribute: str, value) -> dict:
    edges = tuple(
        {**edge, attribute: value} if edge["id"] == edge_id else dict(edge)
        for edge in built["edges"]
    )
    return {**built, "edges": edges, "nodes": tuple(dict(node) for node in built["nodes"])}


def _replace_node(built: dict, node_id: str, attribute: str, value) -> dict:
    nodes = tuple(
        {**node, attribute: value} if node["id"] == node_id else dict(node)
        for node in built["nodes"]
    )
    return {**built, "nodes": nodes, "edges": tuple(dict(edge) for edge in built["edges"])}


def _other(choices: tuple, current) -> str:
    return next(value for value in choices if value != current)


#: One break per boundary class, and one change each. The name says what somebody did, not what
#: it cost -- naming a break after its consequence is how a diagnosis gets skipped.
BREAKS = {
    "a-share-is-opened-inside-a-party": ("mpc-prover", "edge", "partial-a", "representation"),
    "the-witness-goes-public-on-the-way-in": ("zkvm-exploit", "edge", "guest-in", "classification"),
    "one-party-works-in-another-field": ("mpc-prover", "edge", "partial-b", "algebra"),
    "the-result-comes-home-under-the-wrong-key": ("fhe-service", "edge", "response", "keyDomain"),
    "the-journal-is-about-another-program": ("zkvm-exploit", "edge", "checked", "identity"),
    "the-proof-is-framed-in-another-dialect": ("mpc-prover", "edge", "published", "serialization"),
    "the-proof-names-no-statement": ("mpc-prover", "edge", "sealed", "identity"),
    "the-artifact-is-never-published": ("mpc-prover", "edge", "published", "classification"),
    "the-triple-has-a-name": ("mpc-prover", "edge", "triple-a", "identity"),
    "two-parties-share-one-trust-domain": ("mpc-prover", "node", "party-b", "domain"),
    "the-bootstrap-moves-to-the-client": ("fhe-service", "node", "bootstrap", "domain"),
    "a-party-opens-its-own-share": ("mpc-prover", "node", "party-a", "transformation"),
    # The one that breaks no contract at all. Every boundary holds and a component cannot run
    # what it was handed, which is the shortest statement of why a contract is not a design
    # review.
    "a-party-cannot-run-what-it-was-handed": ("mpc-prover", "node", "party-b", "transformation"),
}

# `VARIANTS` is the participant-visible half of this table -- the names, which `make inspect` has
# always printed -- so it is defined in `participant/lab.py` and imported above. What each name
# breaks is not, and the pairing is pinned here rather than derived so that adding a variant on
# one side and forgetting the other fails at import rather than at grading time.
assert tuple(BREAKS) == VARIANTS, "BREAKS and participant.lab.VARIANTS have drifted apart"

#: What each node-level break moves its target to. Written out rather than derived, because the
#: interesting thing about each of these is which specific place it ended up in.
_MOVED = {
    # Folded into the other party's trust domain: two shares, one machine, no secret.
    "two-parties-share-one-trust-domain": "party-a",
    # A computation moved to the other side of the wire. Nothing about the values changes, and
    # four messages now cross a boundary where the architecture budgeted for two.
    "the-bootstrap-moves-to-the-client": "client",
    # A party that reconstructs. Licensed operation, unapproved node.
    "a-party-opens-its-own-share": "combine",
    # A party that decrypts, handed shares. Nothing it does is unlicensed and nothing it was
    # promised is unkept; it simply cannot run.
    "a-party-cannot-run-what-it-was-handed": "decrypt",
}


def _break_value(built: dict, target: str, attribute: str):
    """What one attribute of one edge becomes when somebody gets it wrong.

    Always some other member of that attribute's own vocabulary, never a value the model has
    never heard of. A break that hands a wire an unrecognised word is caught by reading the
    word, and reading the word is not the skill.
    """
    current = edges_by_id(built)[target][attribute]
    if attribute == "representation":
        return "plaintext"
    if attribute == "identity":
        # Dropping the identity a proof was made about. Inventing one where none belonged is the
        # separate `the-triple-has-a-name` variant, which needs a value drawn from the seed.
        return None
    return _other(
        {
            "classification": CLASSIFICATIONS,
            "algebra": ALGEBRAS,
            "keyDomain": KEY_DOMAINS,
            "serialization": SERIALIZATIONS,
        }[attribute],
        current,
    )


def broken(seed: str, variant: str) -> dict:
    """One architecture with exactly one thing wrong with it.

    Every variant changes a single attribute of a single edge, or a single node's trust domain
    or transformation. Nothing is ever broken in two places at once, so "the first boundary that
    broke" is a question with an answer and a repair has somewhere to be minimal against.
    """
    if variant not in BREAKS:
        raise ValueError(f"{variant!r} is not one of {VARIANTS}")
    case_id, kind, target, attribute = BREAKS[variant]
    built = graph(seed, case_id)
    if variant == "the-triple-has-a-name":
        value = f"triple-{hashlib.sha256(f'{seed}:triple'.encode()).hexdigest()[:8]}"
        return _replace_edge(built, target, attribute, value)
    if kind == "node":
        return _replace_node(built, target, attribute, _MOVED[variant])
    return _replace_edge(built, target, attribute, _break_value(built, target, attribute))


def break_truth(seed: str) -> dict:
    """Variant name -> everything a diagnosis of it has to get right."""
    out: dict = {}
    for variant in VARIANTS:
        built = broken(seed, variant)
        out[variant] = {
            "caseId": built["caseId"],
            "violations": violations(built),
            "firstBroken": first_broken(built),
            "properties": properties_at_risk(built),
        }
    return out


# ---------------------------------------------------------------------------
# Repairing one, and breaking one without breaking a component
# ---------------------------------------------------------------------------


def _frozen(value):
    """Sequences as tuples, all the way down, so a round-tripped graph still compares equal.

    An architecture that came back through JSON has lists where this file wrote tuples, and it
    is the same architecture. Refusing it would be grading a serialization dialect, which is a
    different problem and one this problem happens to be about.
    """
    if isinstance(value, dict):
        return {key: _frozen(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return tuple(_frozen(item) for item in value)
    return value


def changes(before: dict, after: dict) -> tuple[tuple[str, str, str], ...]:
    """Every `(kind, id, attribute)` two architectures disagree about, sorted.

    The unit a repair is measured in and the unit a counterexample is allowed one of. Adding or
    removing a node or an edge is not a change to an architecture, it is a different
    architecture, and is reported as `("shape", "", "")` so a caller can refuse it.
    """
    if [edge["id"] for edge in before["edges"]] != [edge["id"] for edge in after["edges"]]:
        return (("shape", "", ""),)
    if [node["id"] for node in before["nodes"]] != [node["id"] for node in after["nodes"]]:
        return (("shape", "", ""),)
    out: list = []
    for old, new in zip(before["edges"], after["edges"], strict=True):
        if (old["source"], old["target"]) != (new["source"], new["target"]):
            return (("shape", "", ""),)
        out.extend(
            ("edge", old["id"], attribute)
            for attribute in ATTRIBUTES
            if old[attribute] != new[attribute]
        )
    for old, new in zip(before["nodes"], after["nodes"], strict=True):
        if old["layer"] != new["layer"]:
            out.append(("node", old["id"], "layer"))
        out.extend(
            ("node", old["id"], attribute)
            for attribute in ("domain", "transformation")
            if old[attribute] != new[attribute]
        )
    return tuple(sorted(out))


def preserved(before: dict, after: dict) -> bool:
    """Whether the second architecture is still the first one's architecture.

    Same nodes, same wires between them, same policy, same promises. A repair that edits the
    policy has not repaired the deployment, it has lowered the requirement -- and a repair that
    edits the obligations has answered a question nobody asked.
    """
    if changes(before, after) == (("shape", "", ""),):
        return False
    if after.get("caseId") != before.get("caseId"):
        return False
    if _frozen(after.get("policy")) != _frozen(before.get("policy")):
        return False
    return _frozen(after.get("obligations")) == _frozen(before.get("obligations"))


def _whole(built: dict) -> bool:
    """Whether every contract holds **and** every component can run what it was handed.

    Two conditions rather than one, because they are two. A contract is a statement about the
    values in flight, and one of the variants breaks none of them while leaving a primitive
    holding a shape it has no way to consume. An architecture where every boundary holds and
    something cannot run is not repaired, and calling it repaired is how a contract becomes a
    substitute for a design review instead of a part of one.
    """
    return not violations(built) and local_checks_pass(built)


def repair_cost(built: dict) -> int:
    """The fewest changes that put this architecture back together, or 0 when it already is.

    Every variant is one change from a whole graph, so reverting it is always available. The
    search below is over the same one-change space a repair is allowed, which is what makes the
    number a minimum rather than an anecdote.
    """
    if _whole(built):
        return 0
    for candidate in _one_change_neighbours(built):
        if _whole(candidate):
            return 1
    return 2


def _one_change_neighbours(built: dict):
    """Every architecture one allowed change away from this one."""
    edge_values = {
        "representation": REPRESENTATIONS,
        "classification": CLASSIFICATIONS,
        "algebra": ALGEBRAS + (None,),
        "keyDomain": KEY_DOMAINS + (None,),
        "serialization": SERIALIZATIONS,
    }
    identities = {edge["identity"] for edge in built["edges"]} | {None}
    # Every domain the deployment already uses, plus one of its own for each node. A node that
    # was folded into somebody else's trust domain has to be able to get back out of it, and the
    # domain it came from is not on the graph any more once it left.
    domains = {node["domain"] for node in built["nodes"]} | {
        node["id"] for node in built["nodes"]
    }
    for edge in built["edges"]:
        for attribute, choices in edge_values.items():
            for value in choices:
                if value != edge[attribute]:
                    yield _replace_edge(built, edge["id"], attribute, value)
        for value in identities:
            if value != edge["identity"]:
                yield _replace_edge(built, edge["id"], "identity", value)
    for node in built["nodes"]:
        for value in domains:
            if value != node["domain"]:
                yield _replace_node(built, node["id"], "domain", value)
        for value in TRANSFORMATIONS:
            if value != node["transformation"]:
                yield _replace_node(built, node["id"], "transformation", value)


#: Which case is asked for a counterexample against which property. `availability` is not on the
#: list, and cannot be: no change to a value in flight costs it. That is a fact about these
#: architectures rather than a gap in the fixtures, and it is the answer to the property map's
#: fifth key.
COUNTEREXAMPLE_TARGETS = (
    ("mpc-prover", "privacy"),
    ("mpc-prover", "soundness"),
    ("zkvm-exploit", "binding"),
    ("zkvm-exploit", "privacy"),
    ("fhe-service", "correctness"),
)


def counterexample_exists(built: dict, prop: str) -> bool:
    """Whether some one-change architecture keeps every local check and loses this property."""
    return any(
        local_checks_pass(candidate) and prop in properties_at_risk(candidate)
        for candidate in _one_change_neighbours(built)
    )


# ---------------------------------------------------------------------------
# Choosing a stack for something nobody has built yet
# ---------------------------------------------------------------------------

#: The shape of a use case: who holds the inputs, who does the computing, whether an outsider has
#: to be convinced, and who is allowed to see the answer. Everything else is decoration.
USE_CASE_FIELDS = ("id", "holders", "computedBy", "checkedByOutsider", "resultVisibleTo",
                   "publishes", "holds")

COMPUTED_BY = ("the-input-holder", "the-parties-themselves", "an-outside-service")
RESULT_VISIBLE = ("everyone", "the-input-holder", "the-parties")

PRIMITIVES = ("fhe", "mpc", "zk")

#: What each primitive requires the world to be like before its guarantee means anything. This is
#: the assumption to attack, which is why it is written down next to the choice rather than under
#: it.
TRUST_OF = {
    "zk": ("the-proof-system-is-sound",),
    "mpc": ("no-coalition-above-the-threshold-colludes",),
    "fhe": ("only-the-key-holder-decrypts",),
    "none": ("the-computing-party-is-trusted-with-the-inputs",),
}

#: What each primitive spends. Named rather than measured: the point of the checkpoint is that a
#: design says which resource it is buying with, not how many milliseconds it costs.
COST_OF = {
    "zk": "proving-time",
    "mpc": "communication-rounds",
    "fhe": "ciphertext-expansion",
    "none": "plain-computation",
}

#: Cheapest first. A combination costs whatever its most expensive member costs, because the
#: expensive one does not get cheaper for being next to something else.
COST_ORDER = ("plain-computation", "communication-rounds", "proving-time", "ciphertext-expansion")

#: The names a use case can be about. Deliberately ordinary: what makes the checkpoint hard is
#: which of them the design has to keep, not what they mean.
SUBJECTS = ("bid", "balance", "salary", "position", "score", "reserve", "threshold", "outcome")

#: One brief per shape, so every branch of the selection rule is exercised on every seed and
#: none of them can rot into an untested row. The last two are the branches that are easiest to
#: leave out of a rule and hardest to notice missing: a lone holder "computing between
#: themselves" is one party computing, and an outside service that may see the answer is an
#: outside service nobody needs to hide the answer from. The order they are handed over moves
#: with the seed.
_SHAPES = (
    (False, "the-input-holder", "everyone", 1),
    (True, "the-input-holder", "everyone", 1),
    (False, "the-parties-themselves", "the-parties", 0),
    (False, "an-outside-service", "the-input-holder", 1),
    (True, "the-parties-themselves", "the-parties", 0),
    (True, "an-outside-service", "the-input-holder", 1),
    (False, "the-parties-themselves", "the-parties", 1),
    (False, "an-outside-service", "everyone", 1),
)


def use_cases(seed: str) -> tuple[dict, ...]:
    """Eight briefs, one per shape the selection rule can be handed."""
    s = _stream(seed, "usecase")
    built = []
    for index, (checked, computed_by, visible, holders) in enumerate(_SHAPES):
        offset = index * 7
        subjects = list(SUBJECTS)
        first = subjects.pop((s[offset] * 256 + s[offset + 1]) % len(subjects))
        second = subjects.pop((s[offset + 2] * 256 + s[offset + 3]) % len(subjects))
        third = subjects.pop((s[offset + 4] * 256 + s[offset + 5]) % len(subjects))
        built.append(
            {
                "id": f"uc-{hashlib.sha256(f'{seed}:{index}'.encode()).hexdigest()[:6]}",
                "holders": holders or 2 + s[offset + 6] % 3,
                "computedBy": computed_by,
                "checkedByOutsider": checked,
                "resultVisibleTo": visible,
                # What a brief publishes is also something it holds. A design that copies the
                # two lists across has kept the thing it just published.
                "publishes": (first,),
                "holds": tuple(sorted((first, second, third))),
            }
        )
    order = sorted(range(len(built)), key=lambda i: hashlib.sha256(f"{seed}:o{i}".encode()).digest())
    return tuple(built[i] for i in order)


def selection_truth(use_case: dict) -> dict:
    """The design the rule prescribes for one brief.

    Three questions, asked in the order the answer depends on them, and nothing about what the
    computation is:

    ```text
    does somebody outside have to be convinced without seeing the inputs   -> zk
    do several holders compute it between themselves                       -> mpc
    does an outside service compute it and not get to see the answer       -> fhe
    ```

    None of the three is exclusive. Two can be true at once, and a design that answers with one
    name where two apply has dropped a requirement rather than chosen between them.
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
        # A proof is a thing that exists and is looked at. A design that does not list it has
        # published something it did not mean to publish.
        public.add("proof")
    trust: set = set()
    for name in primitives:
        trust |= set(TRUST_OF[name])
    return {
        "primitives": primitives,
        "public": tuple(sorted(public)),
        "secret": tuple(sorted(set(use_case["holds"]) - public)),
        "trust": tuple(sorted(trust)),
        "dominantCost": max((COST_OF[name] for name in primitives), key=COST_ORDER.index),
    }


def health_token(seed: str) -> str:
    joined = "|".join(f"{case}:{len(graph(seed, case)['edges'])}" for case in CASES)
    return hashlib.sha256(f"health:{seed}:{joined}".encode()).hexdigest()[:16]


# ---------------------------------------------------------------------------
# What a participant may see for this deployment
# ---------------------------------------------------------------------------


def _wire_graph(built: dict) -> dict:
    """One architecture as JSON: the same nodes, edges, policy and obligations, as plain data.

    `show.py` turns it back into the dict shape the starter is written against (see
    `show.architecture`). Nothing is dropped and nothing is added -- the round trip is pinned by
    `tests/public/test_stack.py` and by `scripts/ac26-w6-stack-design.test.ts`.
    """
    return {
        "caseId": built["caseId"],
        "nodes": [dict(node) for node in built["nodes"]],
        "edges": [dict(edge) for edge in built["edges"]],
        "policy": {
            key: (
                value
                if isinstance(value, int)
                else [list(group) for group in value]
                if key == "distinctDomains"
                else list(value)
            )
            for key, value in built["policy"].items()
        },
        "obligations": {
            edge_id: {
                attribute: [value, boundary]
                for attribute, (value, boundary) in promises.items()
            }
            for edge_id, promises in built["obligations"].items()
        },
    }


def public_payload(seed: str) -> dict:
    """Everything a participant may see for this deployment. Carries data, not code.

    Exactly what `make inspect` has always printed and what the starter's own import list has
    always handed over: the three sound architectures, the thirteen deployments to diagnose, and
    the eight briefs. The public tests hand the sound `mpc-prover` graph and the briefs straight
    to the learner's own functions as their arguments, so a submission holds them at runtime by
    construction; withholding them here would hide them from `show.py` and from nobody else (the
    same reading as ac26-w2-private-aggregate's shares).

    The broken architectures travel for the same reason. Diagnosing them **is** the exercise, and
    `starter/stack.py` has always named `broken(seed, variant)` as something a learner is given.
    What does not travel is the rule that made them: `BREAKS` names, per variant, which node or
    edge was changed and which attribute -- identically on every seed -- so it answers `contracts`
    and `diagnosis` on the hidden labels as well as on this one. `_MOVED` and `_break_value` go
    with it.

    Nor does any verdict about what is here. `violations`, `first_broken`, `properties_at_risk`,
    `constrained`, `underwritten`, `load_bearing`, `repair_cost`, `counterexample_exists` and
    `selection_truth` are the eight checkpoints, so none of them is computed into this payload --
    including the crossing count, which `show.py` has always printed and which is therefore
    carried as the plain list of boundary-crossing edge ids it has always been, not as the
    `maxCrossings` comparison that decides `cost-communication-boundary`.

    And none of `h0`..`h3` -- each a different draw of every architecture, every break and every
    brief, and every checkpoint is graded on those and on `transfer`'s own derived seed -- is
    reachable from this payload, which is what makes them unreachable rather than merely unnamed.
    """
    return {
        "healthToken": health_token(seed),
        "cases": [_wire_graph(graph(seed, case)) for case in CASES],
        # The crossing count `make inspect` prints, as the ids it counts. A structural fact about
        # a graph a learner is holding, and no part of any answer: what decides
        # `cost-communication-boundary` is this list measured against `policy["maxCrossings"]`,
        # and that comparison stays behind with `_cost_violations`.
        "crossings": {case: list(crossings(graph(seed, case))) for case in CASES},
        "variants": {variant: _wire_graph(broken(seed, variant)) for variant in VARIANTS},
        "useCases": [
            {
                "id": use_case["id"],
                "holders": use_case["holders"],
                "computedBy": use_case["computedBy"],
                "checkedByOutsider": use_case["checkedByOutsider"],
                "resultVisibleTo": use_case["resultVisibleTo"],
                "publishes": list(use_case["publishes"]),
                "holds": list(use_case["holds"]),
            }
            for use_case in use_cases(seed)
        ],
    }
