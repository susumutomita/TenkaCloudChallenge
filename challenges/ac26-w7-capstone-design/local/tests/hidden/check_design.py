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
from copy import deepcopy
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

# Keep the grading vocabulary independent of the mutable participant helper table.
PRIMITIVES = deepcopy(PRIMITIVES)

#: Every population a checkpoint is graded on.
Brief = dict[str, Any]

#: Edge types that hand the value over readably.
REVEALING = frozenset({"plaintext", "public"})

#: Attack kinds an experiment may declare. "happy-path" is deliberately absent: a plan made
#: of things that already work is not an attack plan.
ATTACK_KINDS = frozenset({"observe", "forge", "collude", "withhold", "replace"})

VISIBILITIES = frozenset({"plaintext", "ciphertext", "share", "proof", "public"})

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
        return getattr(module, name)(*deepcopy(args)), ""
    except AttributeError:
        return None, f"{name} is not defined"
    except Exception as error:  # noqa: BLE001 - a raising solution is a failing solution
        return None, f"{name} raised {type(error).__name__} on a valid brief"


def _label(brief: Brief) -> str:
    return "brief"


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


def _strings(value: Any, *, unique: bool = True) -> bool:
    return (isinstance(value, (list, tuple))
            and all(isinstance(item, str) and item.strip() for item in value)
            and (not unique or len(set(value)) == len(value)))


def check_alternatives(module: Any, seed: str) -> list[str]:
    failures: list[str] = []
    for brief in population(seed):
        candidates, error = _call(module, "compare_alternatives", brief)
        if error:
            failures.append(error)
            continue
        if not isinstance(candidates, list) or len(candidates) != len(PRIMITIVES):
            failures.append("comparison must contain every option exactly once")
            continue
        named = {}
        for candidate in candidates:
            if not isinstance(candidate, dict) or not isinstance(candidate.get("primitive"), str):
                failures.append("a candidate has no primitive name")
                break
            name = candidate["primitive"]
            if name in named or name not in PRIMITIVES:
                failures.append("comparison contains a duplicate or unknown option")
                break
            named[name] = candidate
            for field, table_field in (("satisfies", "provides"), ("assumptions", "assumptions"), ("non_goals", "non_goals")):
                value = candidate.get(field)
                if not _strings(value) or set(value) != set(PRIMITIVES[name][table_field]):
                    failures.append(f"candidate {field} does not match the supplied option table")
            if type(candidate.get("admissible")) is not bool or candidate["admissible"] != _spec_admissible(name, brief):
                failures.append("candidate admissibility does not follow from the brief")
        if set(named) != set(PRIMITIVES):
            failures.append("comparison must contain every option exactly once")
    return failures


# ---------------------------------------------------------------------------
# 4. Selection
# ---------------------------------------------------------------------------


def _selection_failures(brief: Brief, selection: Any) -> list[str]:
    """The four conditions a selection has to meet, for any brief."""
    label = _label(brief)
    if not _strings(selection):
        return [f"{label}: selection must be a sequence of unique option names"]
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
    selection_errors = _selection_failures(brief, selection)
    if selection_errors:
        return selection_errors
    if not isinstance(graph, dict) or not isinstance(graph.get("nodes"), list) or not isinstance(graph.get("edges"), list):
        return ["architecture needs node and edge lists"]
    nodes, edges = graph["nodes"], graph["edges"]
    if not nodes:
        return ["architecture needs at least one component"]
    actors = {actor["id"] for actor in brief["actors"]}
    operator_of: dict[str, str] = {}
    placed: set[str] = set()
    for node in nodes:
        if not isinstance(node, dict) or not isinstance(node.get("id"), str) or not node["id"].strip():
            return ["component needs a nonempty string id"]
        if node["id"] in operator_of:
            return ["two components share an id"]
        if not isinstance(node.get("operated_by"), str) or node["operated_by"] not in actors:
            return ["component operator is not an actor in the brief"]
        if not _strings(node.get("primitives")) or any(name not in PRIMITIVES for name in node["primitives"]):
            return ["component primitives must be known, unique option names"]
        if not _strings(node.get("trusts")):
            return ["component trusts must be a sequence of unique component ids"]
        operator_of[node["id"]] = node["operated_by"]
        placed.update(node["primitives"])
    if placed != set(selection):
        return ["placed options must match the selection, without adding or omitting one"]
    trusts = {node["id"]: node["trusts"] for node in nodes}
    if any(target not in operator_of for targets in trusts.values() for target in targets):
        return ["a trust points to a component that does not exist"]
    assets = {asset["id"]: asset for asset in brief["assets"]}
    carried: set[str] = set()
    for edge in edges:
        if not isinstance(edge, dict) or any(not isinstance(edge.get(key), str) for key in ("from", "to", "asset", "visibility")):
            return ["edge needs string endpoints, asset and visibility"]
        if edge["from"] not in operator_of or edge["to"] not in operator_of:
            return ["edge points to a component that does not exist"]
        if edge["asset"] not in assets:
            return ["edge carries an asset outside the brief"]
        if edge["visibility"] not in VISIBILITIES:
            return ["edge visibility is outside the five documented types"]
        asset = assets[edge["asset"]]
        carried.add(edge["asset"])
        if edge["visibility"] in REVEALING and operator_of[edge["to"]] in asset["must_not_learn"]:
            return ["an asset reaches a forbidden reader in readable form"]
    if set(assets) != carried:
        return ["every asset must appear in the data flow"]
    state: dict[str, int] = {}
    def cyclic(node: str) -> bool:
        if state.get(node) == 1:
            return True
        if state.get(node) == 2:
            return False
        state[node] = 1
        if any(cyclic(target) for target in trusts[node]):
            return True
        state[node] = 2
        return False
    return ["component trust is circular"] if any(cyclic(node) for node in trusts) else []


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
        failures.extend(_graph_failures(brief, selection, graph))
    return failures


