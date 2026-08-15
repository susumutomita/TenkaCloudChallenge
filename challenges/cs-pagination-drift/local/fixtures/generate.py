"""Seed-derived evidence for the pagination lab.

Everything the participant sees is one recorded listing job: an operator paged
through a table newest-first with an offset while two writes landed between the
page calls. Each page response is individually correct; the whole is not. The
generator *simulates* that job rather than hard-coding its outcome, so the
duplicated and missing rows follow the seed and stay correct if the construction
ever changes.
"""

from __future__ import annotations

import hashlib
import random


def _rng(seed: str, label: str) -> random.Random:
    digest = hashlib.sha256(f"{seed}:{label}".encode()).digest()
    return random.Random(int.from_bytes(digest[:16], "big"))


def _token(seed: str, label: str, width: int = 10) -> str:
    return hashlib.sha256(f"{seed}:{label}".encode()).hexdigest()[:width]


def health_token(seed: str) -> str:
    return f"pagination-lab-{_token(seed, 'health', 12)}"


class MemoryStore:
    """The tiny table both surfaces and the hidden checker page over.

    Rows are ``{"id": int, "value": str}``; ids only ever grow, so ascending id is
    insertion order and descending id is newest-first. This class is participant-
    visible on purpose — the defect this problem teaches lives in the paginator,
    not in the store.
    """

    def __init__(self, rows: list[dict[str, object]] | None = None) -> None:
        self._rows: list[dict[str, object]] = [dict(row) for row in rows or []]

    def insert(self, row_id: int, value: str) -> None:
        if any(row["id"] == row_id for row in self._rows):
            raise ValueError(f"duplicate id {row_id}")
        self._rows.append({"id": row_id, "value": value})
        self._rows.sort(key=lambda row: int(row["id"]))  # type: ignore[arg-type]

    def delete(self, row_id: int) -> None:
        self._rows = [row for row in self._rows if row["id"] != row_id]

    def rows(self) -> list[dict[str, object]]:
        """The current rows, ascending by id. A fresh copy on every call."""
        return [dict(row) for row in self._rows]


def _parameters(seed: str) -> dict[str, int]:
    rng = _rng(seed, "parameters")
    page_size = rng.randrange(3, 5)  # 3 or 4
    inserts = 2 if page_size == 3 else rng.randrange(2, 4)  # < page_size, so pages overlap
    deletes = 1 if inserts == 2 else rng.randrange(1, 3)  # < inserts, so a shift is left over
    initial = rng.randrange(3 * page_size, 3 * page_size + 4)  # at least three full pages
    base_id = 100 + rng.randrange(0, 400)
    return {
        "pageSize": page_size,
        "inserts": inserts,
        "deletes": deletes,
        "initial": initial,
        "baseId": base_id,
    }


def reported_listing(seed: str) -> dict[str, object]:
    rng = _rng(seed, "listing")
    return {
        "listingId": f"listing-{_token(seed, 'listing-id', 8)}",
        "table": rng.choice(["audit_log", "orders", "incidents", "invoices"]),
        "requestedAt": f"2026-08-1{rng.randrange(0, 5)}T0{rng.randrange(1, 9)}:{rng.randrange(10, 59)}:00Z",
    }


def pagination_trace(seed: str) -> dict[str, object]:
    """Replay the recorded listing job: offset pages over a table that moved.

    The offset paginator is simulated here exactly as the operator ran it. After
    page 1 the writer inserts new rows (newest-first, the whole window shifts and
    the next page re-serves the tail of the previous one). After page 2 it deletes
    some of those fresh rows (the window shifts back and not-yet-served survivors
    fall out). Nothing in the returned record says which rows were duplicated or
    lost — that is the participant's audit.
    """
    p = _parameters(seed)
    store = MemoryStore()
    next_id = p["baseId"]
    for index in range(p["initial"]):
        store.insert(next_id, f"row-{_token(seed, f'initial-{index}', 6)}")
        next_id += 1

    initial_ids = [int(row["id"]) for row in reversed(store.rows())]
    pages: list[dict[str, object]] = []
    writes: list[dict[str, object]] = []
    inserted_ids: list[int] = []
    offset = 0
    page_number = 0

    while True:
        current = [int(row["id"]) for row in reversed(store.rows())]
        window = current[offset : offset + p["pageSize"]]
        page_number += 1
        pages.append({"page": page_number, "offsetUsed": offset, "returnedIds": window})
        offset += p["pageSize"]
        if len(window) < p["pageSize"] or offset >= len(current):
            break
        if page_number == 1:
            for index in range(p["inserts"]):
                store.insert(next_id, f"row-{_token(seed, f'insert-{index}', 6)}")
                writes.append({"afterPage": 1, "op": "insert", "id": next_id})
                inserted_ids.append(next_id)
                next_id += 1
        elif page_number == 2:
            for row_id in inserted_ids[: p["deletes"]]:
                store.delete(row_id)
                writes.append({"afterPage": 2, "op": "delete", "id": row_id})

    final_ids = [int(row["id"]) for row in reversed(store.rows())]
    return {
        "contract": {"order": "newest-first (id descending)", "pageSize": p["pageSize"]},
        "initialIds": initial_ids,
        "pages": pages,
        "writes": writes,
        "finalIds": final_ids,
    }


