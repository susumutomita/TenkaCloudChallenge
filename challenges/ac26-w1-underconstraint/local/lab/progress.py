"""Where the lab remembers what you have cleared.

`/tmp` because the compose service runs with `read_only: true` and a tmpfs mounted
there: it is the only writable path in the container. That also means progress is
lost when the container is recreated, which is stated in the README rather than
worked around -- the two stages take a few seconds to redo once you know the answer,
and a durable store would be a second thing that can be wrong.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

STAGES = ("check", "repair")

STAGE_LABELS = {
    "check": "a forged witness that the deployed circuit accepts and the policy calls false",
    "repair": "the missing constraint, added back without breaking the honest cases",
}


def _path() -> Path:
    return Path(os.environ.get("LAB_STATE_DIR", "/tmp/ac26-w1-underconstraint")) / "progress.json"


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


def complete() -> bool:
    state = load()
    return all(state[stage] for stage in STAGES)
