"""Where the lab remembers what you have cleared.

`/tmp` because the compose service runs with `read_only: true` and a tmpfs mounted
there: it is the only writable path in the container. That also means progress is lost
when the container is recreated, which is stated in the README rather than worked
around -- the readings take a few minutes to redo once you know what they are, and a
durable store would be a second thing that can be wrong.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

#: In the order they are meant to be done.
STAGES = ("reject", "recover", "forge", "classify", "transfer")

#: The three demonstrations. Naming a property a verifier breaks is only worth anything
#: after a break has actually been produced, so these gate `classify`.
DEMONSTRATIONS = ("reject", "recover", "forge")

#: Everything the second panel waits on. Named rather than sliced, so that adding a
#: stage later cannot silently change what a gate means.
MAIN_STAGES = ("reject", "recover", "forge", "classify")

STAGE_LABELS = {
    "reject": "a witness the statement is true of that one of them refuses",
    "recover": "the value the honest run used, read out of a record",
    "forge": "a witness outside the range that one of them accepts",
    "classify": "what each verifier still holds, once all three breaks are on the table",
    "transfer": "the same three demonstrations on a second panel",
}


def _path() -> Path:
    return Path(os.environ.get("LAB_STATE_DIR", "/tmp/ac26-bridge-properties")) / "progress.json"


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


def classify_unlocked() -> bool:
    """The classification opens once every break has been demonstrated."""
    state = load()
    return all(state[stage] for stage in DEMONSTRATIONS)


def transfer_unlocked() -> bool:
    """The second panel is handed over only after the first one is finished."""
    state = load()
    return all(state[stage] for stage in MAIN_STAGES)


def complete() -> bool:
    state = load()
    return all(state[stage] for stage in STAGES)
