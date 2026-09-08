"""
Supported computation imports / 計算用に使える標準ライブラリ:
array, base64, binascii, bisect, collections, contextlib, copy, dataclasses, decimal, enum, fractions, functools, hashlib, heapq, hmac, itertools, json, math, operator, random, re, statistics, string, struct, time, typing.
Other imports and file/network access are not supported in grading.
採点時は、この一覧以外のimportとファイル・通信操作には対応しません。
Edit this file in the Portal problem editor.

You review a system diagram stored in dictionaries. Start -> Inspect evidence shows
its inputs. Implement carried first; its public PASS is the first progress marker. Add
a shared helper for the five contract checks below, then underwrites. Submit dataflow;
Solved is the graded success state. Later unfinished functions may still fail. The free statement gives all rules for all eight checkpoints.

Vocabulary: a graph is a diagram; nodes are processing boxes, edges are data arrows.
source/target name their endpoints; id names each item. A stack connects components.
A primitive is a basic cryptographic component. MPC computes jointly without exposing
inputs; a share is a distributed number. ZK proves a claim without revealing its
secret input (witness); zkVM proves program execution; FHE computes on encrypted data.
This lab checks labels only, not an implementation or a cryptographic security proof.

built has caseId/nodes/edges/policy/obligations. Node dictionaries contain
id/layer/domain/transformation. Domain means one trusted administrator's scope.
Layer is primitive-inside (internal code), primitive-above (application code using
it), or host-orchestration (code scheduling the work). Edge dictionaries contain
id/source/target and the following six attributes:

representation  plaintext (readable), secret-share (distributed number), ciphertext
                (encrypted value), commitment (fixed value for later checking),
                proof (evidence of a claim), journal (execution record)
classification  public (may be shown) or secret (must be kept)
algebra         name of arithmetic rules, e.g. remainder-by-5 versus remainder-by-7
keyDomain       name of the key used
identity        name of the statement (claim) or program
serialization   format for arranging data as text/bytes

None means no applicable name, not permission to change one. IDs are unique and
references exist. obligations omits edges with no promises; use .get(edge_id, {}).
Graphs have no cycles. Inputs follow this schema/vocabulary.

Five model properties: correctness (calculation/key consistency), soundness (promises
needed to reject false claims), privacy (secrecy), binding (connection to the intended
claim/program), availability (meeting the communication budget). A node's local check
only checks representation against CONSUMES in THIS model. Real cryptographic
components do not generally inspect only shape.

Example: source --e1:secret--> carry --e2:public--> receiver, other labels equal.
The source output e1 requires {}, because the source receives nothing. carry may not
change classification, so e2 requires secret; public violates data-classification.
This models a secrecy policy, not an analysis of the actual computation's leakage.

The imports below are completed helpers. nodes_by_id/edges_by_id return id-indexed
dicts; incoming/outgoing return edge sequences for (built, node_id). ATTRIBUTES and
PROPERTIES list the six/five names. LICENCE maps attribute to allowed operations;
CONSUMES maps operation to allowed input representations. CLASS_OF maps attribute to
violation name; PROPERTY_OF maps violation name to affected properties. AUTHORISED
maps four operations to (policy key, violation name). Other upper-case names below
are candidate labels or resource/assumption tables used in the free statement.

Operations: carry passes through, split/combine distribute/recombine shares,
encrypt/decrypt encrypt/decrypt, key-switch changes keys, lift changes arithmetic,
commit fixes a value, prove makes proof data, seal makes an execution record,
declassify allows publication. LICENCE decides which attributes may change.

A tuple is an ordered sequence; tuple(sorted(values)) sorts values. A set removes
repetitions. frozenset(values) is an unchangeable set; value in candidates tests
membership. deepcopy copies nested dictionaries. Sorted returned sequences may
also be lists. Do not replace a missing key, None, or an empty tuple with one another.
"""
from __future__ import annotations

from copy import deepcopy
from participant.lab import (
    ALGEBRAS, ATTRIBUTES, AUTHORISED, BOUNDARY_CLASSES, CLASSIFICATIONS, CLASS_OF,
    CONSUMES, COST_OF, COST_ORDER, KEY_DOMAINS, LICENCE, PROPERTIES, PROPERTY_OF,
    REPRESENTATIONS, SERIALIZATIONS, TRANSFORMATIONS, TRUST_OF,
    edges_by_id, incoming, nodes_by_id, outgoing,
)


def carried(built: dict) -> dict:
    """Every edge ID -> required attributes dict, using declared incoming values.

    No incoming edges at its source: {}. Otherwise omit attributes the source's
    operation is allowed to change by LICENCE. Merge remaining attributes:
    classification: secret if any incoming edge is secret, otherwise public.
    identity: discard None; no values -> None; otherwise frozenset, even one value.
    Others: discard None; no values -> None; one distinct value -> that value;
    disagreement -> frozenset. For example [None,'s1','s2'] as identity permits
    frozenset(['s1','s2']); ['F-a1','F-a2'] as algebra denotes disagreement.
    Do not recompute an ideal upstream flow.
    """
    return {}


