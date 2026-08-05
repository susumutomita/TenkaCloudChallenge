"""Reference classification. Inside the image only; never mounted to the host."""

from __future__ import annotations

from fixtures.generate import TRUTH

PROPERTIES = ("complete", "sound", "private")


def classify(protocol_id: str) -> dict[str, bool]:
    return dict(TRUTH[protocol_id])
