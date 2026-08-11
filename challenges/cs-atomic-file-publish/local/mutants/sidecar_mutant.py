"""Author-only mutant that stages its work file in /tmp instead of beside the target.

This is the most attractive wrong answer: it *does* use a temporary file and *does*
call os.replace, so it looks like the textbook solution and passes any check that only
asks "was there a rename?". It is still broken, because a rename is only atomic within
one filesystem and /tmp is routinely a different one — on the machines where that is
true the publish degrades to a copy, and the torn window comes straight back.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path


def _error(name: str) -> dict[str, object]:
    return {"ok": False, "error": name}


def _validate_content(value: object) -> str | None:
    if not isinstance(value, str) or len(value) > 4_000_000:
        return None
    return value


def _validate_target(value: object) -> Path | None:
    if isinstance(value, Path):
        candidate = value
    elif isinstance(value, str) and value:
        candidate = Path(value)
    else:
        return None
    if not candidate.name or candidate.name in {".", ".."}:
        return None
    parent = candidate.parent if str(candidate.parent) else Path(".")
    return candidate if parent.is_dir() else None


def publish(target_path: object, content: object) -> dict[str, object]:
    text = _validate_content(content)
    if text is None:
        return _error("invalid_content")
    target = _validate_target(target_path)
    if target is None:
        return _error("invalid_target")

    payload = text.encode("utf-8")
    handle, temporary_name = tempfile.mkstemp(prefix="publish-", suffix=".tmp")
    temporary = Path(temporary_name)
    try:
        with os.fdopen(handle, "wb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, target)
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise

    directory = target.parent if str(target.parent) else Path(".")
    directory_fd = os.open(str(directory), os.O_RDONLY)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)

    return {"ok": True, "path": str(target), "bytes": len(payload)}
