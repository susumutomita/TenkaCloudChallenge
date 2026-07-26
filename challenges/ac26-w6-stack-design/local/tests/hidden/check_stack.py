"""Hidden tests. Run by /verify against a copy of the learner's stack.py.

Nine phases behind eight checkpoints, because the multi-verify contract caps a problem at eight
scored checks and #244 asks for nine things. The two that share a checkpoint share it for a
reason rather than because they were adjacent: reading what a wire carries and knowing where the
primitive's guarantee stops are the same act of reading the typed graph, and a submission that
does one and not the other has read half of a diagram.

Four of the phases exist because of an answer that would otherwise look right:

  * **check_flow**. The requirement on an edge is computed from what was *declared* upstream,
    not from a recomputed ideal flow. A submission that propagates the premises forward through
    a broken graph reports every edge downstream of the break as wrong, which is the failure
    mode `check_first_failure` exists to punish, arriving one phase early.
  * **check_layers**. Every sound graph has three nodes the primitive vouches for, and every
    broken one has fewer. A submission that reads `layer` and stops gets the sound graphs
    exactly right and the broken ones exactly wrong, which is what "a primitive's assumption is
    not an end-to-end guarantee" costs when it is a slogan rather than a line of code.
  * **check_counterexample**. Graded by validating what came back, not by comparing it to a
    stored answer. There are many ways to lose a property while every component still passes,
    and a phase that accepted only one of them would be grading recall.
  * **check_repair**. The cheap wrong repair — authorise the node that opened the secret, or
    edit the promise it failed to keep — satisfies every contract in one move. Both are refused
    by checking that the policy and the obligations came back untouched, so a repair has to be
    a change to the deployment rather than to the requirement.

Every phase computes its own expected answer from the fixtures. Nothing is graded by asking the
submission a second question and checking that its two answers agree: a stack that is wrong the
same way twice would pass that, and being wrong consistently is the failure mode this whole
problem is about.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fixtures.generate import (  # noqa: E402
    BOUNDARY_CLASSES,
    CASES,
    COUNTEREXAMPLE_TARGETS,
    PROPERTIES,
    VARIANTS,
    broken,
    changes,
    constrained,
    first_broken,
    graph,
    load_bearing,
    local_checks_pass,
    preserved,
    properties_at_risk,
    repair_cost,
    selection_truth,
    underwritten,
    use_cases,
    violations,
)

#: Four draws, so a stack is never graded against one deployment. The field each case works in,
#: the statement a proof is about and the program a journal names all move with the label.
LABELS = ("h0", "h1", "h2", "h3")


class _Raised(str):
    """A failure that came out of the submission as an exception rather than as an answer."""


def _attempt(call, what: str):
    try:
        return call()
    except Exception as error:  # noqa: BLE001 - a stack that raises has not answered
        return _Raised(f"{what} raised {type(error).__name__}")


def _seeds(seed: str):
    for label in LABELS:
        yield f"{seed}:{label}"


def _every_graph(drawn: str):
    """The three sound architectures and the eleven broken ones, in a fixed order."""
    for case in CASES:
        yield f"the sound {case}", graph(drawn, case)
    for variant in VARIANTS:
        yield variant, broken(drawn, variant)


def _tupled(value):
    """Sequences as tuples, all the way down.

    A submission that built its answer out of lists gave the same answer as one that built it
    out of tuples. Refusing it would be grading a serialization dialect -- which is a real
    boundary class and is not this one.
    """
    if isinstance(value, dict):
        return {key: _tupled(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return tuple(_tupled(item) for item in value)
    return value


# ---------------------------------------------------------------------------
# 1. what every wire is carrying
# ---------------------------------------------------------------------------


def _flow_failures(module, drawn: str) -> list[str]:
    failures: list[str] = []
    for name, built in _every_graph(drawn):
        want = constrained(built)
        got = _attempt(lambda b=built: module.carried(b), "carried")
        if isinstance(got, _Raised):
            failures.append(got)
            continue
        if not isinstance(got, dict):
            failures.append("carried did not return a dict of edge id to requirement")
            continue
        if set(got) != set(want):
            missing = sorted(set(want) - set(got))
            extra = sorted(set(got) - set(want))
            failures.append(
                f"carried described {len(got)} edges of {name}, and the graph has {len(want)}"
                + (f"; nothing for {missing[0]}" if missing else "")
                + (f"; invented {extra[0]}" if extra else "")
            )
            continue
        for edge_id in sorted(want):
            mine, theirs = want[edge_id], got[edge_id]
            if not isinstance(theirs, dict):
                failures.append(f"carried gave {edge_id} of {name} something that is not a dict")
                break
            if set(theirs) != set(mine):
                loose = sorted(set(mine) - set(theirs))
                tight = sorted(set(theirs) - set(mine))
                failures.append(
                    f"carried pinned the wrong attributes on {edge_id} of {name}"
                    + (f"; left {loose[0]} free" if loose else "")
                    + (f"; pinned {tight[0]}, which that node may change" if tight else "")
                )
                break
            wrong = [
                attribute
                for attribute in sorted(mine)
                if _tupled(theirs[attribute]) != _tupled(mine[attribute])
            ]
            if wrong:
                failures.append(
                    f"carried required the wrong {wrong[0]} on {edge_id} of {name}"
                )
                break
    return failures


def check_flow(module, seed: str) -> list[str]:
    failures: list[str] = []
    for drawn in _seeds(seed):
        failures.extend(_flow_failures(module, drawn))
    return failures


# ---------------------------------------------------------------------------
# 2. where the primitive's guarantee stops
# ---------------------------------------------------------------------------


def _layer_failures(module, drawn: str) -> list[str]:
    failures: list[str] = []
    for name, built in _every_graph(drawn):
        want = underwritten(built)
        got = _attempt(lambda b=built: module.underwrites(b), "underwrites")
        if isinstance(got, _Raised):
            failures.append(got)
            continue
        if not isinstance(got, dict) or set(got) != set(want):
            failures.append(f"underwrites did not answer for every node of {name}")
            continue
        for node_id in sorted(want):
            mine = want[node_id]
            theirs = _tupled(got[node_id])
            if theirs == mine:
                continue
            if not mine:
                failures.append(
                    f"underwrites credited the primitive with {theirs} at {node_id} of {name}; "
                    "a guarantee whose assumption was not met is not a guarantee"
                )
            else:
                failures.append(
                    f"underwrites left {node_id} of {name} uncovered, and the primitive ran it"
                )
            break
    return failures


def check_layers(module, seed: str) -> list[str]:
    failures: list[str] = []
    for drawn in _seeds(seed):
        failures.extend(_layer_failures(module, drawn))
    return failures


# ---------------------------------------------------------------------------
# 3. which wire carries which property
# ---------------------------------------------------------------------------


def _property_failures(module, drawn: str) -> list[str]:
    failures: list[str] = []
    for name, built in _every_graph(drawn):
        want = load_bearing(built)
        got = _attempt(lambda b=built: module.property_map(b), "property_map")
        if isinstance(got, _Raised):
            failures.append(got)
            continue
        if not isinstance(got, dict) or set(got) != set(PROPERTIES):
            failures.append(
                "property_map did not answer for all five properties; the one no wire carries "
                "has an empty answer rather than no answer"
            )
            continue
        for prop in PROPERTIES:
            mine = want[prop]
            theirs = _tupled(got[prop])
            if theirs == mine:
                continue
            if not isinstance(theirs, tuple):
                failures.append(f"property_map gave {prop} something that is not a sequence")
                break
            if tuple(sorted(set(theirs))) != theirs:
                failures.append(f"property_map listed {prop} out of order or with a repeat")
                break
            invented = sorted(set(theirs) - set(mine))
            missed = sorted(set(mine) - set(theirs))
            if invented:
                failures.append(
                    f"property_map hung {prop} on {invented[0]} of {name}, which cannot break it"
                )
            else:
                failures.append(
                    f"property_map left {prop} off {missed[0]} of {name}, which carries it"
                )
            break
    return failures


def check_properties(module, seed: str) -> list[str]:
    failures: list[str] = []
    for drawn in _seeds(seed):
        failures.extend(_property_failures(module, drawn))
    return failures


# ---------------------------------------------------------------------------
# 4. every contract that broke
# ---------------------------------------------------------------------------


def _contract_failures(module, drawn: str) -> list[str]:
    failures: list[str] = []
    for name, built in _every_graph(drawn):
        want = violations(built)
        got = _attempt(lambda b=built: module.contract_violations(b), "contract_violations")
        if isinstance(got, _Raised):
            failures.append(got)
            continue
        if not isinstance(got, (list, tuple)) or any(
            not isinstance(pair, (list, tuple)) or len(pair) != 2 for pair in got
        ):
            failures.append("contract_violations did not return (edge, boundary class) pairs")
            continue
        reported = tuple(tuple(pair) for pair in got)
        if reported == want:
            continue
        if any(boundary not in BOUNDARY_CLASSES for _, boundary in reported):
            outside = next(b for _, b in reported if b not in BOUNDARY_CLASSES)
            failures.append(f"contract_violations named {outside!r}, which is not a boundary class")
            continue
        if sorted(set(reported)) != sorted(reported):
            failures.append("contract_violations reported the same breach more than once")
            continue
        if tuple(sorted(reported)) != reported:
            failures.append("contract_violations reported its findings out of order")
            continue
        missed = sorted(set(want) - set(reported))
        invented = sorted(set(reported) - set(want))
        if missed:
            failures.append(
                f"contract_violations missed {missed[0][1]} on {missed[0][0]} of {name}"
            )
        if invented:
            failures.append(
                f"contract_violations called {invented[0][0]} of {name} a "
                f"{invented[0][1]}; an audit that always finds something has not read anything"
            )
    return failures


def check_contracts(module, seed: str) -> list[str]:
    failures: list[str] = []
    for drawn in _seeds(seed):
        failures.extend(_contract_failures(module, drawn))
    return failures


# ---------------------------------------------------------------------------
# 5. which one broke first
# ---------------------------------------------------------------------------


def _first_failures(module, drawn: str) -> list[str]:
    failures: list[str] = []
    for name, built in _every_graph(drawn):
        want = first_broken(built)
        got = _attempt(lambda b=built: module.first_failure(b), "first_failure")
        if isinstance(got, _Raised):
            failures.append(got)
            continue
        if got == want:
            continue
        if want is None:
            failures.append(f"first_failure found a break in {name}, which has none")
        elif got is None:
            failures.append(f"first_failure found nothing wrong with {name}")
        else:
            failures.append(
                f"first_failure blamed {got} in {name}; a later symptom is where a repair "
                "does nothing"
            )
    return failures


def check_first_failure(module, seed: str) -> list[str]:
    failures: list[str] = []
    for drawn in _seeds(seed):
        failures.extend(_first_failures(module, drawn))
    return failures


# ---------------------------------------------------------------------------
# 6. one change, every component still content
# ---------------------------------------------------------------------------


def _counterexample_failures(module, drawn: str) -> list[str]:
    failures: list[str] = []
    for case, prop in COUNTEREXAMPLE_TARGETS:
        built = graph(drawn, case)
        got = _attempt(lambda b=built, p=prop: module.counterexample(b, p), "counterexample")
        if isinstance(got, _Raised):
            failures.append(got)
            continue
        if not isinstance(got, dict) or "edges" not in got or "nodes" not in got:
            failures.append(f"counterexample for {prop} in {case} is not an architecture")
            continue
        if not preserved(built, got):
            failures.append(
                f"counterexample for {prop} in {case} changed the architecture rather than "
                "the deployment: same nodes, same wires, same policy, same promises"
            )
            continue
        made = changes(built, got)
        if len(made) != 1:
            failures.append(
                f"counterexample for {prop} in {case} made {len(made)} changes, and one is the "
                "budget"
            )
            continue
        if not local_checks_pass(got):
            failures.append(
                f"counterexample for {prop} in {case} broke a component; the whole point is "
                "that every component is still content"
            )
            continue
        at_risk = properties_at_risk(got)
        if prop not in at_risk:
            failures.append(
                f"counterexample for {prop} in {case} cost {at_risk or 'nothing'} instead"
            )
    return failures


def check_counterexample(module, seed: str) -> list[str]:
    failures: list[str] = []
    for drawn in _seeds(seed):
        failures.extend(_counterexample_failures(module, drawn))
    return failures


# ---------------------------------------------------------------------------
# 7. one change back
# ---------------------------------------------------------------------------


def _repair_failures(module, drawn: str) -> list[str]:
    failures: list[str] = []
    for name, built in _every_graph(drawn):
        got = _attempt(lambda b=built: module.repair(b), "repair")
        if isinstance(got, _Raised):
            failures.append(got)
            continue
        if not isinstance(got, dict) or "edges" not in got or "nodes" not in got:
            failures.append(f"repair of {name} is not an architecture")
            continue
        if not preserved(built, got):
            failures.append(
                f"repair of {name} rewrote the policy or the promises; that is the deployment "
                "writing its own acceptance criteria"
            )
            continue
        left = violations(got)
        if left:
            failures.append(f"repair of {name} still breaks {left[0][1]} on {left[0][0]}")
            continue
        if not local_checks_pass(got):
            failures.append(
                f"repair of {name} left a component holding a shape it cannot consume; every "
                "boundary holding is half of being repaired"
            )
            continue
        made = changes(built, got)
        budget = repair_cost(built)
        if len(made) > budget:
            failures.append(
                f"repair of {name} cost {len(made)} changes and {budget} was available; a repair "
                "that costs more has fixed something on the way past"
            )
    return failures


def check_repair(module, seed: str) -> list[str]:
    failures: list[str] = []
    for drawn in _seeds(seed):
        failures.extend(_repair_failures(module, drawn))
    return failures


# ---------------------------------------------------------------------------
# 8. a stack for something nobody has built yet
# ---------------------------------------------------------------------------


def _selection_failures(module, drawn: str) -> list[str]:
    failures: list[str] = []
    for use_case in use_cases(drawn):
        want = selection_truth(use_case)
        got = _attempt(lambda u=use_case: module.select(u), "select")
        if isinstance(got, _Raised):
            failures.append(got)
            continue
        if not isinstance(got, dict) or set(got) != set(want):
            failures.append("select did not return the five fields a design has to name")
            continue
        for field in ("primitives", "public", "secret", "trust", "dominantCost"):
            mine, theirs = want[field], _tupled(got[field])
            if theirs == mine:
                continue
            if field == "primitives":
                failures.append(
                    f"select chose {theirs} where the brief needs {len(mine)} of them; the three "
                    "questions are answered independently"
                )
            else:
                failures.append(
                    f"select got {field} wrong on a brief it answered with {want['primitives']}"
                )
            break
    return failures


def check_selection(module, seed: str) -> list[str]:
    failures: list[str] = []
    for drawn in _seeds(seed):
        failures.extend(_selection_failures(module, drawn))
    return failures


# ---------------------------------------------------------------------------
# 9. a deployment nothing above has seen
# ---------------------------------------------------------------------------


def check_transfer(module, seed: str) -> list[str]:
    """Every phase above, on architectures drawn from a seed none of them ran on.

    The field each case works in, the statement the proof is about, the program the journal
    names and the six briefs all move with it. A stack with this deployment's field written into
    it clears every checkpoint until this one.
    """
    transferred = f"{seed}:transfer"
    return [
        *check_flow(module, transferred),
        *check_layers(module, transferred),
        *check_properties(module, transferred),
        *check_contracts(module, transferred),
        *check_first_failure(module, transferred),
        *check_counterexample(module, transferred),
        *check_repair(module, transferred),
        *check_selection(module, transferred),
    ]


PHASES = (
    check_flow,
    check_layers,
    check_properties,
    check_contracts,
    check_first_failure,
    check_counterexample,
    check_repair,
    check_selection,
    check_transfer,
)


def run(module, seed: str) -> list[str]:
    failures: list[str] = []
    for phase in PHASES:
        failures.extend(phase(module, seed))
    return failures
