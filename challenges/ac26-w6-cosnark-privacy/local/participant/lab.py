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

Issue 537/538 (Issue 543 option B2): this file used to be `fixtures/lab.py` and imported
`setting`, `relation`, `witness` and `value_catalog` straight from `fixtures/generate.py`,
in the single Docker stage a learner's own `make build` produced. Those five derivations are
what the hidden labels `h0`..`h3` are drawn from, and therefore what every checkpoint is
graded on, and they shipped there beside `tests/hidden/check_prover.py` and
`fixtures/specimens.py`'s `GROUND_TRUTH`. The bench itself is supplied material and stayed on
the participant side; the derivation did not. `_public_evidence` below is how a `Scenario`
for the `public` label now gets its setting, its row, its witness and its catalog -- from the
verifier's `GET /public` over the Compose-internal network, not from a module on disk.
"""

from __future__ import annotations

import json
import os

from participant.mpc import (
    AuditRuntime,
    Disclosure,
    Runtime,
    Share,
    Sink,
    linear_halves,
)
from participant.specimens import specimen

#: The one label whose material a participant may hold. Every checkpoint is graded on `h0`,
#: `h1`, `h2` or `h3` (see tests/hidden/check_prover.py), each drawing a different prime,
#: party count and witness length from the same seed, so a `Scenario` for one of those
#: resolves only where `fixtures/` is on disk -- the verifier image, the author image, or a
#: checkout. It never resolves inside a built `participant` image.
PUBLIC_LABEL = "public"

#: Keyed by the source as well as the seed, not by the seed alone: `probe_factory` builds a
#: fresh `Scenario` per call and each one would otherwise be an HTTP round trip, while a
#: cache that ignored the source would hand a test comparing the two branches the same answer
#: twice and pass without having compared anything.
_PAYLOAD_CACHE: dict[tuple[str, str, str], dict] = {}


def _public_evidence(seed: str) -> dict:
    """This deployment's public half: setting, rows, witness and catalogs, as values.

    `PUBLIC_EVIDENCE_JSON` first so a test can drive both branches without a daemon, then the
    verifier over the Compose-internal network, and only then `fixtures/generate.py` -- which
    resolves in a checkout or the verifier/author stage and never inside a built `participant`
    image, so the last branch does not reopen the leak this split closed.
    """
    injected = os.environ.get("PUBLIC_EVIDENCE_JSON") or ""
    verifier_public_url = os.environ.get("VERIFIER_PUBLIC_URL") or ""
    key = (seed, injected, verifier_public_url)
    if key in _PAYLOAD_CACHE:
        return _PAYLOAD_CACHE[key]
    if injected:
        payload = json.loads(injected)
    elif verifier_public_url:
        payload = _fetch(verifier_public_url)
    else:
        from fixtures.generate import public_payload

        payload = public_payload(seed)
    _PAYLOAD_CACHE[key] = payload
    return payload


def _fetch(verifier_public_url: str) -> dict:
    from urllib.error import HTTPError, URLError
    from urllib.request import urlopen

    try:
        with urlopen(verifier_public_url, timeout=10) as response:  # noqa: S310
            return json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, OSError, ValueError) as error:
        # Compose health-gates the workbench on the verifier, so this normally cannot happen.
        # When it does -- a `docker compose run` against a torn-down deployment -- say which
        # service is missing instead of printing a urllib traceback at somebody trying to
        # read their own bench.
        raise SystemExit(
            "cannot reach this deployment's verifier "
            f"({verifier_public_url}): {type(error).__name__}.\n"
            "The public evidence lives there since Issue 537/538. "
            "Start it with `make verifier-up` and try again."
        ) from error


def _derive(seed: str, label: str, shape: str) -> tuple[dict, dict, tuple[int, ...]]:
    """The setting, the row and the witness for one label, from wherever they are readable."""
    if label != PUBLIC_LABEL:
        try:
            from fixtures.generate import relation, setting, witness
        except ImportError as error:  # pragma: no cover - only reachable in a built image
            raise SystemExit(
                f"label {label!r} is derived from the seed, and the derivation is not in this "
                "image (Issue 537/538). Only 'public' is readable here; the hidden checker "
                "names the others in the verifier's own container."
            ) from error
        cfg = setting(seed, label)
        return dict(cfg), dict(relation(seed, label, cfg, shape)), tuple(witness(seed, label, cfg))
    payload = _public_evidence(seed)
    if shape not in payload["rows"]:
        raise KeyError(f"no {shape!r} row in this deployment's public evidence")
    row = dict(payload["rows"][shape])
    row["a"] = tuple(row["a"])
    row["b"] = tuple(row["b"])
    return dict(payload["setting"]), row, tuple(payload["witness"])


def deployment(seed: str, shape: str = "dense") -> tuple[dict, dict]:
    """This deployment's setting and one of its public rows, without building a bench."""
    cfg, row, _witness = _derive(seed, PUBLIC_LABEL, shape)
    return cfg, row


def value_catalog(seed: str, label: str, row: dict) -> tuple[dict, ...]:
    """Every kind of value one run produces, under opaque ids. See the starter's `classify`.

    The `public` label's catalog travels in `GET /public` keyed by relation id; every other
    label's is derived where the witness is, and is not readable from the participant image.
    """
    if label != PUBLIC_LABEL:
        from fixtures.generate import value_catalog as derived

        return derived(seed, label, row)
    catalogs = _public_evidence(seed)["catalogs"]
    entries = catalogs[row["relationId"]]
    return tuple(
        {
            "id": entry["id"],
            "origin": entry["origin"],
            "form": entry["form"],
            "opened": None
            if entry["opened"] is None
            else {
                "roundId": entry["opened"]["roundId"],
                "maskedBy": tuple(entry["opened"]["maskedBy"]),
            },
            "audience": entry["audience"],
        }
        for entry in entries
    )


def health_token(seed: str) -> str:
    """The deployment's health token, as `make inspect` has always printed it."""
    return _public_evidence(seed)["healthToken"]


def shapes(seed: str) -> tuple[str, ...]:
    """The coefficient shapes this deployment draws, in the order `make inspect S=` accepts."""
    return tuple(_public_evidence(seed)["shapes"])


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
        self.cfg, self.row, witness_values = _derive(seed, label, shape)
        self.runtime = Runtime(self.cfg)
        self.shares = self.runtime.deal_witness(seed, witness_values, label=f"{label}w")
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


def probe_factory(seed: str, label: str = PUBLIC_LABEL, shape: str = "dense", resolve=None):
    """A `probe(specimen_id, row=None)` that runs each specimen in a scenario of its own.

    Every call builds a fresh setting, a fresh sink and a fresh triple, so probing the same
    specimen twice is two independent runs rather than one run with a spent mask. The seed and
    the label do not change between calls, so the relation and the field are the same each
    time and two specimens really are comparable.

    The default label is `public` because that is the only one whose material a participant
    container holds (see `_derive`). The hidden checker always names its own.
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
