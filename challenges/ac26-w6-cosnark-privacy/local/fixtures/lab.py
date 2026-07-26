"""The bench: run one specimen, keep what it reached and what it said.

An audit here never reads a specimen's source. It runs it and reads the record, which is the
only thing that generalizes -- two of the specimens reach a capability through a name that
`grep` does not find, and one of them is spotless until the input is not.

    scenario     one setting, one row, one witness, both halves, a fresh triple
    probe        run a specimen in a fresh scenario and hand back the evidence
    Evidence     what an auditor gets: the runtime's record and the disclosure
    malformed    a row whose declared width disagrees with its coefficient vector
    serialized   the disclosure as a next stage would actually receive it

`Evidence.runtime` is the `AuditRuntime` the specimen ran on, so `reached()`, `openings()`
and `events()` are all there. It is not the raw `Runtime`: the witness, the shares and the
reconstructed `A` / `B` / `C` are not on the bench, because an auditor who can look them up
is not auditing anything.
"""

from __future__ import annotations

from fixtures.generate import (
    AuditRuntime,
    Disclosure,
    Runtime,
    Share,
    Sink,
    linear_halves,
    relation,
    setting,
    witness,
)
from fixtures.specimens import specimen


class Scenario:
    """One setting, one row, one shared witness, both linear halves, and a fresh triple.

    The halves are built with `linear_halves` **on this runtime**, so an opening that descends
    from them carries a real ancestry and the mask check is measuring something.
    """

    __slots__ = ("seed", "label", "shape", "cfg", "row", "shares", "halves", "triple",
                 "runtime", "audit", "sink")

    def __init__(self, seed: str, label: str, shape: str = "dense") -> None:
        self.seed = seed
        self.label = label
        self.shape = shape
        self.cfg = setting(seed, label)
        self.row = dict(relation(seed, label, self.cfg, shape))
        self.runtime = Runtime(self.cfg)
        self.shares = self.runtime.deal_witness(
            seed, witness(seed, label, self.cfg), label=f"{label}w"
        )
        self.halves = linear_halves(self.runtime, self.row, self.shares)
        self.triple = self.runtime.deal_triple(seed, f"{label}x")
        self.sink = Sink()
        self.audit = AuditRuntime(self.runtime, self.sink)


class Evidence:
    """One run of one specimen, from the outside.

    ```text
    specimenId  which one was run
    runtime     the AuditRuntime it ran on: reached(), openings(), events(), violations()
    disclosure  what it put in front of you: artifact, log, metrics, error
    row         the relation it was handed -- the malformed one, if that is what you passed
    setting     p, parties, width, fieldId, settingId
    raised      the exception type name if the specimen let one out, else None
    ```
    """

    __slots__ = ("specimenId", "runtime", "disclosure", "row", "setting", "raised")

    def __init__(
        self,
        specimen_id: str,
        runtime: AuditRuntime,
        disclosure: Disclosure,
        row: dict,
        config: dict,
        raised: str | None,
    ) -> None:
        self.specimenId = specimen_id
        self.runtime = runtime
        self.disclosure = disclosure
        self.row = row
        self.setting = config
        self.raised = raised

    def __repr__(self) -> str:  # pragma: no cover - a debugging aid, never asserted on
        return (
            f"Evidence(specimenId={self.specimenId!r}, "
            f"reached={len(self.runtime.reached())}, "
            f"openings={len(self.runtime.openings())}, disclosure={self.disclosure!r})"
        )


def malformed_row(row: dict) -> dict:
    """A row whose declared width no longer matches its coefficient vector.

    The coefficients are untouched, so the halves a scenario already built are still the
    halves of this statement. What changed is what the row *claims* about itself -- which is
    the kind of input a prover meets in production and almost never meets in a test.
    """
    return {**row, "width": row["width"] + 1}


def run_on(scenario: Scenario, specimen_id: str, row: dict | None = None, resolve=None):
    """Run one specimen inside an existing scenario and collect the evidence."""
    resolved = (resolve or specimen)(specimen_id)
    target = scenario.row if row is None else row
    raised: str | None = None
    try:
        resolved(scenario.audit, target, scenario.halves, scenario.triple, scenario.sink)
    except Exception as error:  # noqa: BLE001 - a specimen that raises is evidence too
        raised = type(error).__name__
    # What the specimen returned is deliberately not kept. It is the prover's own proof dict,
    # and an audit that reads it is reading the implementation rather than the record.
    return Evidence(
        specimen_id,
        scenario.audit,
        scenario.sink.disclosure(),
        dict(target),
        dict(scenario.cfg),
        raised,
    )


def probe_factory(seed: str, label: str = "p", shape: str = "dense", resolve=None):
    """A `probe(specimen_id, row=None)` that runs each specimen in a scenario of its own.

    Every call builds a fresh setting, a fresh sink and a fresh triple, so probing the same
    specimen twice is two independent runs rather than one run with a spent mask. The seed and
    the label do not change between calls, so the relation and the field are the same each
    time and two specimens really are comparable.
    """

    def probe(specimen_id: str, row: dict | None = None) -> Evidence:
        return run_on(Scenario(seed, label, shape), specimen_id, row, resolve)

    return probe


def serialized(disclosure: Disclosure) -> Disclosure:
    """The disclosure as a next stage receives it: every `Share` replaced by its id.

    A proof artifact that crosses a process boundary carries names and numbers, not live
    Python objects, so a sharing arrives as a list of opaque ids. What survives that trip is
    exactly what a leak actually gives an attacker -- and it is why a reconstructed value
    wearing an approved label is a different disclosure from the sharing it replaced.
    """
    return Disclosure(
        {name: _flatten(value) for name, value in disclosure.artifact.items()},
        tuple(
            {"event": record["event"], "values": {n: _flatten(v) for n, v in record["values"].items()}}
            for record in disclosure.log
        ),
        {name: _flatten(value) for name, value in disclosure.metrics.items()},
        None
        if disclosure.error is None
        else {
            "message": disclosure.error["message"],
            "values": {n: _flatten(v) for n, v in disclosure.error["values"].items()},
        },
    )


def _flatten(value):
    if isinstance(value, Share):
        return value.id
    if isinstance(value, (list, tuple)):
        return tuple(_flatten(item) for item in value)
    return value
