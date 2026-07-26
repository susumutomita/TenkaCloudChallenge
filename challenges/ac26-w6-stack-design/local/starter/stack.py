"""The only file you edit.

Week 6's other problems each built one thing that works: a prover over secret shares, a guest
that says exactly what it proved, an evaluation that never sees its input. This one is about the
wires between them, and it starts from the observation that made the week's applications worth
separating from its primitives:

**a primitive can only check the shape of what it was handed.**

That is not a criticism of primitives. It is what a primitive is. An MPC engine verifies that
what arrived is a share; it has no way to know whether that share was supposed to be secret, or
which field the party on the other end thinks it is in, or whether the value it reconstructs is
one the open policy ever approved. A zkVM verifies that the guest ran; it does not know whether
the journal it produced is about the program the reader is holding. An FHE evaluation is correct
under whatever key it was given, and cannot tell you that the key was the wrong one.

So every component's own test passes, and the architecture is broken anyway. That is a
**composition failure**, and this problem is nine ways of looking at one.

## No cryptography runs here

Not a share, not a proof, not a ciphertext. What you are handed is a typed graph:

```text
a node   one computation, and where it runs
an edge  one value crossing from one computation to the next, and what it is at that moment
```

A node carries four things:

```text
id              what to call it
layer           primitive-inside, primitive-above, or host-orchestration
domain          whose trust domain it runs in
transformation  what it does to the value crossing it
```

An edge carries where it came from, where it goes, and the **five things a value is at once**,
plus the dialect it is framed in:

```text
representation  plaintext, secret-share, ciphertext, commitment, proof, journal
classification  public or secret
algebra         which field or modulus it lives in, when that applies
keyDomain       which key it is under, when that applies
identity        which program or statement it is about, when that applies
serialization   the framing it was encoded in
```

## Three levels of contract, and they are not the same level

```text
LICENCE      what a transformation may change. A key-switch may change keyDomain. A carry may
             change nothing at all
AUTHORISED   which nodes this architecture allowed to hold such a transformation, read out of
             built["policy"]. Being licensed to open a secret is a fact about the operation.
             Being allowed to is a fact about who is running it
obligations  what this architecture promised to deliver, and on which edge. A licensed change
             is not a correct change: a key-switch is authorised to change the key domain, and
             being authorised to change it is not being right about what to change it to
```

Two more live in `built["policy"]`: `distinctDomains`, groups of nodes that have to sit in
different trust domains, and `maxCrossings`, how many edges may leave one domain for another.
Both are statements about **where the computation was put** rather than about a value in flight,
and both are real boundaries — a deployment that folds two parties onto one machine has not made
a smaller deployment.

## What is supplied

```python
from fixtures.generate import (
    ATTRIBUTES, AUTHORISED, BOUNDARY_CLASSES, CASES, CLASSIFICATIONS, CLASS_OF, CONSUMES,
    COST_OF, COST_ORDER, LAYERS, LICENCE, PROPERTIES, PROPERTY_OF, REPRESENTATIONS,
    SERIALIZATIONS, ALGEBRAS, KEY_DOMAINS, TRANSFORMATIONS, TRUST_OF,
    edges_by_id, nodes_by_id, incoming, outgoing, graph, broken, use_cases,
)
```

```text
graph(seed, case)      the sound architecture for one of the three cases
broken(seed, variant)  the same architecture with exactly one thing wrong with it
incoming/outgoing      the edges arriving at and leaving one node
CLASS_OF               attribute -> the boundary class an unlicensed change to it belongs to
PROPERTY_OF            boundary class -> the end-to-end properties breaking it costs
CONSUMES               transformation -> the representations it is able to take in
```

## First move

```bash
make inspect
```

It prints the three architectures, their contracts, their policies, their promises, and the
list of variants you will diagnose. It does not print which contract each variant breaks, where
it broke first, or what a repair costs. Those are the checkpoints.

## Goal

Clear eight independently scored checkpoints. Every component in every graph below is correct.
"""

from __future__ import annotations


# ---------------------------------------------------------------------------
# 1. The typed data-flow
# ---------------------------------------------------------------------------


