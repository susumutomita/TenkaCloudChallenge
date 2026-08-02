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

#: In the order they are meant to be done. `transfer` is deliberately last: it is the
#: same three questions on a setting you have not seen, and it is only worth anything
#: once the first three have been done the slow way.
STAGES = ("recover", "complete", "refresh", "transfer")

#: The three that unlock the second setting. Named rather than sliced, so that adding a
#: stage later cannot silently change what the gate means.
MAIN_STAGES = ("recover", "complete", "refresh")

STAGE_LABELS = {
    "recover": "the total of a ledger whose every share is on screen",
    "complete": "one line that lands the missing share on any total at all",
    "refresh": "offsets that move every share and leave the total alone",
    "transfer": "the same three, on a modulus and a party count you have not seen",
}


def _path() -> Path:
    return Path(os.environ.get("LAB_STATE_DIR", "/tmp/ac26-w2-secret-sharing")) / "progress.json"


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
    """The second setting is shown, and accepted, only after the other three are cleared."""
    state = load()
    return all(state[stage] for stage in MAIN_STAGES)


def complete() -> bool:
    state = load()
    return all(state[stage] for stage in STAGES)
