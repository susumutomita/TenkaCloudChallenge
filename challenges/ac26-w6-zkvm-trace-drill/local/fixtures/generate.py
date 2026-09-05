"""Private, deterministic fixtures for an arithmetic/claim drill. No proof is generated.

The participant sees program inputs, example claims and receipt labels through
GET /public. Expected answers and the fixture seed stay in the verifier image.
The instruction machine wraps additions at 8 or 16, independently of the pinned
course's u16 coupon example and its 1000-unit limit.
"""
from __future__ import annotations
import hashlib

LINES = GRADED = ("exact", "trace", "overflow", "decision", "exploit", "predicate", "tamper", "binding")
SHAPES = {"exact":"int", "trace":("int",3), "overflow":("bool",3),
          "decision":("bool",2), "exploit":("bool",4), "predicate":("bool",4),
          "tamper":("bool",4), "binding":("bool",4)}


def _draw(seed, label, low, high):
    span = high-low+1
    limit = (1 << 64)-(1 << 64)%span
    for retry in range(128):
        raw = hashlib.sha256(f"{seed}:{label}:{retry}".encode()).digest()
        value = int.from_bytes(raw[:8], "big")
        if value < limit:
            return low + value%span
    raise RuntimeError("could not draw a fixture value")


def _order(seed, label, values):
    return [values[i] for i in sorted(range(len(values)), key=lambda i:hashlib.sha256(f"{seed}:{label}:{i}".encode()).digest())]


def _execution(m, discounts):
    total=0
    trace=[]
    overflow=[]
    for amount in discounts:
        raw=total+amount
        overflow.append(raw>=m)
        total=raw%m
        trace.append(total)
    return trace, overflow


def _exploit(m, case):
    exact=sum(case["discounts"])
    return exact%m <= case["limit"] and exact > case["limit"]


def setting(seed):
    m=(8,16)[_draw(seed,"machine",0,1)]
    limit=_draw(seed,"limit",1,m-3)
    discounts=[_draw(seed,f"discount-{i}",0,m-1) for i in range(3)]
    # Four observable cases: honest accept/reject and wrapping accept/reject.
    # Shuffled so no fixed answer sequence identifies their roles.
    accepted=_draw(seed,"accepted",0,limit)
    split=_draw(seed,"accepted-split",0,accepted)
    rejected=_draw(seed,"rejected",limit+1,m-1)
    split_rejected=_draw(seed,"rejected-split",0,rejected)
    wrap_accepted=_draw(seed,"wrap-accepted",0,limit)
    wrap_rejected=_draw(seed,"wrap-rejected",limit+1,m-2)
    cases=_order(seed,"cases",[
        {"discounts":[split,accepted-split,0],"limit":limit},
        {"discounts":[split_rejected,rejected-split_rejected,0],"limit":limit},
        {"discounts":[m-1,wrap_accepted+1,0],"limit":limit},
        {"discounts":[m-1,wrap_rejected+1,0],"limit":limit},
    ])
    correct_claims=[_exploit(m,c) for c in cases]
    flipped=set(_order(seed,"reports",list(range(4)))[:2])
    reports=[not value if i in flipped else value for i,value in enumerate(correct_claims)]
    program=_draw(seed,"program",1,8)
    receipts=_order(seed,"receipts",[
        {"verified":True,"program":program,"claim":"exploit"},
        {"verified":True,"program":program+1,"claim":"exploit"},
        {"verified":True,"program":program,"claim":"accept"},
        {"verified":False,"program":program,"claim":"exploit"},
    ])
    trace,overflow=_execution(m,discounts)
    exact=sum(discounts)
    expected={
        "exact":exact,
        "trace":tuple(trace),
        "overflow":tuple(overflow),
        "decision":(trace[-1]<=limit,exact<=limit),
        "exploit":tuple(correct_claims),
        "predicate":tuple(sum(c["discounts"])>c["limit"] and not hit for c,hit in zip(cases,correct_claims)),
        "tamper":tuple(report==actual for report,actual in zip(reports,correct_claims)),
        "binding":tuple(r["verified"] and r["program"]==program and r["claim"]=="exploit" for r in receipts),
    }
    public={"m":m,"limit":limit,"discounts":discounts,"cases":cases,
            "reports":reports,"program":program,"receipts":receipts}
    return {"public":public,"expected":expected}


