"""Reference solution. Inside the image only; never mounted to the host."""

from __future__ import annotations


def allowed_opens(spec: dict) -> list[str]:
    return sorted({*spec["publicInputs"], *spec["masked"], spec["result"]})


def first_violation(trace: list[dict], spec: dict) -> dict | None:
    allowed = set(allowed_opens(spec))
    for index, event in enumerate(trace):
        kind = event["kind"]
        if kind == "open" and event["label"] not in allowed:
            return {"kind": "opened-a-secret", "index": index}
        if kind == "peek" and event["party"] != event["owner"]:
            return {"kind": "cross-party-read", "index": index}
        # A log line or an error message is only a leak when the value in it is not
        # something the specification already publishes.
        if kind == "emit" and event["label"] not in allowed:
            return {"kind": "leaked-in-log", "index": index}
        if kind == "fail" and event["label"] not in allowed:
            return {"kind": "leaked-in-error", "index": index}
    return None


def derive_secret(transcript: list[dict], spec: dict) -> dict:
    """Recover a party's private value from a transcript that opened too much.

    The partial sum and the total are both in the transcript, so their difference is the
    last party's weighted contribution, and the weight is public and invertible.
    """
    seen = {entry["label"]: entry["value"] for entry in transcript}
    p = spec["p"]
    partials = [
        label
        for label in seen
        if label not in set(allowed_opens(spec))
    ]
    if not partials or spec["result"] not in seen:
        return {}
    partial = seen[partials[0]]
    party = spec["parties"][-1]
    weight_label = spec["publicInputs"][-1]
    weight = seen[weight_label]
    contribution = (seen[spec["result"]] - partial) % p
    return {"party": party, "value": contribution * pow(weight, -1, p) % p}


def repair(program: list, spec: dict) -> list:
    """Drop exactly the offending operations and nothing else.

    Removing the whole protocol would also be private, and would also still output the
    total -- so the criterion is that everything the specification allows to be observed
    is still observed afterwards.
    """
    allowed = set(allowed_opens(spec))
    out = []
    for op in program:
        kind = op[0]
        if kind == "open" and op[1] not in allowed:
            continue
        if kind == "peek" and op[1] != op[2]:
            continue
        if kind in ("emit", "fail") and op[1] not in allowed:
            continue
        out.append(op)
    return out
