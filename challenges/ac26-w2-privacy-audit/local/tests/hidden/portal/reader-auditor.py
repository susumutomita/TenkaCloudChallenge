"""Independent reader implementation from the original public packet only.

No reference, fixture, hidden checker or verifier implementation was read.
Frozen before baseline requests, 2026-09-07.
"""


def allowed_opens(spec):
    names = set(spec["publicInputs"])
    names.update(spec["masked"])
    names.add(spec["result"])
    return sorted(names)


def first_violation(trace, spec):
    allowed = allowed_opens(spec)
    for index, event in enumerate(trace):
        kind = event["kind"]
        reason = None
        if kind == "peek" and event["party"] != event["owner"]:
            reason = "cross-party-read"
        if event["label"] not in allowed:
            if kind == "open":
                reason = "opened-a-secret"
            if kind == "emit":
                reason = "leaked-in-log"
            if kind == "fail":
                reason = "leaked-in-error"
        if reason:
            return {"kind": reason, "index": index}
    return None


def derive_secret(transcript, spec):
    seen = {entry["label"]: entry["value"] for entry in transcript}
    allowed = allowed_opens(spec)
    extras = [name for name in seen if name not in allowed]
    if not extras:
        return {}
    total = seen[spec["result"]]
    partial = seen[extras[0]]
    weight = seen[spec["publicInputs"][-1]]
    return {"party": spec["parties"][-1],
            "value": (total-partial)*pow(weight,-1,spec["p"]) % spec["p"]}


def repair(program, spec):
    allowed = allowed_opens(spec)
    out = []
    for op in program:
        if op[0] in ("open", "emit", "fail") and op[1] not in allowed:
            continue
        if op[0] == "peek" and op[1] != op[2]:
            continue
        out.append(op)
    return out