def assignments(seed):
    return "\n".join(f"{name} = {value!r}" for name,value in setting(seed)["public"].items())


def submission_binding(seed):
    return hashlib.sha256(("ac26-w6-zkvm-trace-drill:submission:v1\0"+seed).encode()).hexdigest()


def _clean_token(token: str) -> str:
    """Strip surrounding whitespace and a single layer of quotes Python's own repr adds."""
    token = token.strip()
    if len(token) >= 2 and token[0] == token[-1] and token[0] in "'\"":
        token = token[1:-1]
    return token.strip()


def normalize_scalar(kind: str, raw: object):
    """Normalize one scalar of the given kind, or return None if it does not fit.

    Implements every kind the shared shape grammar defines (int / bool / hex / str),
    not only the ones this drill's own SHAPES table uses, so the three sibling drills'
    value graders share one normalizer contract.
    """
    if kind == "int":
        if isinstance(raw, bool):
            return None
        if isinstance(raw, int):
            return raw
        if isinstance(raw, str):
            try:
                return int(_clean_token(raw))
            except ValueError:
                return None
        return None
    if kind == "bool":
        if isinstance(raw, bool):
            return raw
        if isinstance(raw, str) and _clean_token(raw).lower() in ("true", "false"):
            return _clean_token(raw).lower() == "true"
        return None
    if kind == "hex":
        if not isinstance(raw, str):
            return None
        token = _clean_token(raw)
        if token == "":
            return None
        try:
            int(token, 16)
        except ValueError:
            return None
        return token.lower()
    if kind == "str":
        if not isinstance(raw, str):
            return None
        token = _clean_token(raw)
        return token if token != "" else None
    return None


def _split_tuple_text(raw: str) -> list[str] | None:
    """Split a pasted tuple-like string into its comma-separated parts.

    Accepts `(1, 2)`, `[1, 2]`, and bare `1, 2` -- outer brackets are optional, and are
    the only structure stripped, so a hex or string entry keeps its own quotes intact
    for `normalize_scalar` to peel off itself.
    """
    cleaned = raw.strip()
    if len(cleaned) >= 2 and cleaned[0] in "([" and cleaned[-1] in ")]":
        cleaned = cleaned[1:-1]
    if cleaned.strip() == "":
        return None
    parts = [part.strip() for part in cleaned.split(",")]
    parts = [part for part in parts if part != ""]
    return parts or None


def normalize_answer(line: str, raw: object):
    """Turn whatever the learner pasted into the shape this line's answer has.

    Every graded line declares its shape in SHAPES: a scalar ("int" / "bool" / "hex" /
    "str") or a fixed-width tuple of one of those, e.g. ("int", 2). A tuple may arrive as
    a JSON list `[1, 2]` (the verifier tries `json.loads` before calling this function),
    a Python tuple/list literal typed as text `(1, 2)` / `[1, 2]`, or bare comma-
    separated values `1, 2`.
    """
    shape = SHAPES.get(line)
    if shape is None:
        return None
    if isinstance(shape, tuple):
        kind, width = shape
        if isinstance(raw, str):
            parts = _split_tuple_text(raw)
            if parts is None:
                return None
        elif isinstance(raw, (list, tuple)):
            parts = list(raw)
        else:
            return None
        if len(parts) != width:
            return None
        values = [normalize_scalar(kind, part) for part in parts]
        if any(value is None for value in values):
            return None
        return tuple(values)
    return normalize_scalar(shape, raw)
