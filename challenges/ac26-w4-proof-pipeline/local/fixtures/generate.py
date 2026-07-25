"""Two toy proof pipelines, the runs that flow through them, and the faults injected into those runs.

Neither pipeline is a real scheme, and neither is named after one. `A` is
circuit-oriented with a per-circuit trusted setup; `B` is trace-oriented and
transparent. Both are stripped to the only thing this problem is about: which stage
produces which artifact, which stage consumes it, and what each stage's contract is.

Nothing here computes a proof. A "run" is a record of what a prover and a verifier
*claim* to have done -- what was committed, what was absorbed before the challenge was
drawn, which openings were checked. That is deliberate. The skill being trained is
reading a pipeline's artifact flow and finding the first stage whose contract broke,
and a real prover would bury that under arithmetic that is not the lesson.

The two pipelines differ in stage count, stage names, and layer list on purpose. B has
a `low-degree` layer that A does not, and it sits between `opening` and `verifier`. An
implementation that hardcodes A's layer order gets B wrong.
"""

from __future__ import annotations

import hashlib

# ---------------------------------------------------------------------------
# Pipelines
# ---------------------------------------------------------------------------

PIPELINE_A: dict = {
    "id": "A",
    "family": "circuit-succinct",
    "setup": {
        "kind": "trusted",
        "produces": ["proving_key", "verifying_key"],
        # Transparent does not mean assumption-free, and trusted does not mean
        # assumption-heavy. Both lists are non-empty; they are different assumptions.
        "assumptions": ["structured-reference-string-not-retained", "pairing-hardness"],
    },
    "min_queries": 1,
    "stages": [
        {
            "name": "statement",
            "layer": "input-boundary",
            "consumes": [],
            "produces": ["public_input"],
        },
        {"name": "assign", "layer": "input-boundary", "consumes": [], "produces": ["witness"]},
        {
            "name": "arithmetize",
            "layer": "arithmetization",
            "consumes": ["public_input", "witness"],
            "produces": ["constraint_system", "assignment"],
        },
        {
            "name": "encode",
            "layer": "polynomial",
            "consumes": ["constraint_system", "assignment"],
            "produces": ["constraint_poly"],
        },
        {
            "name": "commit",
            "layer": "commitment",
            "consumes": ["assignment", "constraint_poly", "proving_key"],
            "produces": ["commitment"],
        },
        {
            "name": "challenge",
            "layer": "transcript",
            "consumes": ["public_input", "commitment"],
            "produces": ["challenge"],
        },
        {
            "name": "open",
            "layer": "opening",
            "consumes": ["commitment", "challenge", "assignment", "constraint_poly"],
            "produces": ["opening"],
        },
        {
            "name": "verify",
            "layer": "verifier",
            "consumes": ["public_input", "commitment", "challenge", "opening", "verifying_key"],
            "produces": ["verdict"],
        },
    ],
    "cost": {
        "proof_size": "constant",
        "verifier_time": "constant",
        "prover_time": "superlinear",
        "setup_cost": "per-circuit",
    },
}

PIPELINE_B: dict = {
    "id": "B",
    "family": "trace-transparent",
    "setup": {
        "kind": "transparent",
        "produces": ["public_parameters"],
        "assumptions": ["collision-resistant-hash", "random-oracle"],
    },
    "min_queries": 8,
    "stages": [
        {
            "name": "statement",
            "layer": "input-boundary",
            "consumes": [],
            "produces": ["public_input"],
        },
        {"name": "execute", "layer": "input-boundary", "consumes": [], "produces": ["witness"]},
        {
            "name": "trace",
            "layer": "arithmetization",
            "consumes": ["public_input", "witness"],
            "produces": ["trace_table", "air"],
        },
        {
            "name": "extend",
            "layer": "polynomial",
            "consumes": ["trace_table", "air"],
            "produces": ["trace_poly", "composition_poly"],
        },
        {
            "name": "commit",
            "layer": "commitment",
            "consumes": ["trace_poly", "composition_poly", "public_parameters"],
            "produces": ["commitment"],
        },
        {
            "name": "challenge",
            "layer": "transcript",
            "consumes": ["public_input", "commitment"],
            "produces": ["challenge"],
        },
        {
            "name": "query",
            "layer": "opening",
            "consumes": ["commitment", "challenge", "trace_poly", "composition_poly"],
            "produces": ["opening"],
        },
        {
            "name": "fold",
            "layer": "low-degree",
            "consumes": ["opening", "challenge"],
            "produces": ["degree_certificate"],
        },
        {
            "name": "verify",
            "layer": "verifier",
            "consumes": [
                "public_input",
                "commitment",
                "challenge",
                "opening",
                "degree_certificate",
                "public_parameters",
            ],
            "produces": ["verdict"],
        },
    ],
    "cost": {
        "proof_size": "polylogarithmic",
        "verifier_time": "polylogarithmic",
        "prover_time": "quasilinear",
        "setup_cost": "none",
    },
}

