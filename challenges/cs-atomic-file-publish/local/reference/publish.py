"""Reference solution: publish a file so no reader ever observes a partial one."""

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
    """Publish ``content`` at ``target_path`` as one indivisible replacement.

    The published bytes are UTF-8. A reader that opens ``target_path`` at any moment
    sees either the entire previous file or the entire new one, never a prefix and
    never an empty file. After this call returns ``{"ok": True, ...}`` the new
    contents survive a power loss, and the directory holds no leftover work files.
    """
    text = _validate_content(content)
    if text is None:
        return _error("invalid_content")
    target = _validate_target(target_path)
    if target is None:
        return _error("invalid_target")

    payload = text.encode("utf-8")
    directory = target.parent if str(target.parent) else Path(".")

    # The work file must live in the destination directory: os.replace is only
    # atomic within one filesystem, and /tmp is very often a different one.
    handle, temporary_name = tempfile.mkstemp(
        dir=str(directory), prefix=f".{target.name}.", suffix=".publish"
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(handle, "wb") as stream:
            stream.write(payload)
            stream.flush()
            # Order matters: the data must be on the medium before the name points
            # at it, otherwise a crash can publish a name with no contents behind it.
            os.fsync(stream.fileno())
        os.replace(temporary, target)
    except BaseException:
        # A failed publish must leave neither a torn target nor a work file.
        temporary.unlink(missing_ok=True)
        raise

    # Renaming is journalled separately from the directory entry itself; without
    # this the new name can be lost even though its data was flushed.
    directory_fd = os.open(str(directory), os.O_RDONLY)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)

    return {"ok": True, "path": str(target), "bytes": len(payload)}
