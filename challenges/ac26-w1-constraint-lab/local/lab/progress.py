"""Where the lab remembers what you have cleared, and what that unlocks.

`/tmp` because the compose service runs with `read_only: true` and a tmpfs mounted
there: it is the only writable path in the container. That also means progress is
lost when the container is recreated, which is stated in the README rather than
worked around -- the three stages take a couple of minutes to redo once you know
the answers, and a durable store would be a second thing that can be wrong.

The transfer stage is gated rather than merely last. The second circuit is not
printed and not gradeable until `trace` and `admit` are cleared, so the stage that
proves the skill generalises cannot be attempted alongside the ones that teach it.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

STAGES = ("trace", "admit", "transfer")

STAGE_LABELS = {
    "trace": "every residual of the witness the monitor refused",
    "admit": "the residual that is zero on exactly the licensed tiers",
    "transfer": "the same reading, on a circuit you have not seen",
}

#: What has to be cleared before the transfer circuit is handed over at all.
TRANSFER_REQUIRES = ("trace", "admit")


def _path() -> Path:
    return Path(os.environ.get("LAB_STATE_DIR", "/tmp/ac26-w1-constraint-lab")) / "progress.json"


def load() -> dict[str, bool]:
    try:
        stored = json.loads(_path().read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {stage: False for stage in STAGES}
    if not isinstance(stored, dict):
        return {stage: False for stage in STAGES}
    return {stage: bool(stored.get(stage)) for stage in STAGES}


def record(stage: str) -> None:
    if stage not in STAGES:
        raise ValueError(f"unknown stage: {stage}")
    state = load()
    state[stage] = True
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state), encoding="utf-8")


def transfer_unlocked() -> bool:
    state = load()
    return all(state[stage] for stage in TRANSFER_REQUIRES)


def complete() -> bool:
    state = load()
    return all(state[stage] for stage in STAGES)
