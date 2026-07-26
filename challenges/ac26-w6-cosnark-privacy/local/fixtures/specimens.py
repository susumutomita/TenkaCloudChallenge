"""Eight co-SNARK provers that all compute the same relation, and do not all keep it.

Every specimen here calls the supplied `beaver_product` and publishes an artifact whose `C`
reconstructs to `A * B`. Line them up and a correctness test cannot tell them apart -- that is
the premise of the problem, not a spoiler. What differs is which capability each one reaches
and what each one puts in front of the participant.

The identifiers are opaque on purpose (`S1`..`S8`). An audit that reads the specimen's name is
not an audit, and neither is one that greps its source: two of these reach `reconstruct`
through a name that does not contain the word.

`SPECIMENS` is what the participant is handed. `GROUND_TRUTH` is not -- it lives here because
the hidden checker imports it to decide whether a submitted counterexample really recovered
something secret, and the participant module never imports this name.
"""

from __future__ import annotations

from fixtures.generate import (
    beaver_product,
    clean_artifact,
    linear_halves,
    round_id_for,
)


def _counts(runtime) -> dict:
    return {
        "operations": len(runtime.events()),
        "rounds": len({record["roundId"] for record in runtime.openings()}),
        "openings": len(runtime.openings()),
    }


# ---------------------------------------------------------------------------
# S1 -- the one that keeps everything
# ---------------------------------------------------------------------------


def s1(runtime, row, halves, triple, sink) -> dict:
    proof = beaver_product(runtime, row, halves, triple)
    sink.emit("multiplication", tripleId=proof["tripleId"], roundId=proof["roundId"])
    sink.emit("opened", d=proof["d"], e=proof["e"])
    for name, value in _counts(runtime).items():
        sink.metric(name, value)
    sink.publish(clean_artifact(row, proof))
    return proof


# ---------------------------------------------------------------------------
# S2 -- a reconstructed A, published as an operator metric
# ---------------------------------------------------------------------------


def s2(runtime, row, halves, triple, sink) -> dict:
    proof = beaver_product(runtime, row, halves, triple)
    sink.emit("multiplication", tripleId=proof["tripleId"], roundId=proof["roundId"])
    for name, value in _counts(runtime).items():
        sink.metric(name, value)
    # An operator wanted to alert on the row's left half drifting. Nothing about the metric
    # name says "secret".
    sink.metric("prover.left_half", runtime.reconstruct(proof["A"]))
    sink.publish(clean_artifact(row, proof))
    return proof


# ---------------------------------------------------------------------------
# S3 -- the mask, logged next to the value it was masking
# ---------------------------------------------------------------------------


def s3(runtime, row, halves, triple, sink) -> dict:
    proof = beaver_product(runtime, row, halves, triple)
    # Debugging a mismatched opening once needed the mask alongside it, and the line stayed.
    # `d` is a published value and belongs here. `x` is the reason `d` was safe to publish.
    mask = sum(runtime.peek(share) for share in triple.x) % row["p"]
    sink.emit("multiplication", tripleId=proof["tripleId"], roundId=proof["roundId"])
    sink.emit("opened", d=proof["d"], e=proof["e"], x=mask)
    for name, value in _counts(runtime).items():
        sink.metric(name, value)
    sink.publish(clean_artifact(row, proof))
    return proof


# ---------------------------------------------------------------------------
# S4 -- C, opened and shipped as the artifact's C
# ---------------------------------------------------------------------------


def s4(runtime, row, halves, triple, sink) -> dict:
    proof = beaver_product(runtime, row, halves, triple)
    artifact = clean_artifact(row, proof)
    # "The next stage wanted a number." It reconstructs to A * B, so it verifies.
    artifact["C"] = runtime.reconstruct(proof["C"])
    sink.emit("multiplication", tripleId=proof["tripleId"], roundId=proof["roundId"])
    for name, value in _counts(runtime).items():
        sink.metric(name, value)
    sink.publish(artifact)
    return proof


# ---------------------------------------------------------------------------
# S5 -- one opening too many, in a round the relation never declared
# ---------------------------------------------------------------------------


def s5(runtime, row, halves, triple, sink) -> dict:
    proof = beaver_product(runtime, row, halves, triple)
    # A "sanity check" that the left half matched what the coefficients said. It publishes
    # nothing into the disclosure at all -- the leak is the opening itself.
    runtime.open(f"{row['relationId']}:sanity", proof["A"])
    sink.emit("multiplication", tripleId=proof["tripleId"], roundId=proof["roundId"])
    for name, value in _counts(runtime).items():
        sink.metric(name, value)
    sink.publish(clean_artifact(row, proof))
    return proof


# ---------------------------------------------------------------------------
# S6 -- clean until the input is not
# ---------------------------------------------------------------------------


