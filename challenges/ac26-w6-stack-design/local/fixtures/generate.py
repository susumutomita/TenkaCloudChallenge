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
# What a value is while it is in flight
# ---------------------------------------------------------------------------

#: What a value physically is on a wire. The vocabulary is closed: a representation this stack
#: has never heard of is not a forward-compatible edge, it is a wire nobody wrote a contract for.
REPRESENTATIONS = (
    "plaintext",
    "secret-share",
    "ciphertext",
    "commitment",
    "proof",
    "journal",
)

#: Whether a value may be seen by somebody outside the trust domain that produced it. Two values,
#: because a third ("internal, but it would be fine") is how the first leak gets written down.
CLASSIFICATIONS = ("public", "secret")

#: Where a computation runs. This is the distinction Week 6 is built around, and it is not the
#: same as "who owns the machine": a guest runs inside a primitive on hardware the host owns.
LAYERS = ("primitive-inside", "primitive-above", "host-orchestration")

#: The end-to-end properties an architecture is judged on. They fail independently, which is the
#: whole reason they are five names rather than one word.
PROPERTIES = ("correctness", "soundness", "privacy", "binding", "availability")

#: The kinds of contract an edge can break. A repair that fixes the wrong class is a repair that
#: moved the failure rather than removed it.
BOUNDARY_CLASSES = (
    "data-classification",
    "statement-witness-binding",
    "field-algebra-domain",
    "key-ciphertext-domain",
    "program-version-identity",
    "serialization-canonicalization",
    "open-reconstruct-policy",
    "randomness-preprocessing-lifetime",
    "trust-collusion-assumption",
    "artifact-publication",
    "cost-communication-boundary",
)

#: Every field of an edge's contract, in the order a canonical listing emits them.
EDGE_FIELDS = (
    "id",
    "source",
    "target",
    "representation",
    "classification",
    "algebra",
    "keyDomain",
    "identity",
    "serialization",
)

#: Every field of a node.
NODE_FIELDS = ("id", "layer", "domain", "transformation")

#: The transformations a node may apply to the value crossing it. Everything not on this list
#: leaves all five attributes alone, which is the default a contract has to be able to assume.
TRANSFORMATIONS = (
    "carry",  # changes nothing
    "split",  # plaintext -> secret-share
    "combine",  # secret-share -> plaintext, and only where the open policy allows it
    "encrypt",  # plaintext -> ciphertext, entering a key domain
    "decrypt",  # ciphertext -> plaintext, leaving one
    "key-switch",  # ciphertext -> ciphertext, changing keyDomain and nothing else
    "lift",  # changes algebra, and nothing else
    "commit",  # -> commitment, and fixes an identity
    "prove",  # -> proof, carrying the identity it was made about
    "seal",  # -> journal, carrying the identity it was made about
    "declassify",  # secret -> public, and the only node allowed to do it
)

#: Which transformations are allowed to change which attribute. Everything else is a violation,
#: and the class it violates is the one this table names.
LICENCE = {
    "representation": ("split", "combine", "encrypt", "decrypt", "commit", "prove", "seal"),
    "classification": ("declassify",),
    "algebra": ("lift",),
    "keyDomain": ("encrypt", "decrypt", "key-switch"),
    "identity": ("commit", "prove", "seal"),
    "serialization": (),
}

#: Which boundary class an unlicensed change to each attribute belongs to.
CLASS_OF = {
    "representation": "open-reconstruct-policy",
    "classification": "data-classification",
    "algebra": "field-algebra-domain",
    "keyDomain": "key-ciphertext-domain",
    "identity": "program-version-identity",
    "serialization": "serialization-canonicalization",
}


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
# Naming the domains a deployment happens to draw
# ---------------------------------------------------------------------------

#: Prime-ish moduli, named rather than valued: the point is that two of them are different, not
#: what either of them is. A stack that hard-codes one is describing somebody else's deployment.
ALGEBRAS = ("F-a1", "F-a2", "F-b1", "F-b2", "F-c1")

#: Key domains. `client` is the one a result has to come back under; `eval` is the one the server
#: works in; `boot` is the bootstrapping key. Returning under the wrong one is not a bug the
#: client can detect by looking at the ciphertext.
KEY_DOMAINS = ("key-client", "key-eval", "key-boot")

#: Serialization dialects. Two encoders that disagree about framing are two protocols that agree
#: most of the time, which is worse than two that never agree.
SERIALIZATIONS = ("canonical-v1", "canonical-v2", "adhoc")

