"""A deliberately incomplete file publisher.

The public contract is ``publish(target_path, content)``. It returns
``{"ok": True, "path": str, "bytes": int}`` on success and
``{"ok": False, "error": str}`` for invalid input.

This starter writes the right bytes: once it returns, the file on disk holds exactly
the content it was given, and every public test agrees. What it does not yet promise
is anything about the moments *while* it is writing, or about what survives if the
process dies in the middle. The public tests intentionally do not look there.
"""

from __future__ import annotations

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
    """Publish ``content`` at ``target_path``.

    TODO: make the replacement indivisible for readers, make the published bytes
    durable, and leave no work file behind when something fails.
    """
    text = _validate_content(content)
    if text is None:
        return _error("invalid_content")
    target = _validate_target(target_path)
    if target is None:
        return _error("invalid_target")

    payload = text.encode("utf-8")
    with open(target, "wb") as stream:
        stream.write(payload)

    return {"ok": True, "path": str(target), "bytes": len(payload)}
