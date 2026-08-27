"""Reference design compiler. Lives inside the image only; never mounted to the host.

The whole argument of this problem is that a design is a *function of its brief*. Every
routine below reads the brief and derives its answer; none of them contains a decision that
was made once and written down. That is why the same code answers a brief it has never
seen — and why a design that was written down rather than derived does not.
"""

from __future__ import annotations

from itertools import combinations
from typing import Any

from participant.lab import ACTOR_TRUSTS, OPERATOR_ROLES, PRIMITIVES, PROPERTIES

#: Roles that take part in producing the result. Hiding an asset from one of these is a
#: privacy requirement; hiding it from a party that only reads the answer is not — that is
#: what zero knowledge is for, and the two are different requirements.
PARTICIPATING_ROLES = frozenset({"input_provider"}) | OPERATOR_ROLES

#: Visibilities that hand the underlying value over in the clear.
REVEALING = frozenset({"plaintext", "public"})


# ---------------------------------------------------------------------------
# 1. Assets
# ---------------------------------------------------------------------------


def classify_assets(brief: dict[str, Any]) -> dict[str, dict[str, str]]:
    """Every asset in the brief, with its owner and its classification.

    Two independent facts decide the label: whether anybody must not learn it, and whether
    it is computed from something else. Both come straight out of the brief.
    """
    classified: dict[str, dict[str, str]] = {}
    for asset in brief["assets"]:
        secret = bool(asset["must_not_learn"])
        derived = bool(asset.get("derived_from"))
        if derived:
            classification = "derived-private" if secret else "derived-public"
        else:
            classification = "private" if secret else "public"
        classified[asset["id"]] = {"owner": asset["owner"], "classification": classification}
    return classified


# ---------------------------------------------------------------------------
# 2. Requirements
# ---------------------------------------------------------------------------


def _role_of(brief: dict[str, Any], actor_id: str) -> str:
    for actor in brief["actors"]:
        if actor["id"] == actor_id:
            return actor["role"]
    return "unknown"


def _asset(brief: dict[str, Any], asset_id: str) -> dict[str, Any] | None:
    for asset in brief["assets"]:
        if asset["id"] == asset_id:
            return asset
    return None


def required_properties(brief: dict[str, Any]) -> dict[str, bool]:
    """Which properties this brief actually requires. Every property gets an answer."""
    required = dict.fromkeys(PROPERTIES, False)

    # Correctness is not optional: a design that computes the wrong answer privately is not
    # a design.
    required["correctness"] = True

    # Privacy is about a party that takes part in producing the result. A relying party
    # that only reads the answer is a different requirement.
    for asset in brief["assets"]:
        if any(_role_of(brief, other) in PARTICIPATING_ROLES for other in asset["must_not_learn"]):
            required["privacy"] = True
            break

    # Soundness enters when somebody acts on a value they did not compute themselves.
    for asset in brief["assets"]:
        if not any(party != asset["owner"] for party in asset["integrity_relied_on_by"]):
            continue
        required["soundness"] = True
        # Zero knowledge enters only when that same value is derived from something the
        # relying party is not allowed to see. Soundness without it is an ordinary
        # signature; conflating the two is the misconception this targets.
        for source_id in asset.get("derived_from", []):
            source = _asset(brief, source_id)
            if source is None:
                continue
            if any(party in source["must_not_learn"] for party in asset["integrity_relied_on_by"]):
                required["zero_knowledge"] = True

    required["binding"] = bool(brief["constraints"].get("commit_then_reveal"))
    required["availability"] = bool(brief["constraints"].get("must_complete_without_all_parties"))
    return required


# ---------------------------------------------------------------------------
# 3. Alternatives
# ---------------------------------------------------------------------------


def _trusted_operator(brief: dict[str, Any]) -> str | None:
    """A party everybody would let hold everything, if the brief has one.

    Any actor will do, not only one with an infrastructure role: when a brief hides nothing
    from a party, that party can run the thing. Requiring a dedicated operator would make a
    single party computing on its own data "untrusted", and answer it with cryptography.
    """
    hidden_from: set[str] = set()
    for asset in brief["assets"]:
        hidden_from.update(asset["must_not_learn"])
    for actor in brief["actors"]:
        if actor["id"] not in hidden_from:
            return actor["id"]
    return None


def _sole_secret_owner(brief: dict[str, Any]) -> str | None:
    """The single owner of every private input, when there is one.

    A key holder only exists when the secrets belong to one party. Two parties with two
    secrets need two keys, and single-key FHE stops being the answer.
    """
    owners = {
        asset["owner"]
        for asset in brief["assets"]
        if asset["must_not_learn"] and not asset.get("derived_from")
    }
    return next(iter(owners)) if len(owners) == 1 else None


