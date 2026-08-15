"""Reference solution: a cursor that names a row, not a position.

An offset remembers *where* the iteration was; the table moves and the position
silently means something else. A keyset cursor remembers *what* was last served
— the id itself — and ids do not move. Each page re-reads the live table and
serves the newest rows strictly older than that id.
"""

from __future__ import annotations

_INVALID = object()


def _error(name: str) -> dict[str, object]:
    return {"ok": False, "error": name}


def _parse_cursor(cursor: object) -> object:
    """``None`` for the first page, a positive-integer id string afterwards.

    Anything else — a non-string, an empty string, a sign, letters, ``"0"`` — is
    not a cursor this paginator ever issued, and pretending it means "start over"
    would hide a caller's bug as a quietly restarted listing.
    """
    if cursor is None:
        return None
    if not isinstance(cursor, str) or not cursor.isdigit():
        return _INVALID
    boundary = int(cursor)
    if boundary <= 0:
        return _INVALID
    return boundary


class Paginator:
    """One iteration over ``store``. The cursor carries all iteration state."""

    def __init__(self, store: object) -> None:
        self.store = store

    def _live_rows(self) -> list[dict[str, object]]:
        return sorted(self.store.rows(), key=lambda row: int(row["id"]), reverse=True)

    def page(self, size: object, cursor: object = None) -> dict[str, object]:
        """Serve one page of the listing, newest first.

        Replies are ``{"ok": True, "items": [...], "cursor": str | None}`` —
        ``cursor`` is ``None`` exactly when nothing remains after this page — or
        ``{"ok": False, "error": "invalid_size" | "invalid_cursor"}``. A refused
        call changes nothing; a cursor from a previous reply keeps working.
        """
        if not isinstance(size, int) or isinstance(size, bool) or not 1 <= size <= 100:
            return _error("invalid_size")
        boundary = _parse_cursor(cursor)
        if boundary is _INVALID:
            return _error("invalid_cursor")
        rows = self._live_rows()
        candidates = [row for row in rows if boundary is None or int(row["id"]) < boundary]
        items = candidates[:size]
        next_cursor = str(int(items[-1]["id"])) if len(candidates) > size else None
        return {"ok": True, "items": items, "cursor": next_cursor}


def new_paginator(store: object) -> Paginator:
    """Create a paginator for one iteration over ``store``."""
    return Paginator(store)
