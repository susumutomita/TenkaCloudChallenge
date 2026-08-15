"""A deliberately incomplete listing paginator.

The public contract is ``new_paginator(store)`` returning an object with
``page(size, cursor=None)``. The store exposes ``rows()``, the current rows as
``{"id": int, "value": str}`` in ascending id order. A listing serves rows
newest first (descending id), ``size`` rows per page.

Replies are ``{"ok": True, "items": [...], "cursor": str | None}`` — ``cursor``
is an opaque string to pass to the next call, and ``None`` exactly when nothing
remains after this page — or ``{"ok": False, "error": str}`` with
``invalid_size`` or ``invalid_cursor``.

Against a table that does not change between calls, this starter is flawless —
every public test agrees. What it does not yet promise is anything about a table
that moves while the pages are being fetched, and it treats a cursor it cannot
read as the beginning instead of refusing it.
"""

from __future__ import annotations


def _error(name: str) -> dict[str, object]:
    return {"ok": False, "error": name}


class Paginator:
    def __init__(self, store: object) -> None:
        self.store = store

    def page(self, size: object, cursor: object = None) -> dict[str, object]:
        """Serve one page of the listing, newest first.

        The reply for a ``cursor`` that did not come from a previous reply must be
        ``{"ok": False, "error": "invalid_cursor"}``, and a refused call must not
        disturb the iteration a valid cursor continues.

        TODO: the cursor this paginator hands out is a position, and a position
        only means something while the table underneath holds still.
        """
        if not isinstance(size, int) or isinstance(size, bool) or not 1 <= size <= 100:
            return _error("invalid_size")
        try:
            offset = int(cursor) if cursor is not None else 0
        except (TypeError, ValueError):
            offset = 0
        if offset < 0:
            offset = 0
        rows = sorted(self.store.rows(), key=lambda row: int(row["id"]), reverse=True)
        items = rows[offset : offset + size]
        next_offset = offset + size
        next_cursor = str(next_offset) if next_offset < len(rows) else None
        return {"ok": True, "items": items, "cursor": next_cursor}


def new_paginator(store: object) -> Paginator:
    """Create a paginator for one iteration over ``store``."""
    return Paginator(store)
