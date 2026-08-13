"""Hidden property checks for the three code checkpoints.

The claim is about a conversation that never happens in the public tests: one where
the client does not follow the order. Nothing here is timing-dependent — the checker
keeps its own model of the protocol and compares every reply against it.

The last phase sweeps every combination of reachable state and message type rather
than the handful an author would think to patch. That is what separates a handler
that answers the whole (state x message) space from one that had a few ``if``
statements added until the examples passed.
"""

from __future__ import annotations

import hashlib
from types import ModuleType

# The checker's own copy of the contract. It is deliberately written out rather than
# imported from the reference, so a submission is compared against the specification
# instead of against one implementation of it.
TRANSITIONS: dict[tuple[str, str], str] = {
    ("new", "HELLO"): "greeted",
    ("greeted", "AUTH"): "ready",
    ("ready", "DATA"): "ready",
    ("ready", "BYE"): "closed",
}
STATES = ("new", "greeted", "ready", "closed")
PROTOCOL_TYPES = ("HELLO", "AUTH", "DATA", "BYE")
FOREIGN_TYPES = ("RESET", "hello", "AUTH ", "DATA2", "PING")


def _seeded_text(seed: str, label: str, width: int = 16) -> str:
    return hashlib.sha256(f"{seed}:{label}".encode("utf-8")).hexdigest()[:width]


def _message(kind: str, seed: str = "", label: str = "") -> dict[str, object]:
    if kind == "DATA":
        return {"type": "DATA", "payload": f"payload-{_seeded_text(seed, label, 20)}"}
    return {"type": kind}


def _call(session: object, message: object) -> object:
    try:
        return session.handle(message)
    except Exception as error:  # noqa: BLE001 - participant exceptions are a failed property
        return {"raised": type(error).__name__}


def _new(module: ModuleType) -> object:
    try:
        return module.new_session()
    except Exception as error:  # noqa: BLE001 - a session that cannot start is a failure
        return error


def _state_of(reply: object) -> str | None:
    return reply.get("state") if isinstance(reply, dict) else None


def _drive(module: ModuleType, kinds: list[str], seed: str, label: str) -> tuple[object, list[object]]:
    """Run a conversation from a fresh session and return it with every reply."""
    session = _new(module)
    replies = []
    for index, kind in enumerate(kinds):
        replies.append(_call(session, _message(kind, seed, f"{label}:{index}")))
    return session, replies


def _accepted(reply: object) -> object:
    return reply.get("accepted") if isinstance(reply, dict) else None


def _happy_path_properties(module: ModuleType, seed: str, phase: str) -> list[str]:
    failures: list[str] = []
    session, replies = _drive(
        module, ["HELLO", "AUTH", "DATA", "DATA", "BYE"], seed, f"{phase}:happy"
    )
    expected_states = ["greeted", "ready", "ready", "ready", "closed"]
    for index, (reply, state) in enumerate(zip(replies, expected_states, strict=True)):
        if not isinstance(reply, dict) or reply.get("ok") is not True:
            failures.append(f"the ordinary conversation was refused at step {index}")
        elif _state_of(reply) != state:
            failures.append(f"the ordinary conversation reported the wrong state at step {index}")
    if _accepted(replies[3]) != 2:
        failures.append("the session did not count both accepted DATA messages")
    return failures


def _guard_properties(module: ModuleType, seed: str, phase: str) -> list[str]:
    """A message that is not allowed from here is refused and changes nothing."""
    failures = _happy_path_properties(module, seed, phase)

    # The case the problem exists for: data before the client has authenticated.
    session = _new(module)
    _call(session, _message("HELLO"))
    early = _call(session, _message("DATA", seed, f"{phase}:early"))
    if early != {"ok": False, "error": "unexpected_message"}:
        failures.append("DATA before AUTH was not refused with unexpected_message")
    after = _call(session, _message("AUTH"))
    if _state_of(after) != "ready":
        failures.append("a refused message left the session unable to continue")
    accepted = _accepted(_call(session, _message("DATA", seed, f"{phase}:after")))
    if accepted != 1:
        failures.append("a refused DATA was still counted as accepted")

    for kinds, offender in (
        ([], "AUTH"),
        ([], "DATA"),
        ([], "BYE"),
        (["HELLO"], "HELLO"),
        (["HELLO"], "BYE"),
        (["HELLO", "AUTH"], "HELLO"),
        (["HELLO", "AUTH"], "AUTH"),
    ):
        session, _ = _drive(module, list(kinds), seed, f"{phase}:{offender}")
        reply = _call(session, _message(offender, seed, f"{phase}:{offender}"))
        if reply != {"ok": False, "error": "unexpected_message"}:
            failures.append(
                f"{offender} after {kinds or 'nothing'} was not refused with unexpected_message"
            )
    return failures


