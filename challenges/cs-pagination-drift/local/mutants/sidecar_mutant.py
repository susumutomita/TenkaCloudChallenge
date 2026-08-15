"""Author-only mutant that validates its inputs but keeps the offset.

This is the most attractive wrong answer: it takes the starter and adds exactly
what the failing paginate checkpoint asked for — a strict cursor check and no
silent reset. Every still-table test now behaves, and the refusal semantics are
flawless. It is still wrong, because the cursor it hands out is a position, and
the table does not hold positions still.
"""

from __future__ import annotations


def _error(name: str) -> dict[str, object]:
    return {"ok": False, "error": name}


class Paginator:
    def __init__(self, store: object) -> None:
        self.store = store

    def page(self, size: object, cursor: object = None) -> dict[str, object]:
        if not isinstance(size, int) or isinstance(size, bool) or not 1 <= size <= 100:
            return _error("invalid_size")
        if cursor is None:
            offset = 0
        else:
            if not isinstance(cursor, str) or not cursor.isdigit() or int(cursor) <= 0:
                return _error("invalid_cursor")
            offset = int(cursor)
        rows = sorted(self.store.rows(), key=lambda row: int(row["id"]), reverse=True)
        items = rows[offset : offset + size]
        next_offset = offset + size
        next_cursor = str(next_offset) if next_offset < len(rows) else None
        return {"ok": True, "items": items, "cursor": next_cursor}


def new_paginator(store: object) -> Paginator:
    return Paginator(store)
