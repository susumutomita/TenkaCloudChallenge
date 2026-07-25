"""The only file you edit.

Three teams shipped the same private risk score. All three return the right total.
One of them is fine. The others are not, and the difference is not in the answer.

You are given, per implementation:

    trace       the observable events, in order
    spec        which labels the protocol is allowed to reveal
    program     the operation list itself (needed only for `repair`)

An event looks like:

    {"kind": "open",   "label": "masked-p1", "value": 402, ...}
    {"kind": "peek",   "party": "p0", "owner": "p1", ...}
    {"kind": "emit",   "label": "x-p1", "text": "debug: share", "value": 71, ...}
    {"kind": "fail",   "label": "x-p1", "text": "assertion failed", "value": 71, ...}
    {"kind": "output", "label": "total", "value": 913, ...}

Run `make inspect` to see real ones. Note before you start: not every log line is a
leak, and not every read is a cross-party read.
"""

from __future__ import annotations

VIOLATIONS = (
    "opened-a-secret",
    "cross-party-read",
    "leaked-in-log",
    "leaked-in-error",
)


def allowed_opens(spec: dict) -> list[str]:
    """Every label this protocol is permitted to reveal, sorted.

    Derive it from the specification. Three kinds of label belong here; the rest are
    intermediate secrets.
    """
    return []


def first_violation(trace: list[dict], spec: dict) -> dict | None:
    """The first event that leaks something, or None if the run is clean.

    Return {"kind": <one of VIOLATIONS>, "index": <position in trace>}.

    Both halves matter: an auditor that says "something leaked" without saying where
    has not localized anything, and one that flags a clean run is worse than none.
    """
    return {"kind": "opened-a-secret", "index": 0}


def derive_secret(transcript: list[dict], spec: dict) -> dict:
    """From a transcript that revealed too much, recover somebody's private value.

    Return {"party": <party id>, "value": <their private value>}.

    Naming the extra opening is not the same as showing it hurt. This is where you show
    it. Everything you need is in the transcript and the specification; the arithmetic
    is one subtraction and one inverse.
    """
    return {}


def repair(program: list, spec: dict) -> list:
    """Return a program that computes the same total without the leak.

    Deleting the protocol would also be private. What is asked for is narrower: after
    the repair, everything the specification allows to be observed must still be
    observed, and nothing else.
    """
    return list(program)