def s6(runtime, row, halves, triple, sink) -> dict:
    try:
        if len(row["a"]) != row["width"]:
            raise ValueError("coefficient vector does not match the declared width")
        proof = beaver_product(runtime, row, halves, triple)
    except Exception as error:  # noqa: BLE001 - the handler is the defect
        # Someone wanted the failing state in the error. The happy path is spotless.
        sink.fail(
            f"prover failed: {error}",
            shares=tuple(runtime.peek(share) for share in halves["A"]),
        )
        return {}
    sink.emit("multiplication", tripleId=proof["tripleId"], roundId=proof["roundId"])
    for name, value in _counts(runtime).items():
        sink.metric(name, value)
    sink.publish(clean_artifact(row, proof))
    return proof


# ---------------------------------------------------------------------------
# S7 -- reads every party's share, tells nobody
# ---------------------------------------------------------------------------


def s7(runtime, row, halves, triple, sink) -> dict:
    proof = beaver_product(runtime, row, halves, triple)
    # A "verify our own arithmetic" pass. Nothing it learns leaves the process, so the
    # disclosure is identical to S1's -- and one party's operator now holds the witness half.
    total = 0
    for share in halves["B"]:
        total = (total + runtime.peek(share)) % row["p"]
    sink.emit("multiplication", tripleId=proof["tripleId"], roundId=proof["roundId"])
    sink.emit("opened", d=proof["d"], e=proof["e"])
    for name, value in _counts(runtime).items():
        sink.metric(name, value)
    sink.publish(clean_artifact(row, proof))
    return proof


# ---------------------------------------------------------------------------
# S8 -- the same defect as S2, reached through a name that does not spell it
# ---------------------------------------------------------------------------


def s8(runtime, row, halves, triple, sink) -> dict:
    proof = beaver_product(runtime, row, halves, triple)
    sink.emit("multiplication", tripleId=proof["tripleId"], roundId=proof["roundId"])
    for name, value in _counts(runtime).items():
        sink.metric(name, value)
    # `grep reconstruct` finds nothing in this function. The capability record does.
    combine = getattr(runtime, "recon" + "struct")
    sink.emit("checkpoint", witness_digest=combine(proof["B"]))
    sink.publish(clean_artifact(row, proof))
    return proof


#: What the participant is handed: opaque ids in a fixed order, and nothing else.
SPECIMENS = (
    ("S1", s1),
    ("S2", s2),
    ("S3", s3),
    ("S4", s4),
    ("S5", s5),
    ("S6", s6),
    ("S7", s7),
    ("S8", s8),
)

SPECIMEN_IDS = tuple(identifier for identifier, _ in SPECIMENS)


def specimen(identifier: str):
    """The runnable prover behind an id."""
    for name, function in SPECIMENS:
        if name == identifier:
            return function
    raise KeyError(f"no specimen {identifier!r}")


def run_specimen(identifier: str, runtime, row, halves, triple, sink):
    """Run one specimen against a runtime and a sink. Exceptions are the specimen's own."""
    return specimen(identifier)(runtime, row, halves, triple, sink)


#: Ground truth, for the hidden checker only. Never imported by a participant module.
#:
#:  capabilities   the capability names the specimen reaches beyond S1's
#:  unauthorized   how many of its openings are not the multiplication's own d and e
#:  disclosed      (channel, field name) pairs it puts in front of the participant that are
#:                 not on the allowlist, or are on it carrying the wrong kind of value
#:  recoverable    the secret an auditor can derive from the disclosure alone, if any
GROUND_TRUTH = {
    "S1": {"capabilities": (), "unauthorized": 0, "disclosed": (), "recoverable": None},
    "S2": {
        "capabilities": ("reconstruct",),
        "unauthorized": 0,
        "disclosed": (("metrics", "prover.left_half"),),
        "recoverable": "A",
    },
    "S3": {
        "capabilities": ("peek",),
        "unauthorized": 0,
        "disclosed": (("log", "x"),),
        "recoverable": "A",
    },
    "S4": {
        "capabilities": ("reconstruct",),
        "unauthorized": 0,
        "disclosed": (("artifact", "C"),),
        "recoverable": "C",
    },
    "S5": {"capabilities": (), "unauthorized": 1, "disclosed": (), "recoverable": None},
    "S6": {"capabilities": (), "unauthorized": 0, "disclosed": (), "recoverable": None},
    "S7": {"capabilities": ("peek",), "unauthorized": 0, "disclosed": (), "recoverable": None},
    "S8": {
        "capabilities": ("reconstruct",),
        "unauthorized": 0,
        "disclosed": (("log", "witness_digest"),),
        "recoverable": "B",
    },
}

#: S6 is only defective on the error path, so the audit has to feed it one. A row whose
#: declared width disagrees with its coefficient vector is enough.
MALFORMED_SPECIMENS = ("S6",)