def _terminal_properties(module: ModuleType, seed: str, phase: str) -> list[str]:
    """A closed session stays closed, and sessions do not share state."""
    failures = _guard_properties(module, seed, phase)

    session, _ = _drive(module, ["HELLO", "AUTH", "DATA", "BYE"], seed, f"{phase}:closed")
    for kind in PROTOCOL_TYPES:
        reply = _call(session, _message(kind, seed, f"{phase}:reopen-{kind}"))
        if reply != {"ok": False, "error": "unexpected_message"}:
            failures.append(f"{kind} was accepted after the session had closed")

    # Two sessions must not share a state or a message log.
    first = _new(module)
    second = _new(module)
    _call(first, _message("HELLO"))
    _call(first, _message("AUTH"))
    reply = _call(second, _message("DATA", seed, f"{phase}:leak"))
    if reply != {"ok": False, "error": "unexpected_message"}:
        failures.append("one session's progress let another session skip ahead")
    _call(second, _message("HELLO"))
    _call(second, _message("AUTH"))
    accepted = _accepted(_call(second, _message("DATA", seed, f"{phase}:count")))
    if accepted != 1:
        failures.append("a second session counted the first session's messages")

    # A malformed message is reported as malformed and must not advance anything.
    session, _ = _drive(module, ["HELLO", "AUTH"], seed, f"{phase}:malformed")
    for malformed in (
        {"type": "DATA"},
        {"type": "DATA", "payload": ""},
        {"type": "DATA", "payload": 7},
        {"type": ""},
        {"payload": "x"},
        "HELLO",
        {"type": "HELLO", "extra": 1},
    ):
        reply = _call(session, malformed)
        if reply != {"ok": False, "error": "malformed_message"}:
            failures.append(f"a malformed message was not reported as such: {malformed!r}")
    accepted = _accepted(_call(session, _message("DATA", seed, f"{phase}:still")))
    if accepted != 1:
        failures.append("a malformed message changed what the session had accepted")
    return failures


def _model_reply(state: str, message: dict[str, object], accepted: int) -> dict[str, object]:
    kind = message.get("type")
    if not isinstance(kind, str) or not kind:
        return {"ok": False, "error": "malformed_message"}
    if kind == "DATA":
        if set(message) != {"type", "payload"}:
            return {"ok": False, "error": "malformed_message"}
        payload = message["payload"]
        if not isinstance(payload, str) or not payload or len(payload) > 4096:
            return {"ok": False, "error": "malformed_message"}
    elif set(message) != {"type"}:
        return {"ok": False, "error": "malformed_message"}
    destination = TRANSITIONS.get((state, kind))
    if destination is None:
        return {"ok": False, "error": "unexpected_message"}
    if kind == "DATA":
        return {"ok": True, "state": destination, "accepted": accepted + 1}
    return {"ok": True, "state": destination}


def _generalize_properties(module: ModuleType, seed: str, phase: str) -> list[str]:
    """Every reachable state answers every message type, the same way the contract does."""
    failures = _terminal_properties(module, seed, phase)

    prefixes = {
        "new": [],
        "greeted": ["HELLO"],
        "ready": ["HELLO", "AUTH"],
        "closed": ["HELLO", "AUTH", "BYE"],
    }
    accepted_before = {"new": 0, "greeted": 0, "ready": 0, "closed": 0}

    for state in STATES:
        for kind in (*PROTOCOL_TYPES, *FOREIGN_TYPES):
            session, _ = _drive(module, list(prefixes[state]), seed, f"{phase}:{state}:{kind}")
            message = _message(kind, seed, f"{phase}:{state}:{kind}")
            expected = _model_reply(state, message, accepted_before[state])
            actual = _call(session, message)
            if actual != expected:
                failures.append(
                    f"from {state}, {kind} gave {actual!r} instead of {expected!r}"
                )
                # One example per cell is enough to explain the gap.
                return failures

            # A refusal must leave the session exactly where it was.
            if expected.get("ok") is not True:
                recovery = ["HELLO", "AUTH"][len(prefixes[state]) :]
                for follow_up in recovery:
                    _call(session, _message(follow_up))
                if state != "closed":
                    reply = _call(session, _message("DATA", seed, f"{phase}:recover"))
                    if _accepted(reply) != accepted_before[state] + 1:
                        failures.append(
                            f"a refused {kind} from {state} changed what the session accepted"
                        )
                        return failures
    return failures


def check_guard(module: ModuleType, seed: str) -> list[str]:
    return _guard_properties(module, seed, "guard-checkpoint")


def check_terminal(module: ModuleType, seed: str) -> list[str]:
    return _terminal_properties(module, seed, "terminal-checkpoint")


def check_generalize(module: ModuleType, seed: str) -> list[str]:
    return _generalize_properties(module, seed, "generalize-checkpoint")


def run(module: ModuleType, seed: str) -> list[str]:
    return _generalize_properties(module, seed, "full-run")