def is_admissible(primitive: str, brief: dict[str, Any]) -> bool:
    """Whether this brief supplies the party the primitive needs you to trust.

    A primitive that trusts an assumption about the world (non-collusion) is admissible
    everywhere. A primitive that trusts a *party* is admissible only where the brief has one
    to spare.
    """
    for trusted in PRIMITIVES[primitive]["trusts"]:
        if trusted not in ACTOR_TRUSTS:
            continue
        if trusted == "operator" and _trusted_operator(brief) is None:
            return False
        if trusted == "key_holder" and _sole_secret_owner(brief) is None:
            return False
    return True


def compare_alternatives(brief: dict[str, Any]) -> list[dict[str, Any]]:
    """Every candidate, including the one that uses no cryptography at all.

    The baseline is not a courtesy entry. A design that never states what happens without
    cryptography cannot show that cryptography bought anything.
    """
    return [
        {
            "primitive": name,
            "satisfies": sorted(entry["provides"]),
            "assumptions": list(entry["assumptions"]),
            "non_goals": list(entry["non_goals"]),
            "admissible": is_admissible(name, brief),
        }
        for name, entry in PRIMITIVES.items()
    ]


# ---------------------------------------------------------------------------
# 4. Selection
# ---------------------------------------------------------------------------


def _covers(selection: list[str], required: dict[str, bool]) -> bool:
    provided: set[str] = set()
    for name in selection:
        provided.update(PRIMITIVES[name]["provides"])
    return all(not needed or prop in provided for prop, needed in required.items())


def select_primitive(brief: dict[str, Any]) -> list[str]:
    """The primitives this brief needs, and nothing beyond them.

    Three conditions. The selection has to cover every required property; every primitive in
    it has to be admissible for this brief; and no primitive may be removable without
    breaking the cover. The third is what stops "more cryptography is safer".

    Before any of them: when no cryptography is required, the answer is no cryptography.
    """
    required = required_properties(brief)

    if _covers(["none"], required) and is_admissible("none", brief):
        return ["none"]

    admissible = [name for name in PRIMITIVES if name != "none" and is_admissible(name, brief)]

    # The smallest combination that covers the brief, found by looking at all of them.
    # There are six options, so "all of them" is sixty-four — cheaper than the greedy
    # search it replaces, and minimal by construction rather than by a repair afterwards:
    # a fewest-options cover has no proper subset that also covers, or that subset would
    # have been found first.
    for size in range(1, len(admissible) + 1):
        covers = sorted(
            combination
            for combination in combinations(sorted(admissible), size)
            if _covers(list(combination), required)
        )
        if covers:
            return list(covers[0])

    # No admissible combination covers this brief. Saying so is a design outcome, not a
    # failure to answer: the brief needs weaker requirements, or a party it does not have.
    return []


def is_minimal(selection: list[str], brief: dict[str, Any]) -> bool:
    """No primitive in the selection can be dropped without losing a required property."""
    required = required_properties(brief)
    return all(
        not _covers([other for other in selection if other != name], required)
        for name in selection
    )


# ---------------------------------------------------------------------------
# 5. Architecture
# ---------------------------------------------------------------------------


def architecture(brief: dict[str, Any], selection: list[str]) -> dict[str, Any]:
    """A typed data-flow graph: who runs what, and what crosses each edge in what form.

    The type on an edge is the point. "the record flows to the evaluator" is not a design;
    "the record flows to the evaluator as ciphertext" is, and it is checkable.
    """
    classified = classify_assets(brief)
    providers = [a["id"] for a in brief["actors"] if a["role"] == "input_provider"]
    operators = [a["id"] for a in brief["actors"] if a["role"] in OPERATOR_ROLES]

    # One node per actor, so a component can never be operated by nobody. `trusts` stays
    # empty: a component trusting another is an assumption, and this design does not need
    # one. Writing it down only where it exists is what keeps the graph acyclic.
    nodes: list[dict[str, Any]] = [
        {"id": f"node_{actor['id']}", "operated_by": actor["id"], "primitives": [], "trusts": []}
        for actor in brief["actors"]
    ]

    # The computation lives with whoever is meant to run it: a dedicated operator when the
    # brief names one, otherwise the input providers jointly.
    host = operators[0] if operators else (providers[0] if providers else brief["actors"][0]["id"])
    compute = next(node for node in nodes if node["operated_by"] == host)
    compute["primitives"] = list(selection)

    edges: list[dict[str, str]] = []
    for asset in brief["assets"]:
        source = f"node_{asset['owner']}"
        if not asset.get("derived_from"):
            # Inputs travel to the computation. How they travel is decided by who may not
            # see them, not by which primitive is in fashion.
            #
            # An input whose owner *is* the computing component still belongs in the flow:
            # the edge is a loop, and it is in the clear, because a party holding its own
            # data plainly is not a leak. Omitting it instead would leave the asset absent
            # from the design, which is the one thing a data-flow graph must never do.
            local = source == compute["id"]
            edges.append(
                {
                    "from": source,
                    "to": compute["id"],
                    "asset": asset["id"],
                    "visibility": "plaintext" if local else _input_visibility(asset, selection),
                }
            )
            continue
        revealing = classified[asset["id"]]["classification"] == "derived-public"
        readers = [r for r in asset["known_to"] if f"node_{r}" != compute["id"]]
        # When the only reader is the component that computed it, the result still has to
        # appear in the flow — as a loop, for the same reason a locally held input does.
        for reader in readers or [compute["operated_by"]]:
            edges.append(
                {
                    "from": compute["id"],
                    "to": f"node_{reader}",
                    "asset": asset["id"],
                    "visibility": "plaintext" if revealing else "ciphertext",
                }
            )
        # A party acting on a value it did not compute needs something it can check, not
        # just the value.
        for reader in asset["integrity_relied_on_by"]:
            edges.append(
                {
                    "from": compute["id"],
                    "to": f"node_{reader}",
                    "asset": asset["id"],
                    "visibility": "proof",
                }
            )
    return {"nodes": nodes, "edges": edges}


