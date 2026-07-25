"""Reference implementation. Lives inside the image only; never mounted to the host.

Used by two things: the mutation suite (which breaks copies of this file and asserts
the hidden tests catch each break), and the `reference-test` CI target.

Everything below reads the pipeline definition. Nothing hardcodes a stage name, a
layer order, or an artifact name, because pipeline B renames every stage and inserts a
layer A does not have. The one place a name appears is `public_input` in the transcript
contract, and that is the definition's own vocabulary for the statement -- it comes out
of the challenge stage's `consumes` list, not out of thin air.
"""

from __future__ import annotations

SIZE_ORDER = (
    "none",
    "constant",
    "logarithmic",
    "polylogarithmic",
    "linear",
    "quasilinear",
    "superlinear",
)


def _rank(size_class: str) -> int:
    return SIZE_ORDER.index(size_class)


def _stage_with_layer(definition: dict, layer: str) -> dict | None:
    for stage in definition["stages"]:
        if stage["layer"] == layer:
            return stage
    return None


def _setup_artifacts(definition: dict) -> set[str]:
    return set(definition["setup"]["produces"])


# ---------------------------------------------------------------------------
# 1. The artifact graph
# ---------------------------------------------------------------------------


def artifact_graph(definition: dict) -> dict:
    """Every artifact, the stage that produced it, and every stage that consumes it.

    Setup artifacts are produced too. Leaving them out is what makes the setup material
    look like it came from nowhere, and it is the reason `dangling_artifacts` has to
    know about the setup at all.
    """
    graph: dict[str, dict] = {}

    def slot(artifact: str) -> dict:
        return graph.setdefault(artifact, {"produced_by": None, "consumed_by": []})

    for artifact in definition["setup"]["produces"]:
        slot(artifact)["produced_by"] = "setup"

    for stage in definition["stages"]:
        for artifact in stage["produces"]:
            slot(artifact)["produced_by"] = stage["name"]
        for artifact in stage["consumes"]:
            consumers = slot(artifact)["consumed_by"]
            if stage["name"] not in consumers:
                consumers.append(stage["name"])

    return graph


def dangling_artifacts(definition: dict) -> list[str]:
    """Artifacts a stage consumes that nothing in the pipeline produces.

    A stage reading an artifact with no producer is not a subtle soundness bug, it is a
    pipeline that does not typecheck -- and it is the first thing to rule out before
    reasoning about any of the layers below.
    """
    graph = artifact_graph(definition)
    return sorted(
        artifact for artifact, node in graph.items() if node["produced_by"] is None
    )


# ---------------------------------------------------------------------------
# 2. Per-layer contracts
# ---------------------------------------------------------------------------


def check_inputs(definition: dict, run: dict) -> list[str]:
    """input-boundary: what is public, what is secret, and whose setup material this is."""
    failures: list[str] = []
    public = set(run["public"])
    secret = set(run["secret"])

    # Two different checks, not one written twice. This one catches a run record that
    # contradicts itself; the `_prover_only` one below catches a genuine leak whatever
    # the record claims about it.
    both = sorted(public & secret)
    if both:
        failures.append(f"artifacts are both public and secret: {', '.join(both)}")

    # Everything the verifier consumes has to reach it.
    verifier = _stage_with_layer(definition, "verifier")
    if verifier is not None:
        missing = sorted(set(verifier["consumes"]) - public)
        if missing:
            failures.append(f"the verifier consumes artifacts it is not given: {', '.join(missing)}")

    # And nothing the prover holds privately may be in there. `secret` is derived from
    # the definition, so this catches a witness that was published under any name.
    leaked = sorted(public & _prover_only(definition))
    if leaked:
        failures.append(f"prover-only artifacts are public: {', '.join(leaked)}")

    expected_material = _setup_artifacts(definition)
    if set(run["setup_material"]) != expected_material:
        failures.append("the setup material is not the material this pipeline's setup produces")

    return failures


