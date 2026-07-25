"""One of the two files you edit.

For each toy protocol, say which security properties it satisfies. Run
`make inspect` to see the three verifiers' source and a worked example.

  complete — every TRUE statement with an honest witness is accepted
  sound    — a FALSE statement cannot be accepted
  private  — the transcript does not reveal the witness

These three are independent. A protocol can satisfy any subset. Labels alone are
not enough: the counterexample checkpoints make you prove the ones you mark False.
"""

from __future__ import annotations

PROPERTIES = ("complete", "sound", "private")


def classify(protocol_id: str) -> dict[str, bool]:
    """Return {"complete": bool, "sound": bool, "private": bool} for one protocol.

    The starter marks everything True — which is what "all the happy-path tests
    passed" would tell you, and is wrong for all three.
    """
    return {"complete": True, "sound": True, "private": True}
