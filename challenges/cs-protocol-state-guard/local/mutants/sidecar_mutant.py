"""Author-only mutant that patches the examples instead of answering the whole space.

This is the most attractive wrong answer: it keeps the type switch and adds the guards
an author would think of after reading the failures — DATA needs AUTH, nothing after
BYE. Every conversation anyone would write by hand now behaves. It is still wrong,
because the handler was never made total: the pairs nobody wrote a test for stay open.
"""

from __future__ import annotations


def _error(name: str) -> dict[str, object]:
    return {"ok": False, "error": name}


class Session:
    def __init__(self) -> None:
        self.state = "new"
        self.received: list[str] = []

    def handle(self, message: object) -> dict[str, object]:
        if not isinstance(message, dict) or "type" not in message:
            return _error("malformed_message")
        kind = message["type"]
        if not isinstance(kind, str) or not kind:
            return _error("malformed_message")

        if kind == "DATA":
            if set(message) != {"type", "payload"}:
                return _error("malformed_message")
            payload = message["payload"]
            if not isinstance(payload, str) or not payload or len(payload) > 4096:
                return _error("malformed_message")
        elif set(message) != {"type"}:
            return _error("malformed_message")

        if self.state == "closed":
            return _error("unexpected_message")

        if kind == "HELLO":
            self.state = "greeted"
            return {"ok": True, "state": self.state}
        if kind == "AUTH":
            self.state = "ready"
            return {"ok": True, "state": self.state}
        if kind == "DATA":
            if self.state != "ready":
                return _error("unexpected_message")
            self.received.append(str(message["payload"]))
            return {"ok": True, "state": self.state, "accepted": len(self.received)}
        if kind == "BYE":
            self.state = "closed"
            return {"ok": True, "state": self.state}
        return _error("unexpected_message")


def new_session() -> Session:
    return Session()