def _prover_only(definition: dict) -> set[str]:
    """Produced somewhere in the pipeline, consumed by the verifier nowhere."""
    verifier = _stage_with_layer(definition, "verifier")
    produced: set[str] = set(definition["setup"]["produces"])
    for stage in definition["stages"]:
        produced.update(stage["produces"])
    return produced - set(verifier["consumes"] if verifier else ()) - {"verdict"}


def check_constraints(definition: dict, run: dict) -> list[str]:
    """arithmetization: an accepting verdict requires every constraint satisfied.

    `run["commitment_ok"]` is deliberately not consulted. The commitment succeeding says
    the prover committed to something; it says nothing about whether what they committed
    to satisfies the constraint system. Reading it here is the misconception the
    checkpoint exists to catch.
    """
    unsatisfied = [entry["id"] for entry in run["constraints"] if not entry["satisfied"]]
    if unsatisfied and run["verdict"] == "accept":
        return [f"the run accepted with unsatisfied constraints: {', '.join(sorted(unsatisfied))}"]
    return []


def check_commitment(definition: dict, run: dict) -> list[str]:
    """commitment: the commitment binds everything the commit stage was given.

    An artifact the commit stage consumes but does not commit to is free for the prover
    to change afterwards. Setup material is excluded -- it is public and fixed before
    the run, so committing to it would bind nothing that is not already bound.
    """
    commit_stage = _stage_with_layer(definition, "commitment")
    if commit_stage is None:
        return []
    required = set(commit_stage["consumes"]) - _setup_artifacts(definition)
    missing = sorted(required - set(run["committed"]))
    if missing:
        return [f"the commitment does not bind: {', '.join(missing)}"]
    return []


def check_transcript(definition: dict, run: dict) -> list[str]:
    """transcript: everything the challenge depends on was absorbed before it was drawn.

    Derived from the challenge stage's own `consumes` list rather than from a list of
    names here. Both pipelines happen to absorb the statement and the commitment, but
    the contract is "whatever this stage consumes", so it survives a third pipeline that
    absorbs something else.
    """
    challenge_stage = _stage_with_layer(definition, "transcript")
    if challenge_stage is None:
        return []
    missing = sorted(set(challenge_stage["consumes"]) - set(run["absorbed_before_challenge"]))
    if missing:
        return [f"the challenge was drawn before absorbing: {', '.join(missing)}"]
    return []


def check_openings(definition: dict, run: dict) -> list[str]:
    """opening: every required opening was checked, and at least the minimum queries ran.

    Inclusion, not a count. Checking the right *number* of openings while checking the
    wrong ones is exactly as unsound as checking none.
    """
    failures: list[str] = []
    missing = sorted(set(run["openings_required"]) - set(run["openings_checked"]))
    if missing:
        failures.append(f"required openings were never checked: {', '.join(missing)}")
    if run["queries"] < definition["min_queries"]:
        failures.append(
            f"the run made {run['queries']} queries, below this pipeline's minimum of "
            f"{definition['min_queries']}"
        )
    return failures


def check_degree(definition: dict, run: dict) -> list[str]:
    """low-degree: if the pipeline has this stage, the run has to have run it.

    Pipeline A has no low-degree stage, so this contract is vacuous there. Applying it
    anyway would fail every honest A run.
    """
    if _stage_with_layer(definition, "low-degree") is None:
        return []
    if not run["low_degree_checked"]:
        return ["the low-degree stage was skipped"]
    return []


#: layer -> the contract that guards it. A layer with no entry (polynomial, verifier)
#: has no record-level contract in this toy model, and `first_fault` skips it.
CONTRACTS = {
    "input-boundary": check_inputs,
    "arithmetization": check_constraints,
    "commitment": check_commitment,
    "transcript": check_transcript,
    "opening": check_openings,
    "low-degree": check_degree,
}


# ---------------------------------------------------------------------------
# 3. Setup assumptions and cost claims
# ---------------------------------------------------------------------------


def assumption_matrix(definitions: dict) -> dict:
    """Per pipeline: the setup kind, whether it is transparent, and what it rests on.

    `transparent` comes from the declared setup kind. Deriving it from "the assumption
    list is empty" would be circular and, in this catalog, always wrong: both pipelines
    rest on assumptions, and one of them is transparent.
    """
    return {
        name: {
            "setup": definition["setup"]["kind"],
            "transparent": definition["setup"]["kind"] == "transparent",
            "assumptions": sorted(definition["setup"]["assumptions"]),
        }
        for name, definition in definitions.items()
    }