# ---------------------------------------------------------------------------
# 6. Attack plan
# ---------------------------------------------------------------------------


def _plan_failures(brief: Brief, graph: dict, plan: Any) -> list[str]:
    if not isinstance(plan, list) or len(plan) < 5:
        return ["attack plan must contain at least five entries"]
    required_trusts = {(primitive, trusted) for node in graph["nodes"]
                      for primitive in node["primitives"] for trusted in PRIMITIVES[primitive]["trusts"]}
    identifiers: set[str] = set()
    attacked: set[str] = set()
    covered_trusts: set[tuple[str, str]] = set()
    for entry in plan:
        if not isinstance(entry, dict) or not isinstance(entry.get("id"), str) or not entry["id"].strip():
            return ["attack needs a nonempty string id"]
        if entry["id"] in identifiers:
            return ["two attacks share an id"]
        identifiers.add(entry["id"])
        if not isinstance(entry.get("property"), str) or entry["property"] not in PROPERTIES:
            return ["attack property is outside the supplied vocabulary"]
        attacked.add(entry["property"])
        if not isinstance(entry.get("hypothesis"), str) or not entry["hypothesis"].strip():
            return ["attack needs a nonempty hypothesis"]
        experiment = entry.get("experiment")
        if not isinstance(experiment, dict) or not isinstance(experiment.get("kind"), str) or experiment["kind"] not in ATTACK_KINDS:
            return ["experiment needs one of the five documented attack kinds"]
        if any(not isinstance(experiment.get(key), str) or not experiment[key].strip() for key in ("observable", "expected")):
            return ["experiment needs nonempty observable and expected text"]
        if "assumption" in entry:
            assumption = entry["assumption"]
            if (not isinstance(assumption, dict) or not isinstance(assumption.get("primitive"), str)
                    or not isinstance(assumption.get("trust"), str)):
                return ["assumption needs primitive and trust names"]
            pair = (assumption["primitive"], assumption["trust"])
            if pair not in required_trusts:
                return ["attack cites an assumption not taken on by this architecture"]
            covered_trusts.add(pair)
    if any(needed and prop not in attacked for prop, needed in _spec_requirements(brief).items()):
        return ["a required property has no attack"]
    if covered_trusts != required_trusts:
        return ["every placed option's trust assumption needs an attack"]
    return []


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
        graph_errors = _graph_failures(brief, selection, graph)
        if graph_errors:
            failures.extend(graph_errors)
            continue
        plan, error = _call(module, "attack_plan", brief, graph)
        if error:
            failures.append(f"{_label(brief)}: {error}")
            continue
        failures.extend(_plan_failures(brief, graph, plan))
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
    evidence_properties = {entry["id"]: entry["property"] for entry in plan}

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
        if evidence_properties.get(row.get("evidence")) != prop:
            failures.append(f"{label}: evidence must name an attack on the same property")
        if not isinstance(row.get("limitation"), str) or not row["limitation"].strip():
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
        graph_errors = _graph_failures(brief, selection, graph)
        if graph_errors:
            failures.extend(graph_errors)
            continue
        plan, error = _call(module, "attack_plan", brief, graph)
        if error or not isinstance(plan, list):
            failures.append(f"{_label(brief)}: {error or 'the attack plan is unusable'}")
            continue
        plan_errors = _plan_failures(brief, graph, plan)
        if plan_errors:
            failures.extend(plan_errors)
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
        if not {"required", "selection", "architecture", "matrix"} <= set(revised):
            failures.append(f"{_label(brief)}: the revised design is missing an artifact")
            continue

        expected = _spec_requirements(brief)
        if (not isinstance(revised["required"], dict)
                or any(type(value) is not bool for value in revised["required"].values())
                or revised["required"] != expected):
            failures.append(f"{_label(brief)}: the revised requirements do not follow from the changed facts")
            continue
        selection_errors = _selection_failures(brief, revised["selection"])
        if selection_errors:
            failures.extend(selection_errors)
            continue
        graph = revised["architecture"]
        if not isinstance(graph, dict) or not isinstance(graph.get("nodes"), list):
            failures.append(f"{_label(brief)}: the revised architecture is unusable")
            continue
        graph_errors = _graph_failures(brief, revised["selection"], graph)
        if graph_errors:
            failures.extend(graph_errors)
            continue
        plan, error = _call(module, "attack_plan", brief, graph)
        if error or not isinstance(plan, list):
            failures.append(f"{_label(brief)}: {error or 'the revised attack plan is unusable'}")
            continue
        plan_errors = _plan_failures(brief, graph, plan)
        if plan_errors:
            failures.extend(plan_errors)
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