CASES = ("mpc-prover", "zkvm-exploit", "fhe-service")


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

    The interesting wire is `e5`: the shares are recombined into a prover input, and that node is
    the only one licensed to turn a share back into a plaintext. Recombining anywhere else is a
    reconstruct nobody authorised, and every party's local computation stays correct while it
    happens.
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
        _edge("e1", "intake", "split", "plaintext", "secret", algebra=field),
        _edge("e2", "split", "party-a", "secret-share", "secret", algebra=field),
        _edge("e3", "split", "party-b", "secret-share", "secret", algebra=field),
        _edge("e4", "triple", "party-a", "secret-share", "secret", algebra=field),
        _edge("e5", "party-a", "recombine", "secret-share", "secret", algebra=field),
        _edge("e6", "party-b", "recombine", "secret-share", "secret", algebra=field),
        _edge("e7", "recombine", "prove", "plaintext", "secret", algebra=field),
        _edge("e8", "prove", "publish", "proof", "secret", algebra=field, identity=statement),
        _edge("e9", "publish", "artifact", "proof", "public", algebra=field, identity=statement),
    )
    return {"caseId": "mpc-prover", "nodes": nodes, "edges": edges}


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
        _edge("e1", "statement", "ingest", "plaintext", "public", algebra=field, identity=program),
        _edge("e2", "witness", "ingest", "plaintext", "secret", algebra=field),
        _edge("e3", "ingest", "guest", "plaintext", "secret", algebra=field, identity=program),
        _edge("e4", "guest", "seal", "plaintext", "secret", algebra=field, identity=program),
        _edge("e5", "seal", "verify", "journal", "secret", algebra=field, identity=program),
        _edge("e6", "verify", "publish", "journal", "secret", algebra=field, identity=program),
        _edge("e7", "publish", "artifact", "journal", "public", algebra=field, identity=program),
    )
    return {"caseId": "zkvm-exploit", "nodes": nodes, "edges": edges}


def _fhe_service(seed: str) -> dict:
    """A function evaluated on an encrypted input, one ciphertext back under the client key.

    The interesting wire is `e6`: the result comes home, and it has to come home under
    `key-client`. The server's evaluation is correct either way, the ciphertext looks the same
    either way, and the client finds out by not being able to decrypt it -- or, worse, by being
    handed something the server can.
    """
    s = _stream(seed, "fhe")
    field = _pick(s, 8, ALGEBRAS)
    nodes = (
        _node("client", "host-orchestration", "client", "carry"),
        _node("encrypt", "host-orchestration", "client", "encrypt"),
        _node("evaluate", "primitive-inside", "server", "carry"),
        _node("bootstrap", "primitive-inside", "server", "carry"),
        _node("switch", "primitive-inside", "server", "key-switch"),
        _node("return", "host-orchestration", "server", "carry"),
        _node("decrypt", "host-orchestration", "client", "decrypt"),
        _node("consume", "host-orchestration", "client", "carry"),
    )
    edges = (
        _edge("e1", "client", "encrypt", "plaintext", "secret", algebra=field),
        _edge("e2", "encrypt", "evaluate", "ciphertext", "secret", algebra=field, key_domain="key-client"),
        _edge("e3", "evaluate", "bootstrap", "ciphertext", "secret", algebra=field, key_domain="key-client"),
        _edge("e4", "bootstrap", "switch", "ciphertext", "secret", algebra=field, key_domain="key-client"),
        _edge("e5", "switch", "return", "ciphertext", "secret", algebra=field, key_domain="key-eval"),
        _edge("e6", "return", "decrypt", "ciphertext", "secret", algebra=field, key_domain="key-eval"),
        _edge("e7", "decrypt", "consume", "plaintext", "secret", algebra=field),
    )
    return {"caseId": "fhe-service", "nodes": nodes, "edges": edges}


_BUILDERS = {
    "mpc-prover": _mpc_prover,
    "zkvm-exploit": _zkvm_exploit,
    "fhe-service": _fhe_service,
}


def graph(seed: str, case_id: str) -> dict:
    """The sound architecture for one case, drawn from the seed.

    Sound means every edge satisfies every boundary contract, which is not the same as "the
    system is secure" and is not claimed to be. It is the baseline the broken variants below are
    one change away from.
    """
    if case_id not in _BUILDERS:
        raise ValueError(f"{case_id!r} is not one of {CASES}")
    return _BUILDERS[case_id](seed)


def nodes_by_id(built: dict) -> dict:
    return {node["id"]: node for node in built["nodes"]}


def edges_by_id(built: dict) -> dict:
    return {edge["id"]: edge for edge in built["edges"]}


# ---------------------------------------------------------------------------
# Ground truth: what a boundary contract actually says
#
# Everything from here down exists so a hidden checker can tell a right answer from a
# convincing one. The hidden checker imports this; a submission module must not.
# ---------------------------------------------------------------------------