def carried(built: dict) -> dict:
    """Every edge id -> the attributes that edge is **not free to choose**, and what they must be.

    Returns a dict with one entry per edge. Each value is a dict of attribute name to required
    value, and an attribute the node is licensed to change is simply **absent**: the contract
    has nothing to say about it there, which is the entire meaning of licensing it.

    Two things decide an edge's requirement: everything that arrived at the node that produced
    it, and what that node's transformation was licensed to change on the way through.

    Fan-in is where this stops being a lookup. A node with two inputs does not transform a value,
    it **merges** two, and merging is a different rule per attribute:

    ```text
    classification  secret wins. One secret input makes the output secret, because the output
                    is a function of it, and a function of a secret is a secret
    identity        an identity may be carried forward but not invented: the output may name an
                    identity that some input named, and otherwise names none
    the rest        every input that carries one has to agree, and the output is that value
    ```

    Where inputs that were supposed to agree do not, no single value is honest; where several
    identities arrive, any one of them is. Return the set of candidates in that case, so a
    caller can tell "it has to be exactly this" from "it has to be one of these".

    One node type has no requirement at all, and working out which is most of this checkpoint.

    Read the values that are actually **declared** upstream rather than recomputing an ideal
    flow from the premises. A graph that broke once has to look broken once, not broken from
    there on: the difference between those two is the whole of checkpoint 4.
    """
    return {}


# ---------------------------------------------------------------------------
# 2. Where the primitive's guarantee stops
# ---------------------------------------------------------------------------


def underwrites(built: dict) -> dict:
    """Every node id -> the end-to-end properties **the primitive itself** vouches for there.

    Sorted tuples, one entry per node, and most of them are empty.

    A primitive underwrites `correctness` and `privacy` for the computation it runs inside
    itself. That is a strong guarantee and a narrow one, and this checkpoint is about the edges
    of it:

    * Code sitting **on top of** a primitive is not covered by it. The prover relation over
      shares, the journal a guest seals, the verifier's check — a primitive covers those the way
      a bank vault covers what you carry out of the building.
    * Host orchestration is not covered by anything at all.
    * A guarantee is conditional on the assumption behind it. A primitive vouches for the value
      it received and for the value it produced; where a contract broke on either, its
      assumption was not the one it was given, and it is underwriting nothing.
    * A node handed a shape its transformation cannot consume never ran. `CONSUMES` says what
      each transformation is able to take in.

    That last pair is the sentence "a primitive's assumption is not an end-to-end guarantee",
    written so a machine can check it. An architecture diagram that shades the primitive boxes
    green is claiming this function returns something it does not.
    """
    return {}


# ---------------------------------------------------------------------------
# 3. The property-to-component map
# ---------------------------------------------------------------------------


def property_map(built: dict) -> dict:
    """Every end-to-end property -> the edges it depends on, sorted. All five keys, always.

    An edge carries a property when some boundary class it is **able** to break costs that
    property. `PROPERTY_OF` says which classes cost which properties, and one class can cost
    two — which is the point of drawing the map at all, because a repair chosen for one property
    can leave another exactly where it was.

    Two things take an attribute off an edge's list:

    ```text
    the node is licensed to change it   the contract has nothing to say about it there
    nothing upstream constrained it     the architecture's premise is not one of its claims
    ```

    The second is why the answer is not "every edge": what a source node emits is where the
    architecture starts rather than something it can be caught getting wrong.

    Whatever this architecture promised about a particular edge counts too, whether or not any
    attribute of that edge was constrained by what arrived.

    One of the five properties is not carried by any wire in any of these three architectures,
    and the empty tuple is its answer. Working out which one, and why it is a fact about these
    architectures rather than a gap in the model, is worth more than the other four together.
    """
    return {}


# ---------------------------------------------------------------------------
# 4. Every contract this architecture breaks
# ---------------------------------------------------------------------------


def contract_violations(built: dict) -> tuple[tuple[str, str], ...]:
    """Every `(edge id, boundary class)` this architecture breaks, sorted, no duplicates.

    An edge is named rather than a node, because a contract is a statement about a value in
    flight: the node is where it happened and the edge is what it happened to.

    Five different things can be broken, and they are genuinely five rather than one written
    five ways:

    ```text
    licence        a node changed something its transformation was not licensed to change.
                   `CLASS_OF` names the class, one per attribute
    obligation     built["obligations"] is {edge: {attribute: (required value, class)}}. The
                   class is declared there rather than derived, because a promise about what
                   arrives somewhere is not the same failure as a change made on the way
    authorisation  a node holds one of the four transformations in `AUTHORISED` without being
                   named in the policy key that authorises it. Report it against everything
                   that leaves the node: everything that left was produced by an operation
                   nobody approved
    trust          two nodes from one built["policy"]["distinctDomains"] group share a domain.
                   Report it against everything that leaves either of them
    cost           more edges cross a trust boundary than built["policy"]["maxCrossings"]
                   allows. Report the excess in id order — the same crossings, sorted, past
                   that many
    ```

    A single wrong attribute can show up as two entries, and it should. The obligation the value
    failed to keep and the licence the next node down broke carrying it forward are two
    statements about the same mistake, and telling them apart is what the next checkpoint is.
    """
    return ()


