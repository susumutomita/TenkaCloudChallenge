"""Hidden tests. Run by /verify against a copy of the learner's prover.py.

Eight phases, graded separately, because they read different evidence and a prover can be
spotless in one and not in another. Three of them exist because of a specimen that would
otherwise pass:

  * **capability** (`check_capability`). One specimen is spotless on the happy path and hands
    out peeked shares only when the row does not describe itself. The phase hands the
    submission a `probe` rather than a run, so an audit that never supplies a malformed input
    reports it clean -- which it is, right up until it is not.
  * **open-set** (`check_openset`). Two real runtime states are constructed on top of a
    specimen's own run: a masked sharing opened in a round the relation never declared, and an
    unmasked sharing opened in the declared one. Each is caught by exactly one half of the
    authorization rule, so an audit that checks only `maskedBy`, or only the round id, passes
    one of them.
  * **evidence** (`check_evidence`). The submission is handed a *serialized* disclosure -- every
    sharing already reduced to opaque ids -- so a value has to be derived rather than looked
    up, and the runtime is watched for a capability reached while answering.

Nothing here is built out of a wrapper that lies. A pre-loaded opening really is in
`openings()`, a peeked share really is in `reached()`, and the hidden specimens in
`check_transfer` are ordinary provers that really do reconstruct `C` to `A * B`.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fixtures.generate import (  # noqa: E402
    ALLOWED_NAMES,
    AUDIENCES,
    CLASSES,
    FORMS,
    ORIGINS,
    PROTOCOL_CAPABILITIES,
    SHARING_ONLY_NAMES,
    beaver_product,
    clean_artifact,
    is_sharing,
    relation,
    round_id_for,
    setting,
    value_catalog,
)
from participant.lab import (  # noqa: E402
    Scenario,
    malformed_row,
    probe_factory,
    run_on,
    serialized,
)
from fixtures.specimens import (  # noqa: E402
    GROUND_TRUTH,
    MALFORMED_TRUTH,
    SPECIMEN_IDS,
    specimen,
)

LABELS = ("h0", "h1", "h2", "h3")

#: The keys a clean proof artifact carries, and no others.
ARTIFACT_KEYS = {"relationId", "fieldId", "parties", "A", "B", "C", "tripleId", "roundId"}

#: The visible specimens whose peeks cross a party boundary on the honest path. Derived from
#: the records at check time as well; pinned here so a fixture edit that quietly made every
#: specimen clean would fail rather than agree with itself.
CROSS_PARTY = {"S3", "S7"}


# ---------------------------------------------------------------------------
# the two predicates the checker grades against
# ---------------------------------------------------------------------------


def _authorized(record: dict, row: dict) -> bool:
    return bool(record.get("maskedBy")) and record.get("roundId") == round_id_for(row)


def _expected_class(entry: dict, row: dict) -> str:
    opened = entry.get("opened")
    if entry["audience"] == "verifier":
        return "verifier-only"
    if opened is not None and _authorized(opened, row):
        return "allowed-open"
    if entry["origin"] == "relation" or entry["form"] == "metadata":
        return "public-input"
    if entry["form"] == "share":
        return "secret-share"
    if entry["form"] == "sharing" and entry["audience"] == "participant":
        return "participant-artifact"
    return "secret-intermediate"


def _expected_leakage(disclosure, parties: int) -> tuple[tuple[str, str], ...]:
    out = set()
    for channel, name, value in _disclosed(disclosure):
        if name not in ALLOWED_NAMES:
            out.add((channel, name))
        elif name in SHARING_ONLY_NAMES and not is_sharing(value, parties):
            out.add((channel, name))
    return tuple(sorted(out))


def _disclosed(disclosure):
    for name, value in disclosure.artifact.items():
        yield "artifact", name, value
    for record in disclosure.log:
        for name, value in record["values"].items():
            yield "log", name, value
    for name, value in disclosure.metrics.items():
        yield "metrics", name, value
    if disclosure.error is not None:
        for name, value in disclosure.error["values"].items():
            yield "error", name, value


# ---------------------------------------------------------------------------
# the hidden specimens `check_transfer` uses
# ---------------------------------------------------------------------------


def _h1(runtime, row, halves, triple, sink) -> dict:
    """Reconstruct, reached through a table entry, published as an operator metric."""
    proof = beaver_product(runtime, row, halves, triple)
    table = {"combine": runtime.reconstruct}
    sink.emit("multiplication", tripleId=proof["tripleId"], roundId=proof["roundId"])
    sink.metric("operations", len(runtime.events()))
    sink.metric("prover.right_half", table["combine"](proof["B"]))
    sink.publish(clean_artifact(row, proof))
    return proof


def _h2(runtime, row, halves, triple, sink) -> dict:
    """Spotless until the row stops describing itself."""
    if len(row["b"]) != row["width"]:
        sink.metric("prover.state", tuple(runtime.peek(share) for share in halves["B"]))
        return {}
    proof = beaver_product(runtime, row, halves, triple)
    sink.emit("multiplication", tripleId=proof["tripleId"], roundId=proof["roundId"])
    sink.publish(clean_artifact(row, proof))
    return proof


def _h3(runtime, row, halves, triple, sink) -> dict:
    """Clean. An audit that always finds something fails here."""
    proof = beaver_product(runtime, row, halves, triple)
    sink.emit("opened", d=proof["d"], e=proof["e"])
    sink.metric("rounds", len({record["roundId"] for record in runtime.openings()}))
    sink.publish(clean_artifact(row, proof))
    return proof


def _h4(runtime, row, halves, triple, sink) -> dict:
    """A masked sharing, opened again in a round the relation never declared."""
    proof = beaver_product(runtime, row, halves, triple)
    runtime.open(f"{row['relationId']}:recheck", triple.x)
    sink.emit("multiplication", tripleId=proof["tripleId"], roundId=proof["roundId"])
    sink.publish(clean_artifact(row, proof))
    return proof


_HIDDEN = {"H1": _h1, "H2": _h2, "H3": _h3, "H4": _h4}

_HIDDEN_TRUTH = {
    "H1": {
        "capabilities": ("reconstruct",),
        "unauthorized": 0,
        "disclosed": (("metrics", "prover.right_half"),),
        "recoverable": "B",
    },
    "H2": {"capabilities": (), "unauthorized": 0, "disclosed": (), "recoverable": None},
    "H3": {"capabilities": (), "unauthorized": 0, "disclosed": (), "recoverable": None},
    "H4": {"capabilities": (), "unauthorized": 1, "disclosed": (), "recoverable": None},
}

_HIDDEN_MALFORMED = {
    "H2": {
        "capabilities": ("peek",),
        "unauthorized": 0,
        "disclosed": (("metrics", "prover.state"),),
        "recoverable": "B",
    },
}


def _resolve_hidden(identifier: str):
    return _HIDDEN[identifier] if identifier in _HIDDEN else specimen(identifier)


class _Suite:
    """One set of specimens and the four facts the checker holds about each of them."""

    def __init__(self, ids, truth, malformed, resolve=None) -> None:
        self.ids = tuple(ids)
        self.truth = truth
        self.malformed = malformed
        self.resolve = resolve

    def probe(self, seed: str, label: str, shape: str = "dense"):
        return probe_factory(seed, label, shape, self.resolve)

    def run(self, seed: str, label: str, identifier: str, shape: str = "dense", malformed=False):
        """A fresh scenario, one specimen run on it, and the scenario kept for its truth."""
        scenario = Scenario(seed, label, shape)
        row = malformed_row(scenario.row) if malformed else None
        return scenario, run_on(scenario, identifier, row, self.resolve)

    def fact(self, identifier: str, key: str, malformed: bool = False):
        table = self.malformed if malformed else self.truth
        if malformed and identifier not in table:
            table = self.truth
        return table[identifier][key]

    def malformed_ids(self) -> tuple[str, ...]:
        return tuple(identifier for identifier in self.ids if identifier in self.malformed)


VISIBLE = _Suite(SPECIMEN_IDS, GROUND_TRUTH, MALFORMED_TRUTH)
HIDDEN = _Suite(tuple(_HIDDEN), _HIDDEN_TRUTH, _HIDDEN_MALFORMED, _resolve_hidden)


# ---------------------------------------------------------------------------
# shared helpers
# ---------------------------------------------------------------------------


def _truth_values(scenario: Scenario) -> dict:
    """`A`, `B` and `C` for this scenario, read off the raw runtime so nothing is recorded."""
    prime = scenario.cfg["p"]
    a = scenario.runtime.reconstruct(scenario.halves["A"])
    b = scenario.runtime.reconstruct(scenario.halves["B"])
    return {"A": a, "B": b, "C": (a * b) % prime}


def _attempt(call, what: str):
    """Call the submission where a raise is a failure rather than a refusal."""
    try:
        return call()
    except Exception as error:  # noqa: BLE001
        return f"{what} raised {type(error).__name__}"


def _refuses(call, what: str) -> list[str]:
    try:
        call()
    except Exception:  # noqa: BLE001 - any refusal is a refusal
        return []
    return [f"accepted {what}"]


def _as_names(value) -> tuple[str, ...] | None:
    if not isinstance(value, (list, tuple)):
        return None
    if not all(isinstance(item, str) for item in value):
        return None
    return tuple(value)


def _as_pairs(value) -> tuple[tuple[str, str], ...] | None:
    if not isinstance(value, (list, tuple)):
        return None
    out = []
    for item in value:
        if not isinstance(item, (list, tuple)) or len(item) != 2:
            return None
        if not all(isinstance(part, str) for part in item):
            return None
        out.append((item[0], item[1]))
    return tuple(out)


def _as_openings(value) -> tuple[tuple, ...] | None:
    if not isinstance(value, (list, tuple)):
        return None
    out = []
    for item in value:
        if not isinstance(item, dict):
            return None
        share_ids = _as_names(item.get("shareIds"))
        if not isinstance(item.get("roundId"), str) or share_ids is None:
            return None
        if not isinstance(item.get("masked"), bool):
            return None
        out.append((item["roundId"], share_ids, item["masked"]))
    return tuple(out)


def _expected_openings(evidence) -> tuple[tuple, ...]:
    return tuple(
        (record["roundId"], tuple(record["shareIds"]), bool(record["maskedBy"]))
        for record in evidence.runtime.openings()
        if not _authorized(record, evidence.row)
    )


# ---------------------------------------------------------------------------
# 1. the policy
# ---------------------------------------------------------------------------


def _classify_failures(module, seed: str, label: str, shape: str) -> list[str]:
    cfg = setting(seed, label)
    row = dict(relation(seed, label, cfg, shape))
    catalog = value_catalog(seed, label, row)
    expected = [_expected_class(entry, row) for entry in catalog]
    if set(expected) != set(CLASSES):
        # A catalog that no longer reaches every class would make this phase pass by being
        # smaller, not by being satisfied.
        return [f"the catalog at {label}/{shape} does not cover every class"]

    failures: list[str] = []
    for entry, want in zip(catalog, expected):
        got = _attempt(lambda e=entry: module.classify(dict(e), dict(row)), "classify")
        if isinstance(got, str) and got == want:
            continue
        if isinstance(got, str) and got not in CLASSES:
            failures.append(f"classify returned {got!r}, which is not one of the six classes")
            continue
        opened = entry.get("opened")
        if want == "secret-intermediate" and got == "allowed-open" and opened is not None:
            failures.append(
                "classify called an opening allowed without asking whether the protocol "
                "authorized it"
            )
        elif want == "allowed-open" and got != "allowed-open":
            failures.append("classify did not recognize the multiplication's own opening")
        else:
            failures.append(f"classify put a {want} value in {got!r}")
    return failures


def check_classify(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        for shape in ("dense", "sparse"):
            failures.extend(_classify_failures(module, seed, label, shape))

    cfg = setting(seed, LABELS[0])
    row = dict(relation(seed, LABELS[0], cfg, "dense"))
    sound = dict(value_catalog(seed, LABELS[0], row)[0])
    malformed = [
        ({**sound, "origin": "operator"}, "an origin outside the vocabulary"),
        ({**sound, "form": "digest"}, "a form outside the vocabulary"),
        ({**sound, "audience": "auditor"}, "an audience outside the vocabulary"),
        ({**sound, "origin": None}, "an entry with no origin at all"),
    ]
    for entry, what in malformed:
        failures.extend(_refuses(lambda e=entry: module.classify(e, dict(row)), what))
    return failures


# ---------------------------------------------------------------------------
# 2. what a run was able to do
# ---------------------------------------------------------------------------


def _capability_failures(module, suite: _Suite, seed: str, label: str, shape: str) -> list[str]:
    failures: list[str] = []
    for identifier in suite.ids:
        expected = tuple(
            sorted(
                set(suite.fact(identifier, "capabilities"))
                | set(
                    suite.malformed.get(identifier, {}).get("capabilities", ())
                )
            )
        )
        probe = suite.probe(seed, label, shape)
        reported = _attempt(
            lambda p=probe, i=identifier: module.capability_audit(p, i), "capability_audit"
        )
        if isinstance(reported, str):
            failures.append(reported)
            continue
        names = _as_names(reported)
        if names is None:
            failures.append("capability_audit did not return a tuple of capability names")
            continue
        if tuple(sorted(names)) != names:
            failures.append("capability_audit returned its capabilities out of order")
        if set(names) != set(expected):
            missed = sorted(set(expected) - set(names))
            if missed and identifier in suite.malformed:
                failures.append(
                    f"capability_audit missed {missed} on a specimen that only reaches them "
                    "when the input is malformed"
                )
            elif set(names) & set(PROTOCOL_CAPABILITIES):
                failures.append(
                    "capability_audit counted the multiplication's own capability as the "
                    "prover's"
                )
            else:
                failures.append(
                    f"capability_audit reported {sorted(names)}, the record holds {list(expected)}"
                )
    return failures


def check_capability(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        for shape in ("dense", "signed"):
            failures.extend(_capability_failures(module, VISIBLE, seed, label, shape))
    return failures


# ---------------------------------------------------------------------------
# 3. what a run published to the other parties
# ---------------------------------------------------------------------------


def _openset_failures(module, suite: _Suite, seed: str, label: str, shape: str) -> list[str]:
    failures: list[str] = []
    for identifier in suite.ids:
        _, evidence = suite.run(seed, label, identifier, shape)
        expected = _expected_openings(evidence)
        reported = _attempt(lambda e=evidence: module.open_set_audit(e), "open_set_audit")
        if isinstance(reported, str):
            failures.append(reported)
            continue
        records = _as_openings(reported)
        if records is None:
            failures.append(
                "open_set_audit did not return one {roundId, shareIds, masked} record per "
                "unauthorized opening"
            )
            continue
        if records != expected:
            failures.append(
                f"open_set_audit reported {len(records)} unauthorized opening(s) on this run, "
                f"the record holds {len(expected)}"
            )
        if len(expected) != suite.fact(identifier, "unauthorized"):
            failures.append("the fixtures no longer match their own ground truth")
    return failures


def check_openset(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        for shape in ("dense", "sparse"):
            failures.extend(_openset_failures(module, VISIBLE, seed, label, shape))

    # A masked sharing, opened again in a round the relation never declared. `maskedBy` is
    # non-empty, so an audit that only looks there sees the protocol's own opening.
    scenario, evidence = VISIBLE.run(seed, LABELS[0], "S1")
    scenario.audit.open(f"{scenario.row['relationId']}:recheck", scenario.triple.x)
    reported = _attempt(lambda e=evidence: module.open_set_audit(e), "open_set_audit")
    records = None if isinstance(reported, str) else _as_openings(reported)
    if isinstance(reported, str):
        failures.append(reported)
    elif records is None or len(records) != 1 or records[0][2] is not True:
        failures.append(
            "open_set_audit missed a masked value opened in a round the relation never declared"
        )

    # An unmasked sharing, opened in the declared round. The round id is right, and nothing was
    # hiding it -- so an audit that only checks the round sees the protocol's own opening.
    scenario, evidence = VISIBLE.run(seed, LABELS[1], "S1")
    scenario.audit.open(round_id_for(scenario.row), scenario.halves["A"])
    reported = _attempt(lambda e=evidence: module.open_set_audit(e), "open_set_audit")
    records = None if isinstance(reported, str) else _as_openings(reported)
    if isinstance(reported, str):
        failures.append(reported)
    elif records is None or len(records) != 1 or records[0][2] is not False:
        failures.append(
            "open_set_audit missed a value published in the declared round with nothing hiding it"
        )
    return failures


# ---------------------------------------------------------------------------
# 4. whose shares a run read
# ---------------------------------------------------------------------------


def _crossparty_failures(
    module, suite: _Suite, seed: str, label: str, shape: str, malformed: bool = False
) -> list[str]:
    failures: list[str] = []
    ids = suite.malformed_ids() if malformed else suite.ids
    for identifier in ids:
        _, evidence = suite.run(seed, label, identifier, shape, malformed=malformed)
        peeks = [
            record for record in evidence.runtime.reached() if record["capability"] == "peek"
        ]
        parties = tuple(sorted({record["party"] for record in peeks}))
        reported = _attempt(lambda e=evidence: module.cross_party_audit(e), "cross_party_audit")
        if isinstance(reported, str):
            failures.append(reported)
            continue
        if not isinstance(reported, dict):
            failures.append("cross_party_audit did not return a dict")
            continue
        if reported.get("peeks") != len(peeks):
            failures.append(
                f"cross_party_audit counted {reported.get('peeks')!r} peeks, the record holds "
                f"{len(peeks)}"
            )
        if tuple(reported.get("parties") or ()) != parties:
            failures.append("cross_party_audit did not report the parties whose shares were read")
        if reported.get("crossed") is not (len(parties) > 1):
            if len(parties) > 1:
                failures.append(
                    "cross_party_audit called a run clean that read shares belonging to more "
                    "than one party"
                )
            else:
                failures.append("cross_party_audit called a run cross-party that read nothing")
    return failures


def check_crossparty(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        for shape in ("dense", "unit"):
            failures.extend(_crossparty_failures(module, VISIBLE, seed, label, shape))
    # The one that only reads across a boundary on the error path.
    failures.extend(_crossparty_failures(module, VISIBLE, seed, LABELS[0], "dense", malformed=True))

    # A peek that stays inside its own party. Reading a share is not the violation -- reading
    # somebody else's is -- so a run with one peek and one owner is clean, and an audit that
    # equates "peeked" with "crossed" says otherwise.
    scenario, evidence = VISIBLE.run(seed, LABELS[3], "S1")
    scenario.audit.peek(scenario.halves["A"][0])
    reported = _attempt(lambda e=evidence: module.cross_party_audit(e), "cross_party_audit")
    if isinstance(reported, str):
        failures.append(reported)
    elif not isinstance(reported, dict) or reported.get("peeks") != 1:
        failures.append("cross_party_audit did not count a peek that stayed inside its party")
    elif reported.get("crossed") is not False or tuple(reported.get("parties") or ()) != (0,):
        failures.append("cross_party_audit called a peek inside its own party a boundary crossing")

    # Three peeks over two owners, in an order that is not the owners' order. Every specimen
    # happens to read each party exactly once and in ascending order, which makes "how many
    # peeks" and "how many owners" the same number and hides the difference between them.
    scenario, evidence = VISIBLE.run(seed, LABELS[2], "S1")
    scenario.audit.peek(scenario.halves["A"][1])
    scenario.audit.peek(scenario.halves["A"][0])
    scenario.audit.peek(scenario.halves["B"][0])
    reported = _attempt(lambda e=evidence: module.cross_party_audit(e), "cross_party_audit")
    if isinstance(reported, str):
        failures.append(reported)
    elif not isinstance(reported, dict) or reported.get("peeks") != 3:
        failures.append("cross_party_audit counted owners where it should have counted peeks")
    elif tuple(reported.get("parties") or ()) != (0, 1):
        failures.append("cross_party_audit reported one entry per peek rather than per owner")
    elif reported.get("crossed") is not True:
        failures.append("cross_party_audit missed a crossing over two owners")

    # The claim the fixtures are supposed to be making, pinned rather than derived, so a
    # fixture edit that made every specimen clean would fail here instead of agreeing.
    crossed = set()
    for identifier in VISIBLE.ids:
        _, evidence = VISIBLE.run(seed, LABELS[2], identifier)
        parties = {
            record["party"]
            for record in evidence.runtime.reached()
            if record["capability"] == "peek"
        }
        if len(parties) > 1:
            crossed.add(identifier)
    if crossed != CROSS_PARTY:
        failures.append("the specimens no longer cross the party boundaries this phase expects")
    return failures


# ---------------------------------------------------------------------------
# 5. what a run published to us
# ---------------------------------------------------------------------------


def _leakage_failures(
    module, suite: _Suite, seed: str, label: str, shape: str, malformed: bool = False
) -> list[str]:
    failures: list[str] = []
    ids = suite.malformed_ids() if malformed else suite.ids
    for identifier in ids:
        scenario, evidence = suite.run(seed, label, identifier, shape, malformed=malformed)
        expected = _expected_leakage(evidence.disclosure, scenario.cfg["parties"])
        declared = tuple(sorted(suite.fact(identifier, "disclosed", malformed)))
        if expected != declared:
            failures.append("the fixtures no longer disclose what their ground truth says")
        reported = _attempt(lambda e=evidence: module.leakage_audit(e), "leakage_audit")
        if isinstance(reported, str):
            failures.append(reported)
            continue
        pairs = _as_pairs(reported)
        if pairs is None:
            failures.append("leakage_audit did not return (channel, field name) pairs")
            continue
        if tuple(sorted(pairs)) != pairs:
            failures.append("leakage_audit returned its pairs out of order")
        if set(pairs) != set(expected):
            missed = sorted(set(expected) - set(pairs))
            extra = sorted(set(pairs) - set(expected))
            if any(name in SHARING_ONLY_NAMES for _, name in missed):
                failures.append(
                    "leakage_audit passed an allowed name carrying something other than a sharing"
                )
            elif extra:
                failures.append(f"leakage_audit flagged {extra}, which the policy allows")
            else:
                failures.append(f"leakage_audit missed {missed}")
    return failures


def check_leakage(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        for shape in ("dense", "sparse", "signed"):
            failures.extend(_leakage_failures(module, VISIBLE, seed, label, shape))
    failures.extend(_leakage_failures(module, VISIBLE, seed, LABELS[0], "dense", malformed=True))
    return failures


# ---------------------------------------------------------------------------
# 6. what we can recover from it
# ---------------------------------------------------------------------------


def _evidence_failures(
    module, suite: _Suite, seed: str, label: str, shape: str, malformed: bool = False
) -> list[str]:
    failures: list[str] = []
    ids = suite.malformed_ids() if malformed else suite.ids
    for identifier in ids:
        scenario, evidence = suite.run(seed, label, identifier, shape, malformed=malformed)
        truth = _truth_values(scenario)
        secret = suite.fact(identifier, "recoverable", malformed)
        pair = suite.fact(identifier, "disclosed", malformed)
        view = serialized(evidence.disclosure)
        reached_before = len(evidence.runtime.reached())

        reported = _attempt(
            lambda v=view, c=scenario.cfg: module.leakage_evidence(v, dict(c)),
            "leakage_evidence",
        )
        if isinstance(reported, str):
            failures.append(reported)
            continue
        if len(evidence.runtime.reached()) != reached_before:
            failures.append(
                "leakage_evidence reached a capability on the runtime; the disclosure is what "
                "an auditor actually has"
            )
        if secret is None:
            if reported is not None:
                failures.append("leakage_evidence reported a leak on a run that discloses none")
            continue
        if not isinstance(reported, dict):
            failures.append("leakage_evidence did not return {'value', 'from'} for a real leak")
            continue
        if reported.get("value") != truth[secret]:
            if reported.get("value") in truth.values():
                failures.append("leakage_evidence recovered a secret, but not the one on offer")
            else:
                failures.append(
                    "leakage_evidence did not derive the secret the disclosure yields"
                )
        if tuple(reported.get("from") or ()) != tuple(pair[0]):
            failures.append("leakage_evidence did not name the pair it took the secret from")
    return failures


def check_evidence(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        for shape in ("dense", "signed"):
            failures.extend(_evidence_failures(module, VISIBLE, seed, label, shape))
    failures.extend(_evidence_failures(module, VISIBLE, seed, LABELS[0], "dense", malformed=True))
    return failures


# ---------------------------------------------------------------------------
# 7. the repair
# ---------------------------------------------------------------------------


def _repair_failures(module, seed: str, label: str, shape: str) -> list[str]:
    scenario = Scenario(seed, label, shape)
    truth = _truth_values(scenario)
    proof = _attempt(
        lambda: module.private_prover(
            scenario.audit, dict(scenario.row), scenario.halves, scenario.triple, scenario.sink
        ),
        "private_prover",
    )
    if isinstance(proof, str):
        return [proof]
    if not isinstance(proof, dict):
        return ["private_prover did not return a dict"]
    missing = {"A", "B", "C", "d", "e", "tripleId", "roundId"} - set(proof)
    if missing:
        return [f"private_prover did not report {sorted(missing)}"]

    failures: list[str] = []
    if not is_sharing(proof["C"], scenario.cfg["parties"]):
        failures.append("private_prover's C is not one share per party")
    elif scenario.runtime.reconstruct(proof["C"]) != truth["C"]:
        failures.append("private_prover's C does not reconstruct to A * B")

    openings = scenario.audit.openings()
    if len(openings) != 2:
        failures.append(f"private_prover made {len(openings)} opening(s), not two")
    if any(not _authorized(record, scenario.row) for record in openings):
        failures.append("private_prover opened something the multiplication did not authorize")
    if len({record["roundId"] for record in openings}) != 1:
        failures.append("private_prover's openings did not go out in one round")

    reached = {record["capability"] for record in scenario.audit.reached()}
    beyond = sorted(reached.difference(PROTOCOL_CAPABILITIES))
    if beyond:
        failures.append(f"private_prover reached {beyond} on an honest run")

    disclosure = scenario.sink.disclosure()
    leaks = _expected_leakage(disclosure, scenario.cfg["parties"])
    if leaks:
        failures.append(f"private_prover disclosed {list(leaks)}")
    if set(disclosure.artifact) != ARTIFACT_KEYS:
        extra = sorted(set(disclosure.artifact) - ARTIFACT_KEYS)
        absent = sorted(ARTIFACT_KEYS - set(disclosure.artifact))
        if absent == sorted(ARTIFACT_KEYS):
            failures.append("private_prover published no artifact; the next stage consumes one")
        elif extra:
            failures.append(f"the artifact carries {extra}, which is not part of it")
        else:
            failures.append(f"the artifact is missing {absent}")
    else:
        for name in ("A", "B", "C"):
            if not is_sharing(disclosure.artifact[name], scenario.cfg["parties"]):
                failures.append(f"the artifact holds {name} as something other than a sharing")
    return failures


def check_repair(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        for shape in ("dense", "sparse", "unit"):
            failures.extend(_repair_failures(module, seed, label, shape))

    # A runtime whose triple has already been spent. `reserve_triple` refuses, the call fails,
    # and what a prover says while failing is the question. The refusal itself is fine.
    scenario = Scenario(seed, LABELS[3])
    scenario.runtime.reserve_triple(scenario.triple)
    try:
        module.private_prover(
            scenario.audit, dict(scenario.row), scenario.halves, scenario.triple, scenario.sink
        )
    except Exception:  # noqa: BLE001 - letting the runtime's refusal through is correct
        pass
    leaks = _expected_leakage(scenario.sink.disclosure(), scenario.cfg["parties"])
    if leaks:
        failures.append(f"private_prover disclosed {list(leaks)} while failing")
    beyond = sorted(
        {record["capability"] for record in scenario.audit.reached()}.difference(
            PROTOCOL_CAPABILITIES
        )
    )
    if beyond:
        failures.append(f"private_prover reached {beyond} while failing")
    return failures


# ---------------------------------------------------------------------------
# 8. specimens nothing above has seen, in a setting nothing above has seen
# ---------------------------------------------------------------------------


def check_transfer(module, seed: str) -> list[str]:
    transferred = f"{seed}:transfer"
    failures = [
        *check_classify(module, transferred),
        *check_capability(module, transferred),
        *check_openset(module, transferred),
        *check_crossparty(module, transferred),
        *check_leakage(module, transferred),
        *check_evidence(module, transferred),
        *check_repair(module, transferred),
    ]
    # Four provers the visible eight do not contain: reconstruct reached through a table
    # entry, a debug branch that only fires on a malformed row, a clean one, and a masked
    # value opened in an undeclared round.
    for label in (LABELS[0], LABELS[2]):
        failures.extend(_capability_failures(module, HIDDEN, transferred, label, "dense"))
        failures.extend(_openset_failures(module, HIDDEN, transferred, label, "dense"))
        failures.extend(_crossparty_failures(module, HIDDEN, transferred, label, "dense"))
        failures.extend(_leakage_failures(module, HIDDEN, transferred, label, "dense"))
        failures.extend(_evidence_failures(module, HIDDEN, transferred, label, "dense"))
    failures.extend(
        _crossparty_failures(module, HIDDEN, transferred, LABELS[1], "dense", malformed=True)
    )
    failures.extend(
        _leakage_failures(module, HIDDEN, transferred, LABELS[1], "dense", malformed=True)
    )
    failures.extend(
        _evidence_failures(module, HIDDEN, transferred, LABELS[1], "dense", malformed=True)
    )
    return failures


PHASES = (
    check_classify,
    check_capability,
    check_openset,
    check_crossparty,
    check_leakage,
    check_evidence,
    check_repair,
    check_transfer,
)


def run(module, seed: str) -> list[str]:
    failures: list[str] = []
    for phase in PHASES:
        failures.extend(phase(module, seed))
    return failures
