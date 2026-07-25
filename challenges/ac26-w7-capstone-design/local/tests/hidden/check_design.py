"""Hidden tests. Run by /verify against a copy of the learner's file, never shown to them.

Every check runs over three populations:

  1. the six briefs in the repository, which a solution could in principle look up;
  2. eighteen variants of them, where a changed fact changes the right answer;
  3. twelve briefs generated from the per-deploy seed, which cannot be looked up at all.

The rules below are stated independently of `reference/design.py` — differently phrased,
differently structured — so that breaking the reference is caught here rather than agreed
with. Failure messages name the property that broke, never the expected value.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fixtures.generate import (  # noqa: E402
    ACTOR_TRUSTS,
    OPERATOR_ROLES,
    PRIMITIVES,
    PROPERTIES,
    all_briefs,
    synthetic_briefs,
    variants,
)

#: Every population a checkpoint is graded on.
Brief = dict[str, Any]

#: Edge types that hand the value over readably.
REVEALING = frozenset({"plaintext", "public"})

#: Attack kinds an experiment may declare. "happy-path" is deliberately absent: a plan made
#: of things that already work is not an attack plan.
ATTACK_KINDS = frozenset({"observe", "forge", "collude", "withhold", "replace"})

CLASSIFICATIONS = frozenset({"public", "private", "derived-public", "derived-private"})


def population(seed: str) -> list[Brief]:
    return [*all_briefs(), *variants(seed), *synthetic_briefs(seed)]


# ---------------------------------------------------------------------------
# The specification, restated
# ---------------------------------------------------------------------------


def _roles(brief: Brief) -> dict[str, str]:
    return {actor["id"]: actor["role"] for actor in brief["actors"]}


def _spec_requirements(brief: Brief) -> dict[str, bool]:
    """What this brief requires, derived here rather than taken from the submission."""
    roles = _roles(brief)
    assets = {asset["id"]: asset for asset in brief["assets"]}

    privacy = any(
        roles.get(other) in (frozenset({"input_provider"}) | OPERATOR_ROLES)
        for asset in brief["assets"]
        for other in asset["must_not_learn"]
    )

    soundness = False
    zero_knowledge = False
    for asset in brief["assets"]:
        outsiders = [p for p in asset["integrity_relied_on_by"] if p != asset["owner"]]
        if not outsiders:
            continue
        soundness = True
        for source_id in asset.get("derived_from", []):
            source = assets.get(source_id)
            if source and any(p in source["must_not_learn"] for p in outsiders):
                zero_knowledge = True

    return {
        "correctness": True,
        "privacy": privacy,
        "soundness": soundness,
        "zero_knowledge": zero_knowledge,
        "binding": bool(brief["constraints"].get("commit_then_reveal")),
        "availability": bool(brief["constraints"].get("must_complete_without_all_parties")),
    }


def _spec_admissible(primitive: str, brief: Brief) -> bool:
    hidden: set[str] = set()
    for asset in brief["assets"]:
        hidden.update(asset["must_not_learn"])
    for trusted in PRIMITIVES[primitive]["trusts"]:
        if trusted not in ACTOR_TRUSTS:
            continue
        if trusted == "operator":
            # Any party the brief hides nothing from can run it — an infrastructure role is
            # not required, or a lone party computing on its own data would count as
            # untrusted and be answered with cryptography.
            if not any(a["id"] not in hidden for a in brief["actors"]):
                return False
        if trusted == "key_holder":
            owners = {
                asset["owner"]
                for asset in brief["assets"]
                if asset["must_not_learn"] and not asset.get("derived_from")
            }
            if len(owners) != 1:
                return False
    return True


def _spec_covers(selection: list[str], required: dict[str, bool]) -> bool:
    provided: set[str] = set()
    for name in selection:
        provided.update(PRIMITIVES[name]["provides"])
    return all(prop in provided for prop, needed in required.items() if needed)


# ---------------------------------------------------------------------------
# Small helpers shared by the checks
# ---------------------------------------------------------------------------


def _call(module: Any, name: str, *args: Any) -> tuple[Any, str]:
    """Invoke one entry point, turning a raising submission into a failure rather than a crash."""
    try:
        return getattr(module, name)(*args), ""
    except AttributeError:
        return None, f"{name} is not defined"
    except Exception as error:  # noqa: BLE001 - a raising solution is a failing solution
        return None, f"{name} raised {type(error).__name__} on a valid brief"


def _label(brief: Brief) -> str:
    return brief["id"]


# ---------------------------------------------------------------------------
# 1. Assets
# ---------------------------------------------------------------------------


def check_assets(module: Any, seed: str) -> list[str]:
    failures: list[str] = []
    for brief in population(seed):
        classified, error = _call(module, "classify_assets", brief)
        if error:
            failures.append(f"{_label(brief)}: {error}")
            continue
        if not isinstance(classified, dict):
            failures.append(f"{_label(brief)}: classify_assets did not return a mapping")
            continue
        expected_ids = {asset["id"] for asset in brief["assets"]}
        if set(classified) != expected_ids:
            failures.append(f"{_label(brief)}: the classification does not cover every asset exactly once")
            continue
        for asset in brief["assets"]:
            entry = classified[asset["id"]]
            if not isinstance(entry, dict) or "owner" not in entry or "classification" not in entry:
                failures.append(f"{_label(brief)}: an asset entry is missing owner or classification")
                continue
            if entry["owner"] != asset["owner"]:
                failures.append(f"{_label(brief)}: an asset is attributed to the wrong owner")
            if entry["classification"] not in CLASSIFICATIONS:
                failures.append(f"{_label(brief)}: an asset carries a classification outside the vocabulary")
                continue
            secret = bool(asset["must_not_learn"])
            derived = bool(asset.get("derived_from"))
            if secret and "private" not in entry["classification"]:
                failures.append(f"{_label(brief)}: an asset somebody must not learn is not classified private")
            if not secret and "private" in entry["classification"]:
                failures.append(f"{_label(brief)}: an asset nobody is hidden from is classified private")
            if derived != entry["classification"].startswith("derived-"):
                failures.append(f"{_label(brief)}: a computed asset is not distinguished from an input")
    return failures


# ---------------------------------------------------------------------------
# 2. Requirements
# ---------------------------------------------------------------------------


def check_requirements(module: Any, seed: str) -> list[str]:
    failures: list[str] = []
    for brief in population(seed):
        required, error = _call(module, "required_properties", brief)
        if error:
            failures.append(f"{_label(brief)}: {error}")
            continue
        if not isinstance(required, dict) or set(required) != set(PROPERTIES):
            failures.append(f"{_label(brief)}: every property must get an answer, and only the known ones")
            continue
        if any(not isinstance(value, bool) for value in required.values()):
            failures.append(f"{_label(brief)}: a requirement is not a yes-or-no answer")
            continue
        expected = _spec_requirements(brief)
        for prop in PROPERTIES:
            if required[prop] == expected[prop]:
                continue
            direction = "claimed but not required by the brief" if required[prop] else "required by the brief but not claimed"
            failures.append(f"{_label(brief)}: {prop} is {direction}")
    return failures


# ---------------------------------------------------------------------------
# 3. Alternatives
# ---------------------------------------------------------------------------


def check_alternatives(module: Any, seed: str) -> list[str]:
    failures: list[str] = []
    for brief in population(seed):
        candidates, error = _call(module, "compare_alternatives", brief)
        if error:
            failures.append(f"{_label(brief)}: {error}")
            continue
        if not isinstance(candidates, list) or not candidates:
            failures.append(f"{_label(brief)}: compare_alternatives did not return candidates")
            continue

        named = {}
        for candidate in candidates:
            if not isinstance(candidate, dict) or "primitive" not in candidate:
                failures.append(f"{_label(brief)}: a candidate has no primitive")
                break
            named[candidate["primitive"]] = candidate
        else:
            if "none" not in named:
                failures.append(f"{_label(brief)}: the comparison omits the option that uses no cryptography")
            if len(named) < 3:
                failures.append(f"{_label(brief)}: fewer than three options were compared")
            for name, candidate in named.items():
                if name not in PRIMITIVES:
                    failures.append(f"{_label(brief)}: a candidate names an option that does not exist")
                    continue
                if set(candidate.get("satisfies") or []) != set(PRIMITIVES[name]["provides"]):
                    failures.append(f"{_label(brief)}: a candidate claims properties its option does not provide")
                if not candidate.get("assumptions"):
                    failures.append(f"{_label(brief)}: a candidate states no assumption")
                if not candidate.get("non_goals"):
                    failures.append(f"{_label(brief)}: a candidate states nothing it does not do")
                if candidate.get("admissible") != _spec_admissible(name, brief):
                    failures.append(
                        f"{_label(brief)}: a candidate's availability under this brief's trust "
                        "assumptions is wrong"
                    )
    return failures


# ---------------------------------------------------------------------------
# 4. Selection
# ---------------------------------------------------------------------------


def _selection_failures(brief: Brief, selection: Any) -> list[str]:
    """The four conditions a selection has to meet, for any brief."""
    label = _label(brief)
    if not isinstance(selection, (list, tuple)):
        return [f"{label}: the selection is not a list"]
    selection = list(selection)
    if len(set(selection)) != len(selection):
        return [f"{label}: the selection names the same option twice"]
    if any(name not in PRIMITIVES for name in selection):
        return [f"{label}: the selection names an option that does not exist"]

    required = _spec_requirements(brief)
    failures: list[str] = []

    # The rule that matters most: cryptography is what you reach for when the brief needs
    # it. When it does not, reaching for it anyway is the error being assessed.
    baseline_enough = _spec_covers(["none"], required) and _spec_admissible("none", brief)
    if baseline_enough and selection != ["none"]:
        failures.append(f"{label}: cryptography was selected for a brief that requires none")
        return failures

    if not _spec_covers(selection, required):
        failures.append(f"{label}: the selection does not cover every required property")
    for name in selection:
        if not _spec_admissible(name, brief):
            failures.append(f"{label}: the selection relies on a party this brief does not trust")
            break
    for name in selection:
        if _spec_covers([other for other in selection if other != name], required):
            failures.append(f"{label}: an option in the selection is doing nothing")
            break
    return failures


def check_selection(module: Any, seed: str) -> list[str]:
    failures: list[str] = []
    for brief in population(seed):
        selection, error = _call(module, "select_primitive", brief)
        if error:
            failures.append(f"{_label(brief)}: {error}")
            continue
        failures.extend(_selection_failures(brief, selection))
    return failures


# ---------------------------------------------------------------------------
# 5. Architecture
# ---------------------------------------------------------------------------


def _graph_failures(brief: Brief, selection: list[str], graph: Any) -> list[str]:
    label = _label(brief)
    if not isinstance(graph, dict) or "nodes" not in graph or "edges" not in graph:
        return [f"{label}: the architecture is not a graph of nodes and edges"]
    nodes, edges = graph["nodes"], graph["edges"]
    if not isinstance(nodes, list) or not isinstance(edges, list) or not nodes:
        return [f"{label}: the architecture has no components"]

    failures: list[str] = []
    actors = {actor["id"] for actor in brief["actors"]}
    operator_of: dict[str, str] = {}
    for node in nodes:
        if not isinstance(node, dict) or "id" not in node or "operated_by" not in node:
            return [f"{label}: a component has no id or nobody operating it"]
        if node["operated_by"] not in actors:
            failures.append(f"{label}: a component is operated by somebody the brief does not name")
        operator_of[node["id"]] = node["operated_by"]
    if len(operator_of) != len(nodes):
        failures.append(f"{label}: two components share an id")

    placed = {p for node in nodes for p in (node.get("primitives") or [])}
    if set(selection) - placed:
        failures.append(f"{label}: a selected option is not placed on any component")

    assets = {asset["id"]: asset for asset in brief["assets"]}
    carried: set[str] = set()
    for edge in edges:
        if not isinstance(edge, dict) or not {"from", "to", "asset", "visibility"} <= set(edge):
            return [f"{label}: an edge is missing an endpoint, an asset, or a type"]
        if edge["from"] not in operator_of or edge["to"] not in operator_of:
            failures.append(f"{label}: an edge points at a component that does not exist")
            continue
        asset = assets.get(edge["asset"])
        if asset is None:
            failures.append(f"{label}: an edge carries an asset the brief does not name")
            continue
        carried.add(edge["asset"])
        # The boundary check. An asset handed over readably to somebody it must be hidden
        # from is a leak, whatever the diagram says elsewhere.
        if edge["visibility"] in REVEALING and operator_of[edge["to"]] in asset["must_not_learn"]:
            failures.append(f"{label}: an asset reaches a party in the clear that must not learn it")

    if set(assets) - carried:
        failures.append(f"{label}: an asset in the brief appears nowhere in the data flow")

    # A component that trusts another, which trusts it back, has assumed its conclusion.
    trusts = {node["id"]: list(node.get("trusts") or []) for node in nodes}
    state: dict[str, int] = {}

    def cyclic(node: str) -> bool:
        if state.get(node) == 1:
            return True
        if state.get(node) == 2:
            return False
        state[node] = 1
        if any(cyclic(nxt) for nxt in trusts.get(node, [])):
            return True
        state[node] = 2
        return False

    if any(cyclic(node) for node in trusts):
        failures.append(f"{label}: the trust between components is circular")
    return failures


def check_architecture(module: Any, seed: str) -> list[str]:
    failures: list[str] = []
    for brief in population(seed):
        selection, error = _call(module, "select_primitive", brief)
        if error:
            failures.append(f"{_label(brief)}: {error}")
            continue
        graph, error = _call(module, "architecture", brief, selection)
        if error:
            failures.append(f"{_label(brief)}: {error}")
            continue
        failures.extend(_graph_failures(brief, list(selection or []), graph))
    return failures


# ---------------------------------------------------------------------------
# 6. Attack plan
# ---------------------------------------------------------------------------


def _plan_failures(brief: Brief, plan: Any) -> list[str]:
    label = _label(brief)
    if not isinstance(plan, list):
        return [f"{label}: the attack plan is not a list"]
    if len(plan) < 5:
        return [f"{label}: the attack plan has fewer hypotheses than the design contract requires"]

    failures: list[str] = []
    identifiers: set[str] = set()
    attacked: set[str] = set()
    for entry in plan:
        if not isinstance(entry, dict) or not {"id", "property", "hypothesis", "experiment"} <= set(entry):
            return [f"{label}: an attack is missing an id, a property, a hypothesis, or an experiment"]
        if entry["id"] in identifiers:
            failures.append(f"{label}: two attacks share an id")
        identifiers.add(entry["id"])
        if entry["property"] not in PROPERTIES:
            failures.append(f"{label}: an attack targets something that is not a property")
            continue
        attacked.add(entry["property"])
        experiment = entry["experiment"]
        if not isinstance(experiment, dict):
            failures.append(f"{label}: an attack has no experiment")
            continue
        if experiment.get("kind") not in ATTACK_KINDS:
            failures.append(f"{label}: an experiment does not describe an attack")
        if not str(experiment.get("observable") or "").strip():
            failures.append(f"{label}: an experiment names nothing that would be observed")
        if not str(experiment.get("expected") or "").strip():
            failures.append(f"{label}: an experiment states no expected outcome")

    for prop, needed in _spec_requirements(brief).items():
        if needed and prop not in attacked:
            failures.append(f"{label}: a required property is never attacked")
            break
    return failures


def check_attacks(module: Any, seed: str) -> list[str]:
    failures: list[str] = []
    for brief in population(seed):
        selection, error = _call(module, "select_primitive", brief)
        if error:
            failures.append(f"{_label(brief)}: {error}")
            continue
        graph, error = _call(module, "architecture", brief, selection)
        if error:
            failures.append(f"{_label(brief)}: {error}")
            continue
        plan, error = _call(module, "attack_plan", brief, graph)
        if error:
            failures.append(f"{_label(brief)}: {error}")
            continue
        failures.extend(_plan_failures(brief, plan))
    return failures


# ---------------------------------------------------------------------------
# 7. Property matrix
# ---------------------------------------------------------------------------


def _matrix_failures(brief: Brief, graph: Any, plan: Any, matrix: Any) -> list[str]:
    label = _label(brief)
    if not isinstance(matrix, dict):
        return [f"{label}: the property matrix is not a mapping"]

    required = _spec_requirements(brief)
    needed = {prop for prop, yes in required.items() if yes}
    if set(matrix) != needed:
        return [f"{label}: the matrix does not have exactly one row per required property"]

    primitives_at = {
        node["id"]: set(node.get("primitives") or []) for node in graph["nodes"] if isinstance(node, dict)
    }
    actors = {actor["id"] for actor in brief["actors"]}
    assets = {asset["id"] for asset in brief["assets"]}
    evidence_ids = {entry["id"] for entry in plan if isinstance(entry, dict) and "id" in entry}

    failures: list[str] = []
    for prop, row in matrix.items():
        if not isinstance(row, dict):
            failures.append(f"{label}: a matrix row is not a record")
            continue
        if row.get("asset") not in assets:
            failures.append(f"{label}: a matrix row protects an asset the brief does not name")
        if row.get("adversary") not in actors:
            failures.append(f"{label}: a matrix row names an adversary the brief does not name")
        component = row.get("component")
        if component not in primitives_at:
            failures.append(f"{label}: a required property has no component responsible for it")
            continue
        # The row that matters: a component can only be responsible for a property one of
        # its own options actually provides. Anything else is a claim delegated to something
        # that does not implement it.
        if not any(prop in PRIMITIVES[name]["provides"] for name in primitives_at[component]):
            failures.append(f"{label}: a property is delegated to a component that does not provide it")
        if row.get("evidence") not in evidence_ids:
            failures.append(f"{label}: a property cites no experiment that exists in the attack plan")
        if not str(row.get("limitation") or "").strip():
            failures.append(f"{label}: a property records no limitation")
    return failures


def check_matrix(module: Any, seed: str) -> list[str]:
    failures: list[str] = []
    for brief in population(seed):
        selection, error = _call(module, "select_primitive", brief)
        if error:
            failures.append(f"{_label(brief)}: {error}")
            continue
        graph, error = _call(module, "architecture", brief, selection)
        if error or not isinstance(graph, dict) or not isinstance(graph.get("nodes"), list):
            failures.append(f"{_label(brief)}: {error or 'the architecture is unusable'}")
            continue
        plan, error = _call(module, "attack_plan", brief, graph)
        if error or not isinstance(plan, list):
            failures.append(f"{_label(brief)}: {error or 'the attack plan is unusable'}")
            continue
        matrix, error = _call(module, "property_matrix", brief, graph)
        if error:
            failures.append(f"{_label(brief)}: {error}")
            continue
        failures.extend(_matrix_failures(brief, graph, plan, matrix))
    return failures


# ---------------------------------------------------------------------------
# 8. Revision
# ---------------------------------------------------------------------------


def check_revision(module: Any, seed: str) -> list[str]:
    """The scenario review: briefs whose facts moved, and briefs nobody has read.

    Nothing new is asked for. The same four artifacts have to come out right for a brief the
    design was not written against — which is exactly what a derived design does for free and
    a decided one cannot do at all.
    """
    failures: list[str] = []
    for brief in [*variants(seed), *synthetic_briefs(seed)]:
        revised, error = _call(module, "revise", brief)
        if error:
            failures.append(f"{_label(brief)}: {error}")
            continue
        if not isinstance(revised, dict):
            failures.append(f"{_label(brief)}: revise did not return a design")
            continue
        if set(revised) < {"required", "selection", "architecture", "matrix"}:
            failures.append(f"{_label(brief)}: the revised design is missing an artifact")
            continue

        expected = _spec_requirements(brief)
        if revised["required"] != expected:
            failures.append(f"{_label(brief)}: the revised requirements do not follow from the changed facts")
            continue
        failures.extend(_selection_failures(brief, revised["selection"]))
        graph = revised["architecture"]
        if not isinstance(graph, dict) or not isinstance(graph.get("nodes"), list):
            failures.append(f"{_label(brief)}: the revised architecture is unusable")
            continue
        failures.extend(_graph_failures(brief, list(revised["selection"] or []), graph))
        plan, error = _call(module, "attack_plan", brief, graph)
        if error or not isinstance(plan, list):
            failures.append(f"{_label(brief)}: {error or 'the revised attack plan is unusable'}")
            continue
        failures.extend(_matrix_failures(brief, graph, plan, revised["matrix"]))
    return failures


# ---------------------------------------------------------------------------


CHECKS = (
    check_assets,
    check_requirements,
    check_alternatives,
    check_selection,
    check_architecture,
    check_attacks,
    check_matrix,
    check_revision,
)


def run(module: Any, seed: str) -> list[str]:
    """Every checkpoint at once. Empty means the whole problem passes."""
    failures: list[str] = []
    for check in CHECKS:
        failures.extend(check(module, seed))
    return failures