def duplicated_row_ids(seed: str) -> list[int]:
    """Ids served more than once, ascending. Derived from the trace, not stored."""
    seen: dict[int, int] = {}
    for page in pagination_trace(seed)["pages"]:
        for row_id in page["returnedIds"]:  # type: ignore[union-attr]
            seen[int(row_id)] = seen.get(int(row_id), 0) + 1
    return sorted(row_id for row_id, count in seen.items() if count > 1)


def missing_survivor_ids(seed: str) -> list[int]:
    """Rows alive at the start and at the end that no page ever served, ascending."""
    trace = pagination_trace(seed)
    served = {int(row_id) for page in trace["pages"] for row_id in page["returnedIds"]}  # type: ignore[union-attr]
    survivors = set(trace["initialIds"]) & set(trace["finalIds"])  # type: ignore[arg-type]
    return sorted(survivors - served)


# Every question the participant is asked, in one place because the CLI (`show.py`)
# and the Portal (`workbench/server.py`) both render them. Japanese is the default
# and English lives under `i18n.en`, the same convention metadata.json uses.
QUESTIONS = {
    "observe": {
        "question": (
            "最初の 2 ページと、その間に届いた書き込みだけを切り出しました。 "
            "どちらのページ応答にも、それ自体の誤りはありません。 2 ページを並べたとき、一覧には何が起きていますか。"
        ),
        "answerFormat": (
            '["<listing.listingId>", '
            '"<duplicate-rows | missing-rows | reordered-rows のいずれか 1 つ>"]'
        ),
        "i18n": {
            "en": {
                "question": (
                    "This is only the first two pages and the writes that landed between them. "
                    "Neither page response is wrong by itself. Put the two pages side by side — "
                    "what happened to the listing?"
                ),
                "answerFormat": (
                    '["<listing.listingId>", '
                    '"<one of: duplicate-rows | missing-rows | reordered-rows>"]'
                ),
            }
        },
    },
    "audit": {
        "question": (
            "開始時に存在し (initialIds)、最後まで残っている (finalIds) のに、"
            "どのページにも一度も現れなかった row id を 1 つ残らず挙げてください。"
        ),
        "answerFormat": "[<id>, ...] (昇順、重複なし)",
        "i18n": {
            "en": {
                "question": (
                    "List every row id that existed at the start (initialIds), survived to the "
                    "end (finalIds), and yet never appeared on any page."
                ),
                "answerFormat": "[<id>, ...] (ascending, no duplicates)",
            }
        },
    },
}


def evidence_blocks(seed: str) -> dict[str, object]:
    """The one payload both surfaces serve. show.py prints it verbatim; the
    Workbench adds only the interpreter version to `environment`."""
    trace = pagination_trace(seed)
    first_two = [page for page in trace["pages"] if int(page["page"]) <= 2]  # type: ignore[index]
    early_writes = [write for write in trace["writes"] if int(write["afterPage"]) == 1]  # type: ignore[index]
    return {
        "environment": {"healthToken": health_token(seed)},
        "observe": {
            **QUESTIONS["observe"],
            "listing": reported_listing(seed),
            "contract": trace["contract"],
            "pages": first_two,
            "writes": early_writes,
        },
        "audit": {
            **QUESTIONS["audit"],
            "listing": reported_listing(seed),
            "contract": trace["contract"],
            "initialIds": trace["initialIds"],
            "pages": trace["pages"],
            "writes": trace["writes"],
            "finalIds": trace["finalIds"],
        },
    }
