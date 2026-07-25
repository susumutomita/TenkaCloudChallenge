"""The only file you edit.

You are not building a proof system. You are reading two of them and finding out where
they broke.

A **pipeline definition** is a list of stages. Each stage names the artifacts it
consumes and the artifacts it produces, and sits in a **layer**:

    input-boundary -> arithmetization -> polynomial -> commitment
                   -> transcript -> opening -> [low-degree] -> verifier

A **run** is a record of what a prover and verifier claim to have done for one
execution of a pipeline. It is not a proof; it is the paperwork. Your job is to decide
whether the paperwork is consistent with the pipeline's contracts.

Two pipelines are shipped. They are not named after real schemes and they are not
implementations of any. `A` is circuit-oriented with a per-circuit trusted setup, `B`
is trace-oriented and transparent. **They have different stage names, a different
number of stages, and B has a layer A does not.** Anything you hardcode from A will be
wrong for B, and the hidden tests run everything against both.

One field is a trap, and it is worth naming up front: `run["commitment_ok"]` is `True`
in every run in this problem. A commitment succeeding tells you the prover committed to
something. It tells you nothing about whether what they committed to satisfies the
constraint system, and nothing about whether the verifier checked the openings.

Run `make inspect` first.
"""

from __future__ import annotations

#: Cheapest first. You need an ordering to say one cost class is smaller than another.
SIZE_ORDER = (
    "none",
    "constant",
    "logarithmic",
    "polylogarithmic",
    "linear",
    "quasilinear",
    "superlinear",
)


# ---------------------------------------------------------------------------
# 1. The artifact graph
# ---------------------------------------------------------------------------


def artifact_graph(definition: dict) -> dict:
    """Every artifact in the pipeline, mapped to how it flows.

    Return `{artifact: {"produced_by": <stage name or "setup">, "consumed_by": [names]}}`.

    The setup produces artifacts too, and it is not in `definition["stages"]`.
    """
    return {}


def dangling_artifacts(definition: dict) -> list[str]:
    """Sorted names of artifacts some stage consumes that nothing produces."""
    return []


# ---------------------------------------------------------------------------
# 2. One contract per layer
# ---------------------------------------------------------------------------
#
# Each returns a list of human-readable failure strings, empty when the contract holds.
# Every one of them must be silent on an honest run of EITHER pipeline -- a contract
# that fires on a healthy run is as broken as one that misses a fault.


def check_inputs(definition: dict, run: dict) -> list[str]:
    """input-boundary: who is allowed to see what, and whose setup material this is.

    Three things go wrong here. Everything the verifier consumes has to reach it;
    nothing the prover holds privately may; and the setup material has to be the
    material this pipeline's setup actually produces, not another pipeline's.

    Work out which artifacts are prover-only from the definition. Do not trust
    `run["secret"]` alone -- it is part of the record you are auditing.
    """
    return []


def check_constraints(definition: dict, run: dict) -> list[str]:
    """arithmetization: an accepting verdict requires every constraint satisfied.

    A run that noticed an unsatisfied constraint and rejected is doing its job. The
    fault is accepting anyway.
    """
    return []


def check_commitment(definition: dict, run: dict) -> list[str]:
    """commitment: the commitment binds everything the commit stage was handed.

    An artifact the commit stage consumes but does not commit to is free for the prover
    to change afterwards. One exception, and you have to work out why it is an
    exception rather than special-casing it by name.
    """
    return []


def check_transcript(definition: dict, run: dict) -> list[str]:
    """transcript: everything the challenge depends on was absorbed before it was drawn.

    `run["absorbed_before_challenge"]` is what went into the transcript. The definition
    says what the challenge stage consumes. Compare them -- do not write the list of
    names here, or pipeline C will break you the same way B would.
    """
    return []


def check_openings(definition: dict, run: dict) -> list[str]:
    """opening: every required opening was checked, and enough queries ran.

    "Enough" is per pipeline; the definition says how many. And think about whether
    comparing lengths is the same as comparing sets.
    """
    return []


def check_degree(definition: dict, run: dict) -> list[str]:
    """low-degree: if the pipeline has this stage, the run has to have run it.

    Only one of the two pipelines has it.
    """
    return []


# ---------------------------------------------------------------------------
# 3. Setup assumptions and cost claims
# ---------------------------------------------------------------------------


def assumption_matrix(definitions: dict) -> dict:
    """Per pipeline: `{"setup": kind, "transparent": bool, "assumptions": sorted list}`.

    `definitions` is `{"A": ..., "B": ...}`. One of these two is transparent. Neither
    rests on nothing.
    """
    return {}


def unsupported_claims(definitions: dict, claims) -> list[str]:
    """Sorted ids of the claims the declared profiles do not support.

    Three shapes of claim, given by `claim["kind"]`:

        property         `definitions[about]["cost"][property] == asserts`
        comparison       `about`'s class is cheaper than `against`'s, same property
        assumption_free  `about` rests on no cryptographic assumption

    A claim being popular is not the same as it being supported.
    """
    return []


# ---------------------------------------------------------------------------
# 4. Diagnosis and repair
# ---------------------------------------------------------------------------


def layer_order(definition: dict) -> list[str]:
    """The pipeline's layers in stage order, no repeats.

    Read it off the definition. Two pipelines, two different answers.
    """
    return []


def first_fault(definition: dict, run: dict) -> str | None:
    """The name of the earliest layer whose contract fails, or None if the run is clean.

    Earliest, not worst and not last. One broken input boundary makes everything
    downstream look wrong too, and a diagnosis pointing at the openings sends somebody
    to repair a stage that was doing its job.
    """
    return None


def repair(definition: dict, run: dict) -> dict:
    """A run with the first fault fixed and **nothing else touched**.

    Return a new record with the same fields. Exactly one field may differ from `run`:
    the one the fault damaged.

    That rules out two shortcuts. Rebuilding a clean run from the definition passes
    every contract while destroying the evidence. Setting the verdict to `reject`
    silences every contract at once without repairing anything -- with one exception,
    and finding which fault that is, and why, is most of this checkpoint.
    """
    return dict(run)
