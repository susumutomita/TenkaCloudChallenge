"""Reference classification. Inside the image only; never mounted to the host."""

from __future__ import annotations

PROPERTIES = ("complete", "sound", "private")

_TRUTH = {
    "p1": {"complete": False, "sound": True, "private": True},
    "p2": {"complete": True, "sound": False, "private": True},
    "p3": {"complete": True, "sound": True, "private": False},
}


def classify(protocol_id: str) -> dict[str, bool]:
    return dict(_TRUTH[protocol_id])