PIPELINES: dict[str, dict] = {"A": PIPELINE_A, "B": PIPELINE_B}


def _deepcopy(value):
    if isinstance(value, dict):
        return {key: _deepcopy(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_deepcopy(item) for item in value]
    return value


def pipeline(name: str) -> dict:
    """The definition, by id. A copy, so a learner mutating one cannot poison the next call."""
    return _deepcopy(PIPELINES[name])


def stage_with_layer(definition: dict, layer: str) -> dict | None:
    for stage in definition["stages"]:
        if stage["layer"] == layer:
            return stage
    return None


def non_setup_inputs(definition: dict, stage_name: str) -> list[str]:
    """What a stage consumes, minus anything the setup produced."""
    setup = set(definition["setup"]["produces"])
    for stage in definition["stages"]:
        if stage["name"] == stage_name:
            return [artifact for artifact in stage["consumes"] if artifact not in setup]
    return []


def constraint_artifact(definition: dict) -> str:
    """The artifact carrying constraint satisfaction into the commitment.

    Named by role rather than by string literal, because A calls it `constraint_poly`
    and B calls it `composition_poly`.
    """
    polynomial_stage = stage_with_layer(definition, "polynomial")
    assert polynomial_stage is not None
    return polynomial_stage["produces"][-1]


# ---------------------------------------------------------------------------
# Runs
# ---------------------------------------------------------------------------


def _stream(seed: str, label: str) -> list[int]:
    out: list[int] = []
    counter = 0
    while len(out) < 64:
        out.extend(hashlib.sha256(f"{seed}:{label}:{counter}".encode()).digest())
        counter += 1
    return out


def _pick(s: list[int], i: int, low: int, high: int) -> int:
    return low + ((s[i % 60] * 256 + s[(i + 1) % 60]) % (high - low + 1))


def _secret_artifacts(definition: dict) -> set[str]:
    """Everything a stage produces that the verifier never consumes.

    Derived from the definition rather than listed, so it stays right for a pipeline
    whose stage list changes.
    """
    verifier = stage_with_layer(definition, "verifier")
    # The setup's output counts. A's setup produces two keys and the verifier consumes
    # one of them; the proving key is the prover's, and a run that published it would
    # be leaking just as surely as one that published the witness.
    produced: set[str] = set(definition["setup"]["produces"])
    for stage in definition["stages"]:
        produced.update(stage["produces"])
    consumed_by_verifier = set(verifier["consumes"]) if verifier else set()
    return produced - consumed_by_verifier - {"verdict"}


def honest_run(seed: str, name: str, label: str = "public") -> dict:
    """A run that satisfies every stage contract in the pipeline.

    `commitment_ok` is True in *every* run this module produces, honest or faulted.
    That is the point of the `constraints` checkpoint: the commitment succeeding is a
    statement about the commitment, and about nothing else in the pipeline.
    """
    definition = PIPELINES[name]
    s = _stream(seed, f"run:{name}:{label}")
    constraint_count = _pick(s, 0, 3, 6)
    queries = definition["min_queries"] + _pick(s, 4, 0, 7)

    commit_stage = stage_with_layer(definition, "commitment")
    challenge_stage = stage_with_layer(definition, "transcript")
    open_stage = stage_with_layer(definition, "opening")
    assert commit_stage and challenge_stage and open_stage

    # An opening is a polynomial-shaped artifact evaluated at the challenge point. The
    # commitment and the challenge are inputs to the opening, not things opened.
    opened = non_setup_inputs(definition, open_stage["name"])
    required = sorted(
        f"{artifact}@z" for artifact in opened if artifact.endswith(("poly", "assignment"))
    )
    has_low_degree = stage_with_layer(definition, "low-degree") is not None
    verifier = stage_with_layer(definition, "verifier")
    assert verifier is not None

    return {
        "pipeline": name,
        "label": label,
        # What reaches the verifier -- exactly its inputs, no more. Note that A's setup
        # produces two keys and only one of them is here: the proving key is the
        # prover's, and a run that published it would be leaking.
        "public": sorted(verifier["consumes"]),
        # What must not.
        "secret": sorted(_secret_artifacts(definition)),
        "setup_material": list(definition["setup"]["produces"]),
        "constraints": [{"id": f"c{index}", "satisfied": True} for index in range(constraint_count)],
        "commitment_ok": True,
        "committed": sorted(non_setup_inputs(definition, commit_stage["name"])),
        "absorbed_before_challenge": sorted(challenge_stage["consumes"]),
        "openings_required": required,
        "openings_checked": list(required),
        "queries": queries,
        "low_degree_checked": has_low_degree,
        "verdict": "accept",
    }


# ---------------------------------------------------------------------------
# Faults
# ---------------------------------------------------------------------------
#
# Each fault writes exactly ONE field of an honest run and breaks exactly one layer's
# contract.
#
#   `damages`      the field the fault writes.
#   `repair_field` the field a correct repair may change, and the only one -- this is
#                  what makes the `diagnose` checkpoint's minimality rule well-defined,
#                  ruling out both "return an honest run" and "reject everything".
#
# They are the same field for eight of the nine, and different for exactly one. An
# unsatisfied constraint cannot be made satisfied by editing the record, so the damage
# is in `constraints` while the only honest repair is in `verdict`. That asymmetry is
# the point of the fault, not an accident of the data model.

FAULTS: dict[str, dict] = {
    "witness-is-public": {
        "layer": "input-boundary",
        "damages": "public",
        "repair_field": "public",
    },
    "setup-material-mismatch": {
        "layer": "input-boundary",
        "damages": "setup_material",
        "repair_field": "setup_material",
    },
    "accepts-unsatisfied-constraint": {
        "layer": "arithmetization",
        "damages": "constraints",
        "repair_field": "verdict",
    },
    "constraint-artifact-not-committed": {
        "layer": "commitment",
        "damages": "committed",
        "repair_field": "committed",
    },
    "challenge-before-commitment": {
        "layer": "transcript",
        "damages": "absorbed_before_challenge",
        "repair_field": "absorbed_before_challenge",
    },
    "statement-outside-transcript": {
        "layer": "transcript",
        "damages": "absorbed_before_challenge",
        "repair_field": "absorbed_before_challenge",
    },
    "opening-never-checked": {
        "layer": "opening",
        "damages": "openings_checked",
        "repair_field": "openings_checked",
    },
    "no-queries-at-all": {"layer": "opening", "damages": "queries", "repair_field": "queries"},
    "low-degree-bypassed": {
        "layer": "low-degree",
        "damages": "low_degree_checked",
        "repair_field": "low_degree_checked",
    },
}


def applicable_faults(name: str) -> tuple[str, ...]:
    """Faults that exist in this pipeline. `low-degree-bypassed` only applies to B."""
    layers = {stage["layer"] for stage in PIPELINES[name]["stages"]}
    return tuple(fault for fault, spec in FAULTS.items() if spec["layer"] in layers)


def faulted_run(seed: str, name: str, fault: str, label: str = "public") -> dict:
    """An honest run with exactly one field damaged.

    `verdict` stays "accept" for every fault except the one about the verdict itself.
    A pipeline that rejected would be doing its job; the interesting runs are the ones
    that accepted anyway.
    """
    if fault not in applicable_faults(name):
        raise ValueError(f"{fault} does not apply to pipeline {name}")
    run = honest_run(seed, name, f"{label}:{fault}")
    definition = PIPELINES[name]

    if fault == "witness-is-public":
        run["public"] = sorted({*run["public"], "witness"})
    elif fault == "setup-material-mismatch":
        # Material from the *other* pipeline's setup. The commit stage consumes it
        # happily, and nothing downstream notices.
        other = "B" if name == "A" else "A"
        run["setup_material"] = list(PIPELINES[other]["setup"]["produces"])
    elif fault == "accepts-unsatisfied-constraint":
        run["constraints"] = [dict(entry) for entry in run["constraints"]]
        run["constraints"][len(run["constraints"]) // 2]["satisfied"] = False
        # The verdict stays "accept". That IS the fault, and the repair is to reject:
        # you cannot make an unsatisfied constraint satisfied by editing the record.
    elif fault == "constraint-artifact-not-committed":
        dropped = constraint_artifact(definition)
        run["committed"] = [artifact for artifact in run["committed"] if artifact != dropped]
    elif fault == "challenge-before-commitment":
        run["absorbed_before_challenge"] = [
            artifact for artifact in run["absorbed_before_challenge"] if artifact != "commitment"
        ]
    elif fault == "statement-outside-transcript":
        run["absorbed_before_challenge"] = [
            artifact for artifact in run["absorbed_before_challenge"] if artifact != "public_input"
        ]
    elif fault == "opening-never-checked":
        run["openings_checked"] = run["openings_checked"][1:]
    elif fault == "no-queries-at-all":
        run["queries"] = 0
    elif fault == "low-degree-bypassed":
        run["low_degree_checked"] = False

    return run


# ---------------------------------------------------------------------------
# Cost and assumption claims
# ---------------------------------------------------------------------------

#: Cheapest first. `unsupported_claims` compares ranks, so "smaller" is a real relation
#: rather than a vibe.
SIZE_ORDER = (
    "none",
    "constant",
    "logarithmic",
    "polylogarithmic",
    "linear",
    "quasilinear",
    "superlinear",
)


def rank(size_class: str) -> int:
    return SIZE_ORDER.index(size_class)


#: The claims a participant filters. Four are false, and each false one is a named
#: misconception rather than an arbitrary wrong answer.
CLAIMS: tuple[dict, ...] = (
    {
        "id": "claim-a-proof-is-constant-size",
        "kind": "property",
        "about": "A",
        "property": "proof_size",
        "asserts": "constant",
        "text": "A's proof is constant size.",
    },
    {
        "id": "claim-a-prover-is-constant-time",
        "kind": "property",
        "about": "A",
        "property": "prover_time",
        "asserts": "constant",
        "text": "A is succinct, so A's prover is fast.",
    },
    {
        "id": "claim-a-verifier-is-constant-time",
        "kind": "property",
        "about": "A",
        "property": "verifier_time",
        "asserts": "constant",
        "text": "A's verifier runs in constant time.",
    },
    {
        "id": "claim-b-needs-no-setup",
        "kind": "property",
        "about": "B",
        "property": "setup_cost",
        "asserts": "none",
        "text": "B needs no per-circuit setup.",
    },
    {
        "id": "claim-b-is-assumption-free",
        "kind": "assumption_free",
        "about": "B",
        "text": "B is transparent, so B rests on no cryptographic assumption.",
    },
    {
        "id": "claim-b-proof-is-smaller",
        "kind": "comparison",
        "about": "B",
        "against": "A",
        "property": "proof_size",
        "asserts": "smaller",
        "text": "B's proofs are smaller than A's.",
    },
    {
        "id": "claim-b-prover-is-cheaper",
        "kind": "comparison",
        "about": "B",
        "against": "A",
        "property": "prover_time",
        "asserts": "smaller",
        "text": "B's prover is cheaper than A's.",
    },
    {
        "id": "claim-a-is-assumption-free",
        "kind": "assumption_free",
        "about": "A",
        "text": "A's setup is a one-time ceremony, so A rests on no cryptographic assumption.",
    },
)

#: Ground truth, kept here so the hidden tests never grade a claim against the same
#: code the learner wrote.
UNSUPPORTED_CLAIMS: tuple[str, ...] = (
    "claim-a-is-assumption-free",
    "claim-a-prover-is-constant-time",
    "claim-b-is-assumption-free",
    "claim-b-proof-is-smaller",
)


def health_token(seed: str) -> str:
    run = honest_run(seed, "A")
    return hashlib.sha256(f"health:{seed}:{run['queries']}".encode()).hexdigest()[:16]
