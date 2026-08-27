"""The supplied half: the vocabulary a boundary contract is written in, and how to read a graph.

Nothing in this file is graded. It is what `starter/stack.py` tells you that you are handed --
the closed vocabularies a value can be described with, the three levels of contract, what each
transformation may change and what it is able to consume, the eleven boundary classes and what
breaking one costs, and four one-line accessors for walking a typed graph.

## Why this is a separate module (Issue 537/538, Issue 543 option B2)

It used to live in `fixtures/generate.py`, which shipped in the image `make build` produced. That
file also holds this problem's entire ground truth under different names: `constrained` is
`carried`, `underwritten` is `underwrites`, `load_bearing` is `property_map`, `violations` is
`contract_violations`, `first_broken` is `first_failure`, `selection_truth` is `select`, and
`_one_change_neighbours` with `local_checks_pass`, `properties_at_risk` and `_whole` is the whole
search `counterexample` and `repair` are graded on. A submission transcribed from that one file,
with no reasoning past copying, scored 8 of 8 checkpoints (300 of 300 points).

It also held `BREAKS`, which names -- per variant, and identically for **every** seed, the hidden
labels included -- which node or edge was broken and which attribute was changed. That table is
the `contracts` and `diagnosis` answers for every deployment this problem can draw, not only for
the one a learner is looking at.

So the derivation moved behind the verifier and the vocabulary stayed here. This deployment's own
architectures, its broken variants and its briefs are **data** now: they arrive over
`GET /public` (see `show.py`), which is the same participant surface `make inspect` has always
printed. The carve line is code versus data, not supplied versus graded -- three of the names the
starter's import list used to name (`graph`, `broken`, `use_cases`) were never helpers, they were
this deployment's own objects.
"""

from __future__ import annotations

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

#: The five things a value is at once, plus the dialect it is framed in. These are the attributes
#: a boundary contract is written about, and the order a canonical listing emits them.
ATTRIBUTES = (
    "representation",
    "classification",
    "algebra",
    "keyDomain",
    "identity",
    "serialization",
)

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

#: The four transformations an architecture has to authorise **by node**, and the class a node
#: holding one it was never authorised to hold belongs to. Being licensed to open a secret is a
#: statement about the operation; being allowed to is a statement about who is running it.
AUTHORISED = {
    "declassify": ("mayDeclassify", "open-reconstruct-policy"),
    "combine": ("mayCombine", "open-reconstruct-policy"),
    "key-switch": ("mayKeySwitch", "key-ciphertext-domain"),
    "lift": ("mayLift", "field-algebra-domain"),
}

#: What each transformation is able to consume. This is the whole of a node's **local** check:
#: a primitive validates the shape of what arrived and nothing else about it. Classification, key
#: domain, identity and dialect are invisible here, which is why every composition failure in
#: this problem can happen with every local check passing.
CONSUMES = {
    "carry": REPRESENTATIONS,
    "split": ("plaintext",),
    "combine": ("secret-share",),
    "encrypt": ("plaintext",),
    "decrypt": ("ciphertext",),
    "key-switch": ("ciphertext",),
    "lift": REPRESENTATIONS,
    "commit": REPRESENTATIONS,
    "prove": REPRESENTATIONS,
    "seal": REPRESENTATIONS,
    "declassify": REPRESENTATIONS,
}


# ---------------------------------------------------------------------------

#: Prime-ish moduli, named rather than valued: the point is that two of them are different, not
#: what either of them is. A stack that hard-codes one is describing somebody else's deployment.
ALGEBRAS = ("F-a1", "F-a2", "F-b1", "F-b2", "F-c1")

#: Key domains. `key-client` is the one a result has to come back under; `key-eval` is the one the
#: server works in; `key-boot` is what a bootstrap leaves behind. Coming home under the wrong one
#: is not a bug the client can detect by looking at the ciphertext.
KEY_DOMAINS = ("key-client", "key-eval", "key-boot")

#: Serialization dialects. Two encoders that disagree about framing are two protocols that agree
#: most of the time, which is worse than two that never agree.
SERIALIZATIONS = ("canonical-v1", "canonical-v2", "adhoc")

CASES = ("mpc-prover", "zkvm-exploit", "fhe-service")


#: The deployments you diagnose, by name. `make inspect` has always printed exactly this list.
#:
#: The recipe that produces them does not ship here. Which node or edge each variant breaks, and
#: which attribute it changes, is `contracts` and `diagnosis` -- and it is the same table on every
#: seed, so shipping it would answer those two checkpoints on the hidden labels as well as on the
#: one a learner can see. The broken architectures themselves arrive as data over `GET /public`,
#: the way they have always arrived on a learner's screen: as graphs to read, not as a rule that
#: made them.
VARIANTS = (
    "a-share-is-opened-inside-a-party",
    "the-witness-goes-public-on-the-way-in",
    "one-party-works-in-another-field",
    "the-result-comes-home-under-the-wrong-key",
    "the-journal-is-about-another-program",
    "the-proof-is-framed-in-another-dialect",
    "the-proof-names-no-statement",
    "the-artifact-is-never-published",
    "the-triple-has-a-name",
    "two-parties-share-one-trust-domain",
    "the-bootstrap-moves-to-the-client",
    "a-party-opens-its-own-share",
    "a-party-cannot-run-what-it-was-handed",
)


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


# ---------------------------------------------------------------------------
# Reading a typed graph
#
# Four accessors, and they are the whole of what this module does with a graph. None of them
# decides anything: they turn a list of nodes and a list of edges into the two questions every
# contract is asked about a node -- what arrived, and what left.
# ---------------------------------------------------------------------------


def nodes_by_id(built: dict) -> dict:
    return {node["id"]: node for node in built["nodes"]}


def edges_by_id(built: dict) -> dict:
    return {edge["id"]: edge for edge in built["edges"]}


def incoming(built: dict, node_id: str) -> tuple:
    return tuple(edge for edge in built["edges"] if edge["target"] == node_id)


def outgoing(built: dict, node_id: str) -> tuple:
    return tuple(edge for edge in built["edges"] if edge["source"] == node_id)