def _input_visibility(asset: dict[str, Any], selection: list[str]) -> str:
    """How an input may cross the wire into the component that computes on it."""
    if not asset["must_not_learn"]:
        return "plaintext"
    return "share" if "mpc" in selection else "ciphertext"


def leaks(brief: dict[str, Any], graph: dict[str, Any]) -> list[str]:
    """Edges that hand a secret, in the clear, to somebody who must not learn it."""
    operator_of = {node["id"]: node["operated_by"] for node in graph["nodes"]}
    found: list[str] = []
    for edge in graph["edges"]:
        asset = _asset(brief, edge["asset"])
        if asset is None or edge["visibility"] not in REVEALING:
            continue
        if operator_of.get(edge["to"]) in asset["must_not_learn"]:
            found.append(f"{edge['asset']} -> {edge['to']} as {edge['visibility']}")
    return found


def has_trust_cycle(graph: dict[str, Any]) -> bool:
    """Whether the `trusts` relation between components contains a cycle.

    A verifier that trusts the host while the host trusts the verifier has assumed its own
    conclusion. That is a real design error, and it is visible as a cycle.
    """
    edges = {node["id"]: list(node.get("trusts", [])) for node in graph["nodes"]}
    state: dict[str, int] = {}

    def visit(node: str) -> bool:
        if state.get(node) == 1:
            return True
        if state.get(node) == 2:
            return False
        state[node] = 1
        for nxt in edges.get(node, []):
            if visit(nxt):
                return True
        state[node] = 2
        return False

    return any(visit(node) for node in edges)


# ---------------------------------------------------------------------------
# 6. Attack plan  (built before the matrix, which cites it as evidence)
# ---------------------------------------------------------------------------

#: How each property is attacked. `observe` reads what should be unreadable; `forge`
#: produces an accepted lie; `withhold` stops participating; `replace` swaps a value.
ATTACK_KINDS: dict[str, tuple[str, str]] = {
    "correctness": ("replace", "the returned result does not match the honest computation"),
    "privacy": ("observe", "a party recovers an input it must not learn"),
    "soundness": ("forge", "a false statement is accepted"),
    "zero_knowledge": ("observe", "the transcript reveals the witness"),
    "binding": ("replace", "a committed value is opened to a different one"),
    "availability": ("withhold", "one party stops responding and no result appears"),
}

#: The attack that exists whatever the brief says: the parties a primitive told you not to
#: worry about, worrying about each other.
COLLUSION = ("collude", "the parties the design assumed would not collude, do")