# ---------------------------------------------------------------------------
# 5. Where it broke first
# ---------------------------------------------------------------------------


def first_failure(built: dict) -> str | None:
    """The earliest edge in the flow whose contract is broken, or `None` when none is.

    A stack fails once and then keeps failing. Every downstream symptom is real, and a repair
    aimed at one of them does nothing, so "which of these came first" is the whole difference
    between a diagnosis and a list.

    "First" is in the order the value reaches the edges, not in id order and not in the order
    the graph happened to list them — those coincide in some of these architectures and not in
    others, and a solution that relies on the coincidence is a solution to a smaller problem.
    An edge is reachable once something has produced its source node; a source node is produced
    to begin with.
    """
    return None


# ---------------------------------------------------------------------------
# 6. Breaking one without breaking any component
# ---------------------------------------------------------------------------


def counterexample(built: dict, prop: str) -> dict:
    """One change to `built` that costs it `prop` while **every component still passes**.

    Return a whole architecture: same nodes, same edges, same wires between them, same policy,
    same obligations, and exactly one of these different —

    ```text
    one attribute of one edge
    one node's trust domain
    one node's transformation
    ```

    — such that every node still accepts everything arriving at it, and `prop` is among the
    properties the resulting graph has lost.

    A node's own check is the whole of `CONSUMES`: it reads the **shape** of what arrived and
    nothing else about it. Classification, key domain, identity and dialect all travel through
    a component unread, which is why this construction is possible at all. The counterexample
    is not that some part stopped working. It is that no part was ever looking.

    `built` is sound, so anything at risk afterwards is something you introduced.
    """
    return built


# ---------------------------------------------------------------------------
# 7. Fixing one without moving the failure
# ---------------------------------------------------------------------------


def repair(built: dict) -> dict:
    """The same architecture with the **fewest** changes that make every contract hold.

    Same nodes, same edges, same wires, same policy, same obligations, and the same change space
    as the checkpoint above. If nothing is wrong, return what you were given.

    Nothing wrong means two things and not one:

    ```text
    every contract holds
    every component can run what it was handed
    ```

    One of the deployments breaks no boundary at all and still leaves a primitive holding a
    shape it has no way to consume. A repair that stops at the first condition has confused a
    contract with a design review.

    The policy and the obligations are not in the search space, and leaving them out is the
    entire discipline of this function. Authorising the node that opened the secret satisfies
    every contract in one move — and it is not a repair. It lowers the requirement to meet the
    deployment, which is the deployment writing its own acceptance criteria. The same trick is
    available with the obligations, and it is the same trick.

    Every graph you are handed is one change from whole, so a repair that costs two has fixed a
    symptom and left the cause, or has fixed the cause and broken something on the way past.
    """
    return built


# ---------------------------------------------------------------------------
# 8. Choosing a stack for something nobody has built yet
# ---------------------------------------------------------------------------


def select(use_case: dict) -> dict:
    """A structured design for one brief.

    ```python
    {
        "primitives":   sorted tuple from ("fhe", "mpc", "zk"), or ("none",)
        "public":       sorted tuple of the names this design publishes
        "secret":       sorted tuple of the names it keeps
        "trust":        sorted tuple of what has to hold in the world for it to mean anything
        "dominantCost": the one resource it mostly spends
    }
    ```

    A brief says who holds the inputs, who computes, whether somebody outside has to be
    convinced, and who is allowed to see the answer. Three questions follow from that, and they
    are answered independently:

    ```text
    does somebody outside have to be convinced without seeing the inputs   -> zk
    do several holders compute it between themselves                       -> mpc
    does an outside service compute it and not get to see the answer       -> fhe
    ```

    **None of the three excludes another.** Two can be true at once, and the answer with one
    name where two apply has not chosen between requirements, it has dropped one. Where none is
    true, say so — a design that reaches for a primitive it does not need has bought an
    assumption for nothing, and `TRUST_OF` names the assumption the plain answer carries
    instead.

    `TRUST_OF` and `COST_OF` are per primitive. `COST_ORDER` is cheapest first, and a
    combination costs what its most expensive member costs — the expensive one does not get
    cheaper for standing next to something cheap.

    `public` and `secret` are not simply the brief's two lists copied across. A primitive can
    add something to what a design publishes even though the brief never mentioned it, and
    anything that ends up published is not also kept.
    """
    return {}
