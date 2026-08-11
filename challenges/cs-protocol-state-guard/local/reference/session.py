"""Reference solution: a session server that is a state machine, not a switch."""

from __future__ import annotations

# The whole contract in one place: what may happen, and only from where. Everything
# not named here is refused, so adding a message type cannot silently open a hole.
TRANSITIONS: dict[tuple[str, str], str] = {
    ("new", "HELLO"): "greeted",
    ("greeted", "AUTH"): "ready",
    ("ready", "DATA"): "ready",
    ("ready", "BYE"): "closed",
}

TERMINAL = "closed"
START = "new"


def _error(name: str) -> dict[str, object]:
    return {"ok": False, "error": name}


class Session:
    """One connection's state. A session that has closed never opens again."""

    def __init__(self) -> None:
        self.state = START
        self.received: list[str] = []

    def handle(self, message: object) -> dict[str, object]:
        """Process one message and return the reply.

        A message is ``{"type": str}``, and ``DATA`` also carries ``{"payload": str}``.
        Replies are ``{"ok": True, "state": str, ...}`` or
        ``{"ok": False, "error": str}``.

        The reply for a message that is not allowed from the current state is always
        ``{"ok": False, "error": "unexpected_message"}``, and such a message changes
        nothing: not the state, and not the data the session has accepted.
        """
        if not isinstance(message, dict) or "type" not in message:
            return _error("malformed_message")
        kind = message["type"]
        if not isinstance(kind, str) or not kind:
            return _error("malformed_message")

        allowed = set(message)
        if kind == "DATA":
            if allowed != {"type", "payload"}:
                return _error("malformed_message")
            payload = message["payload"]
            if not isinstance(payload, str) or not payload or len(payload) > 4096:
                return _error("malformed_message")
        elif allowed != {"type"}:
            return _error("malformed_message")

        # The state is consulted before anything is done, and an unlisted pair is
        # refused rather than ignored. "Refused" and "quietly did nothing" look the
        # same to a careless caller and are very different to an auditor.
        destination = TRANSITIONS.get((self.state, kind))
        if destination is None:
            return _error("unexpected_message")

        if kind == "DATA":
            self.received.append(str(message["payload"]))
        self.state = destination
        if kind == "DATA":
            return {"ok": True, "state": self.state, "accepted": len(self.received)}
        return {"ok": True, "state": self.state}


def new_session() -> Session:
    """Create a fresh session in the start state."""
    return Session()