def unsupported_claims(definitions: dict, claims) -> list[str]:
    """The ids of claims the declared cost profiles and setups do not support.

    Three claim shapes:

      property        the named cost class equals what the profile declares
      comparison      one pipeline's class is cheaper than another's
      assumption_free the pipeline rests on nothing

    The last is never supported by anything in this catalog, and that is the point:
    "transparent" is a statement about the *setup*, not about the assumptions.
    """
    unsupported: list[str] = []
    for claim in claims:
        if claim["kind"] == "property":
            profile = definitions[claim["about"]]["cost"]
            supported = profile[claim["property"]] == claim["asserts"]
        elif claim["kind"] == "comparison":
            mine = definitions[claim["about"]]["cost"][claim["property"]]
            theirs = definitions[claim["against"]]["cost"][claim["property"]]
            supported = _rank(mine) < _rank(theirs)
        elif claim["kind"] == "assumption_free":
            supported = not definitions[claim["about"]]["setup"]["assumptions"]
        else:
            supported = False
        if not supported:
            unsupported.append(claim["id"])
    return sorted(unsupported)


# ---------------------------------------------------------------------------
# 4. Diagnosis and repair
# ---------------------------------------------------------------------------


def layer_order(definition: dict) -> list[str]:
    """The pipeline's layers, in stage order, without repeats.

    Read off the definition, never hardcoded. B's `low-degree` sits between `opening`
    and `verifier`, and a hardcoded A-shaped order would either drop it or misplace it.
    """
    order: list[str] = []
    for stage in definition["stages"]:
        if stage["layer"] not in order:
            order.append(stage["layer"])
    return order


def first_fault(definition: dict, run: dict) -> str | None:
    """The earliest layer whose contract fails, or None if the run is clean.

    Earliest, not worst and not last. One broken input boundary makes the openings look
    wrong too, and a diagnosis that points at the openings sends somebody to repair a
    stage that was doing its job.
    """
    for layer in layer_order(definition):
        contract = CONTRACTS.get(layer)
        if contract is None:
            continue
        if contract(definition, run):
            return layer
    return None


def repair(definition: dict, run: dict) -> dict:
    """A run with the first fault fixed, and nothing else touched.

    "Nothing else touched" is a real constraint, not politeness. Rebuilding a clean run
    from the definition would pass every contract while destroying the evidence, and
    flipping the verdict to reject would silence every contract at once without fixing
    anything. Each repair below changes the one field the fault damaged.
    """
    layer = first_fault(definition, run)
    if layer is None:
        return dict(run)

    fixed = dict(run)
    if layer == "input-boundary":
        if set(run["setup_material"]) != _setup_artifacts(definition):
            fixed["setup_material"] = sorted(_setup_artifacts(definition))
        else:
            fixed["public"] = sorted(set(run["public"]) - _prover_only(definition))
    elif layer == "arithmetization":
        # The constraint is unsatisfied. It cannot be made satisfied by editing the
        # record; the only honest repair is for the verifier to reject.
        fixed["verdict"] = "reject"
    elif layer == "commitment":
        commit_stage = _stage_with_layer(definition, "commitment")
        required = set(commit_stage["consumes"]) - _setup_artifacts(definition)
        fixed["committed"] = sorted(set(run["committed"]) | required)
    elif layer == "transcript":
        challenge_stage = _stage_with_layer(definition, "transcript")
        fixed["absorbed_before_challenge"] = sorted(
            set(run["absorbed_before_challenge"]) | set(challenge_stage["consumes"])
        )
    elif layer == "opening":
        if set(run["openings_required"]) - set(run["openings_checked"]):
            fixed["openings_checked"] = sorted(
                set(run["openings_checked"]) | set(run["openings_required"])
            )
        else:
            fixed["queries"] = definition["min_queries"]
    elif layer == "low-degree":
        fixed["low_degree_checked"] = True

    return fixed