def incoming(built: dict, node_id: str) -> tuple:
    return tuple(edge for edge in built["edges"] if edge["target"] == node_id)


def outgoing(built: dict, node_id: str) -> tuple:
    return tuple(edge for edge in built["edges"] if edge["source"] == node_id)


def _changed(before: dict, after: dict) -> tuple[str, ...]:
    """Which of the five attributes this node changed, plus the serialization dialect."""
    return tuple(
        name
        for name in ("representation", "classification", "algebra", "keyDomain", "identity", "serialization")
        if before[name] != after[name]
    )


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


def _violations_at(node: dict, arrivals: tuple, after: dict) -> set:
    """Every contract this node broke producing `after` out of everything that arrived.

    A change is a violation when the node's transformation is not licensed to make it. That is
    the whole rule, and it is deliberately mechanical: an architecture is safe to reason about
    exactly when "what may change here" is written down rather than remembered.
    """
    out = set()
    for attribute in LICENCE:
        if node["transformation"] in LICENCE[attribute]:
            continue
        want = _expected(arrivals, attribute)
        got = after[attribute]
        if isinstance(want, frozenset):
            # More than one value arrived carrying this attribute. Carrying either one forward
            # is honest; inventing a third is not, and neither is silently picking one for an
            # attribute where the inputs were supposed to agree.
            ok = got in want if attribute == "identity" else False
        else:
            ok = got == want
        if not ok:
            out.add((after["id"], CLASS_OF[attribute]))
    return out


def violations(built: dict) -> tuple[tuple[str, str], ...]:
    """Every `(edge, boundary class)` this architecture breaks, sorted.

    An edge is named rather than a node, because a contract is a statement about a value in
    flight: the node is where it happened and the edge is what it happened to.
    """
    out = set()
    for node in built["nodes"]:
        arrivals = incoming(built, node["id"])
        if not arrivals:
            # A source node invents its output rather than transforming one, so there is no
            # before to compare against. What it is allowed to invent is the architecture's
            # premise rather than one of its edges.
            continue
        for after in outgoing(built, node["id"]):
            out |= _violations_at(node, arrivals, after)
    return tuple(sorted(out))


def _order(built: dict) -> tuple[str, ...]:
    """The edges in the order the value reaches them, so "first" means something.

    A stack fails once and then keeps failing. Reporting the fifth symptom is reporting the
    place a repair does nothing, which is why the first broken boundary is its own checkpoint.
    """
    seen: list[str] = []
    remaining = {edge["id"]: edge for edge in built["edges"]}
    produced = {node["id"] for node in built["nodes"] if not incoming(built, node["id"])}
    while remaining:
        ready = [
            edge for edge in remaining.values() if edge["source"] in produced
        ]
        if not ready:
            ready = [min(remaining.values(), key=lambda edge: edge["id"])]
        step = min(ready, key=lambda edge: edge["id"])
        seen.append(step["id"])
        produced.add(step["target"])
        del remaining[step["id"]]
    return tuple(seen)


def first_broken(built: dict) -> str | None:
    """The earliest edge in the flow whose contract is broken, or `None` for a sound graph."""
    broken_edges = {edge for edge, _ in violations(built)}
    for edge_id in _order(built):
        if edge_id in broken_edges:
            return edge_id
    return None


# ---------------------------------------------------------------------------
# Ground truth: which component carries which end-to-end property
# ---------------------------------------------------------------------------

#: Which boundary classes, when broken, cost which end-to-end property. One class can cost two,
#: and that is the point: a repair chosen for privacy can leave soundness where it was.
PROPERTY_OF = {
    "data-classification": ("privacy",),
    "statement-witness-binding": ("soundness", "binding"),
    "field-algebra-domain": ("correctness", "soundness"),
    "key-ciphertext-domain": ("correctness", "privacy"),
    "program-version-identity": ("binding", "soundness"),
    "serialization-canonicalization": ("binding",),
    "open-reconstruct-policy": ("privacy",),
    "randomness-preprocessing-lifetime": ("soundness", "privacy"),
    "trust-collusion-assumption": ("privacy",),
    "artifact-publication": ("privacy",),
    "cost-communication-boundary": ("availability",),
}


def properties_at_risk(built: dict) -> tuple[str, ...]:
    """Every end-to-end property this architecture no longer has, sorted."""
    out: set = set()
    for _, boundary in violations(built):
        out |= set(PROPERTY_OF[boundary])
    return tuple(sorted(out))


def health_token(seed: str) -> str:
    joined = "|".join(f"{case}:{len(graph(seed, case)['edges'])}" for case in CASES)
    return hashlib.sha256(f"health:{seed}:{joined}".encode()).hexdigest()[:16]