def underwrites(built: dict) -> dict:
    """Every node ID -> ('correctness','privacy') or ().

    Give these model properties only if the node is primitive-inside, all inputs
    have a CONSUMES-allowed representation, and none of its incoming OR outgoing
    edges violate a contract. Empty input lists pass the local check.
    contract_violations below can share a helper with this function.
    """
    return {}


def property_map(built: dict) -> dict:
    """Every PROPERTIES name -> sorted, duplicate-free edge IDs.

    For each edge: collect CLASS_OF for all carried requirement keys, and every
    class declared in obligations for that edge. Add the edge to their PROPERTY_OF
    properties. Keep all five output keys, using () for no edges. This maps possible
    attribute breaches, not just actual violations. Placement/communication checks
    are outside this map; availability is empty in these supplied designs.
    """
    return {}


def contract_violations(built: dict) -> tuple[tuple[str, str], ...]:
    """Sorted, duplicate-free (edge ID, violation class) pairs from five checks.

    1. Compare carried requirements with actual attributes, including None. An
       identity frozenset allows any member; any other frozenset means incompatible
       inputs and always violates. Use CLASS_OF[attribute].
    2. obligations[edge_id][attribute] = (required value, declared class).
       Compare values; use that class, which need not equal CLASS_OF.
    3. AUTHORISED[operation] = (policy key, class). If the node ID is absent from
       built['policy'][key], report every outgoing edge under that class.
    4. Within each policy['distinctDomains'] group, nodes sharing a domain breach
       trust-collusion-assumption on all their outgoing edges.
    5. Sort crossing edges (different source/target domains) by ID. Those after the
       first policy['maxCrossings'] breach cost-communication-boundary.

    Three crossing edges e1/e2/e3 and budget 2 report e3. One changed value can
    cause both a carried violation and an obligation violation; keep both classes.
    """
    return ()


def first_failure(built: dict) -> str | None:
    """First violated edge in flow order, or None if no contract is broken.

    Input-free nodes are ready. Repeatedly process the smallest-ID remaining edge
    whose source is ready. Make the target ready only after ALL its incoming edges
    have arrived. ID order only breaks ties among ready edges. If e1's source needs
    e9, process e9 before e1. A component can reject an input without a contract
    violation; first_failure still returns None in that case.
    """
    return None


def counterexample(built: dict, prop: str) -> dict:
    """Change exactly one field of a sound design; return the entire design.

    All nodes must still consume every input; at least one violation's PROPERTY_OF
    must contain prop. A counterexample is an example refuting a general claim:
    local acceptance does not guarantee this model's property. A solution exists.

    Allowed changes: one edge's ATTRIBUTES field or one node's domain/transformation.
    Preserve caseId, IDs, wiring, layer, policy, obligations and sequence order.
    Use candidate vocabularies; algebra/keyDomain also allow None. Identity
    candidates are existing edge identity values plus None (not node/edge IDs); domain candidates are existing
    domains and node IDs. Search one-field copies and test the desired condition.
    Editing built in place is also allowed; grading retains the original input.
    """
    return built


def repair(built: dict) -> dict:
    """Fewest allowed changes to pass contracts AND every node's CONSUMES check.

    Same edit space/preservation rules as counterexample. Already sound -> zero
    changes; every broken input is one change from whole. Return the entire design.
    A shape a component cannot consume still needs repair even with no violations.
    Granting extra policy permission or deleting obligations is not a repair.
    """
    return built


def select(use_case: dict) -> dict:
    """Return five fields: primitives/public/secret/trust/dominantCost.

    Input: holders is integer>=1; checkedByOutsider is bool. computedBy is
    the-input-holder, the-parties-themselves, or an-outside-service.
    resultVisibleTo is everyone, the-input-holder, or the-parties.
    publishes/holds are sequences of information names.

    Independently choose zk if checkedByOutsider; mpc if holders>1 and computing
    themselves; fhe if an outside service computes and resultVisibleTo!=everyone.
    Choose ('none',) if none applies. Two holders computing themselves and proving
    to an outsider need both mpc and zk.

    primitives: sorted choices. public: publishes plus 'proof' if zk is chosen.
    secret: holds minus public. trust: union of TRUST_OF for choices. These four
    fields are sorted duplicate-free tuples. dominantCost is the chosen COST_OF
    resource furthest along COST_ORDER (a string).

    TRUST_OF assumes: sound proofs (zk), no collusion above the threshold (mpc),
    only the key holder decrypts (fhe), or trusted plain computation (none).
    COST_ORDER ranks plain computation, communication rounds, proving time and
    ciphertext expansion only for this model; it is not measured performance.
    """
    return {}