def attack_plan(brief: dict[str, Any], graph: dict[str, Any]) -> list[dict[str, Any]]:
    """One executable hypothesis per required property, plus one per assumption taken on.

    Every entry names what would be observed if the attack worked. An "attack" with no
    observable is a sentence, not an experiment.
    """
    required = required_properties(brief)
    plan: list[dict[str, Any]] = []
    for prop, needed in required.items():
        if not needed:
            continue
        kind, observable = ATTACK_KINDS[prop]
        plan.append(
            {
                "id": f"atk-{prop.replace('_', '-')}",
                "property": prop,
                "hypothesis": f"an adversary defeats {prop} at the component responsible for it",
                "experiment": {"kind": kind, "observable": observable, "expected": "rejected"},
            }
        )

    # Every trust the design took on is an attack somebody can run. Enumerating them from
    # the architecture is what stops the plan covering only what already works.
    seen = {entry["id"] for entry in plan}
    for node in graph["nodes"]:
        for primitive in node["primitives"]:
            for trusted in PRIMITIVES[primitive]["trusts"]:
                identifier = f"atk-trust-{primitive}-{trusted}".replace("_", "-")
                if identifier in seen:
                    continue
                seen.add(identifier)
                kind, observable = (
                    COLLUSION
                    if trusted == "non_collusion"
                    else (
                        "observe",
                        f"the trusted {trusted} reads what the design assumed it would not",
                    )
                )
                plan.append(
                    {
                        "id": identifier,
                        "property": "privacy" if required["privacy"] else "correctness",
                        "hypothesis": f"the {trusted} assumption behind {primitive} does not hold",
                        "experiment": {
                            "kind": kind,
                            "observable": observable,
                            "expected": "rejected",
                        },
                    }
                )

    # Five is the floor the design contract sets. Below it, a plan tends to cover only the
    # properties that already work.
    filler = 0
    while len(plan) < 5:
        filler += 1
        plan.append(
            {
                "id": f"atk-misuse-{filler}",
                "property": "correctness",
                "hypothesis": "an input arrives outside the range the design assumed",
                "experiment": {
                    "kind": "replace",
                    "observable": "the component accepts an input it should have refused",
                    "expected": "rejected",
                },
            }
        )
    return plan


# ---------------------------------------------------------------------------
# 7. Property matrix
# ---------------------------------------------------------------------------


def property_matrix(brief: dict[str, Any], graph: dict[str, Any]) -> dict[str, dict[str, str]]:
    """Each required property tied to the component providing it and the evidence for it.

    A property with no responsible component is a wish. A property whose component runs no
    primitive that provides it is a wish with a diagram.
    """
    required = required_properties(brief)
    by_property = {entry["property"]: entry["id"] for entry in attack_plan(brief, graph)}

    matrix: dict[str, dict[str, str]] = {}
    for prop, needed in required.items():
        if not needed:
            continue
        component = _responsible(graph, prop)
        matrix[prop] = {
            "asset": _protected_asset(brief, prop),
            "adversary": _adversary(brief, prop),
            "component": component,
            "evidence": by_property.get(prop, ""),
            "limitation": _limitation(graph, component, prop),
        }
    return matrix


def _responsible(graph: dict[str, Any], prop: str) -> str:
    for node in graph["nodes"]:
        for primitive in node["primitives"]:
            if prop in PRIMITIVES[primitive]["provides"]:
                return node["id"]
    return ""


def _protected_asset(brief: dict[str, Any], prop: str) -> str:
    if prop in ("privacy", "zero_knowledge"):
        for asset in brief["assets"]:
            if asset["must_not_learn"]:
                return asset["id"]
    if prop in ("soundness", "binding"):
        for asset in brief["assets"]:
            if asset["integrity_relied_on_by"]:
                return asset["id"]
    for asset in brief["assets"]:
        if asset.get("derived_from"):
            return asset["id"]
    return brief["assets"][0]["id"]


def _adversary(brief: dict[str, Any], prop: str) -> str:
    if prop in ("privacy", "zero_knowledge"):
        for asset in brief["assets"]:
            if asset["must_not_learn"]:
                return asset["must_not_learn"][0]
    if prop in ("soundness", "binding"):
        for asset in brief["assets"]:
            if asset["integrity_relied_on_by"]:
                return asset["owner"]
    return brief["actors"][0]["id"]


def _limitation(graph: dict[str, Any], component: str, prop: str) -> str:
    """What this property still rests on once the primitive has done its job."""
    for node in graph["nodes"]:
        if node["id"] != component:
            continue
        assumptions = [
            assumption
            for primitive in node["primitives"]
            for assumption in PRIMITIVES[primitive]["assumptions"]
        ]
        if assumptions:
            return f"{prop} holds only while {assumptions[0]}"
    return f"{prop} is not evaluated by a toy implementation"


# ---------------------------------------------------------------------------
# 8. Revision
# ---------------------------------------------------------------------------


def revise(brief: dict[str, Any]) -> dict[str, Any]:
    """Re-derive the whole design for a brief whose facts have changed.

    There is nothing clever here, and that is the finding. A design that was derived
    re-derives; a design that was decided once has to be decided again, by hand, and
    usually is not.
    """
    selection = select_primitive(brief)
    graph = architecture(brief, selection)
    return {
        "required": required_properties(brief),
        "selection": selection,
        "architecture": graph,
        "matrix": property_matrix(brief, graph),
    }
