"""A deliberately incomplete session server.

The public contract is ``new_session()`` returning an object with
``handle(message)``. A message is ``{"type": str}``, and ``DATA`` also carries
``{"payload": str}``. Replies are ``{"ok": True, "state": str, ...}`` or
``{"ok": False, "error": str}``.

A well-behaved client sends HELLO, then AUTH, then any number of DATA, then BYE, and
this starter serves that conversation correctly — every public test agrees. What it
does not yet promise is anything about a client that does not follow that order.
"""

from __future__ import annotations


def _error(name: str) -> dict[str, object]:
    return {"ok": False, "error": name}


class Session:
    def __init__(self) -> None:
        self.state = "new"
        self.received: list[str] = []

    def handle(self, message: object) -> dict[str, object]:
        """Process one message and return the reply.

        The reply for a message that is not allowed from the current state must be
        ``{"ok": False, "error": "unexpected_message"}``, and such a message must
        change nothing: not the state, and not the data the session has accepted.

        TODO: the handler branches on the message type without asking what state the
        session is in.
        """
        if not isinstance(message, dict) or "type" not in message:
            return _error("malformed_message")
        kind = message["type"]
        if not isinstance(kind, str) or not kind:
            return _error("malformed_message")

        if kind == "HELLO":
            self.state = "greeted"
            return {"ok": True, "state": self.state}
        if kind == "AUTH":
            self.state = "ready"
            return {"ok": True, "state": self.state}
        if kind == "DATA":
            payload = message.get("payload")
            if not isinstance(payload, str) or not payload or len(payload) > 4096:
                return _error("malformed_message")
            self.received.append(payload)
            self.state = "ready"
            return {"ok": True, "state": self.state, "accepted": len(self.received)}
        if kind == "BYE":
            self.state = "closed"
            return {"ok": True, "state": self.state}
        return _error("unexpected_message")


def new_session() -> Session:
    """Create a fresh session in the start state."""
    return Session()
