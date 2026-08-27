"""Reference solution. Ships inside the image so the mutation suite can break it on purpose.

Six of the seven functions are short, because reading a record is short. What takes the space
is being precise about which record answers which question: `reached()` answers what a run was
able to do, `openings()` answers what it published to the other parties, and the `Disclosure`
answers what it published to us. A prover can be spotless in one and not in another, and three
of the specimens are exactly that.

The one predicate that appears twice is `_authorized`. An opening is the multiplication's own
iff a reserved mask is behind it **and** it went out in the round the relation declared. The
classification checkpoint needs it to tell an allowed open from a secret intermediate, and the
open-set checkpoint needs it to tell which openings were nobody's business. Writing it once is
not an economy; it is the statement that those two questions are the same question.
"""

from __future__ import annotations

from participant.mpc import (
    ALLOWED_NAMES,
    AUDIENCES,
    FORMS,
    ORIGINS,
    PROTOCOL_CAPABILITIES,
    SHARING_ONLY_NAMES,
    beaver_product,
    clean_artifact,
    is_sharing,
    round_id_for,
)
from participant.lab import malformed_row


# ---------------------------------------------------------------------------
# the predicate two checkpoints share
# ---------------------------------------------------------------------------


def _authorized(record: dict, row: dict) -> bool:
    """Whether an opening is the multiplication's own masked `d` or `e`.

    Both halves are load-bearing. Without a reserved mask in its ancestry an opening published
    something nothing was hiding; outside the declared round it spent a mask on a value that
    mask was not drawn for, which is the same defect as reusing a triple wearing a disguise.
    """
    return bool(record.get("maskedBy")) and record.get("roundId") == round_id_for(row)


# ---------------------------------------------------------------------------
# 1. the policy
# ---------------------------------------------------------------------------


def classify(entry: dict, row: dict) -> str:
    for field, vocabulary in (("origin", ORIGINS), ("form", FORMS), ("audience", AUDIENCES)):
        if entry.get(field) not in vocabulary:
            raise ValueError(f"{field} {entry.get(field)!r} is not one of {vocabulary}")
    opened = entry.get("opened")
    if opened is not None and not isinstance(opened, dict):
        raise ValueError("opened must be None or an opening record")

    # Precedence, not a lookup. The same provenance lands in three different classes
    # depending on who holds it and whether the protocol authorized the disclosure.
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
    # Everything left is witness-derived, in the clear, and nothing authorized it -- including
    # an opening that happened. That an opening *happened* is not what makes a value allowed.
    return "secret-intermediate"


# ---------------------------------------------------------------------------
# 2. what a run was able to do
# ---------------------------------------------------------------------------


def capability_audit(probe, specimen_id: str) -> tuple[str, ...]:
    honest = probe(specimen_id)
    # One run is one input. A specimen whose only defect is on the error path is spotless
    # until something makes it take that path, so the audit has to supply one.
    runs = (honest, probe(specimen_id, malformed_row(honest.row)))
    reached = {record["capability"] for run in runs for record in run.runtime.reached()}
    return tuple(sorted(reached.difference(PROTOCOL_CAPABILITIES)))


# ---------------------------------------------------------------------------
# 3. what a run published to the other parties
# ---------------------------------------------------------------------------


def open_set_audit(evidence) -> tuple[dict, ...]:
    return tuple(
        {
            "roundId": record["roundId"],
            "shareIds": tuple(record["shareIds"]),
            "masked": bool(record["maskedBy"]),
        }
        for record in evidence.runtime.openings()
        if not _authorized(record, evidence.row)
    )


# ---------------------------------------------------------------------------
# 4. whose shares a run read
# ---------------------------------------------------------------------------


def cross_party_audit(evidence) -> dict:
    peeks = [record for record in evidence.runtime.reached() if record["capability"] == "peek"]
    parties = tuple(sorted({record["party"] for record in peeks}))
    return {
        "peeks": len(peeks),
        "parties": parties,
        # No single party owns shares belonging to two parties, so the moment two owners
        # appear somebody read across a boundary -- whatever they did with what they read.
        "crossed": len(parties) > 1,
    }


# ---------------------------------------------------------------------------
# 5. what a run published to us
# ---------------------------------------------------------------------------


def _channels(disclosure):
    """Every `(channel, field name, value, sibling fields)` a disclosure puts in front of us."""
    yield from (("artifact", name, value, disclosure.artifact)
                for name, value in disclosure.artifact.items())
    for record in disclosure.log:
        yield from (("log", name, value, record["values"])
                    for name, value in record["values"].items())
    yield from (("metrics", name, value, disclosure.metrics)
                for name, value in disclosure.metrics.items())
    if disclosure.error is not None:
        yield from (("error", name, value, disclosure.error["values"])
                    for name, value in disclosure.error["values"].items())


def leakage_audit(evidence) -> tuple[tuple[str, str], ...]:
    parties = evidence.setting["parties"]
    out = set()
    for channel, name, value, _ in _channels(evidence.disclosure):
        if name not in ALLOWED_NAMES:
            out.add((channel, name))
        elif name in SHARING_ONLY_NAMES and not is_sharing(value, parties):
            # An approved label is not an approval. `C` may be published; a reconstructed
            # `C` wearing the name `C` is a different disclosure entirely.
            out.add((channel, name))
    return tuple(sorted(out))


# ---------------------------------------------------------------------------
# 6. what we can recover from it
# ---------------------------------------------------------------------------


def _outside_policy(name: str, value) -> bool:
    """The same two rules, against a disclosure whose sharings arrived as opaque ids."""
    if name not in ALLOWED_NAMES:
        return True
    return name in SHARING_ONLY_NAMES and not (
        isinstance(value, (list, tuple)) and value and all(isinstance(item, str) for item in value)
    )


def _integer(value) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _derive(value, siblings: dict, prime: int) -> int | None:
    """The secret behind one disclosed value, or `None` if it does not yield one."""
    if isinstance(value, (list, tuple)) and value and all(_integer(item) for item in value):
        # A sharing in the clear. Additive shares sum to what they were hiding.
        return sum(value) % prime
    if not _integer(value):
        return None
    mask_partner = siblings.get("d")
    if _integer(mask_partner):
        # Published next to the value it was masking. `d = A - x` was safe exactly because
        # `x` was not public; the two of them together are `A`.
        return (value + mask_partner) % prime
    return value % prime


def leakage_evidence(disclosure, setting) -> dict | None:
    prime = setting["p"]
    for channel, name, value, siblings in _channels(disclosure):
        if not _outside_policy(name, value):
            continue
        recovered = _derive(value, siblings, prime)
        if recovered is not None:
            return {"value": recovered, "from": (channel, name)}
    return None


# ---------------------------------------------------------------------------
# 7. the repair
# ---------------------------------------------------------------------------


def private_prover(runtime, row: dict, halves: dict, triple, sink) -> dict:
    proof = beaver_product(runtime, row, halves, triple)
    # Everything below names the run. Nothing below carries any of it.
    sink.emit("multiplication", tripleId=proof["tripleId"], roundId=proof["roundId"])
    sink.emit("opened", d=proof["d"], e=proof["e"])
    sink.metric("operations", len(runtime.events()))
    sink.metric("rounds", len({record["roundId"] for record in runtime.openings()}))
    sink.metric("openings", len(runtime.openings()))
    sink.publish(clean_artifact(row, proof))
    return proof
