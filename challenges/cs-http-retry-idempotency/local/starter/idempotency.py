"""A deliberately incomplete HTTP idempotency handler.

The public contract is ``handle_request(db_path, idempotency_key, request)``.
It returns ``{"status": int, "body": dict}`` and records successful charges in
SQLite.  This starter validates ordinary requests, but it does not yet recognise a
retry of the same logical operation.  The public tests intentionally do not expose
that gap.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path


def _error(status: int, name: str) -> dict[str, object]:
    return {"status": status, "body": {"error": name}}


def _validate_key(value: object) -> str | None:
    if not isinstance(value, str) or not value or len(value) > 64:
        return None
    allowed = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._:-"
    return value if all(character in allowed for character in value) else None


def _validate_request(value: object) -> dict[str, object] | None:
    if not isinstance(value, dict) or not set(value).issubset({"account", "amount", "memo"}):
        return None
    account = value.get("account")
    amount = value.get("amount")
    memo = value.get("memo", "")
    if not isinstance(account, str) or not account or len(account) > 80:
        return None
    if type(amount) is not int or not 1 <= amount <= 1_000_000:
        return None
    if not isinstance(memo, str) or len(memo) > 120:
        return None
    return {"account": account, "amount": amount, "memo": memo}


def handle_request(
    db_path: str | Path, idempotency_key: object, request: object
) -> dict[str, object]:
    """Create one charge.

    TODO: bind the key to the canonical request, commit a durable receipt with the
    ledger row, and replay the stored status/body when the client retries.
    """
    key = _validate_key(idempotency_key)
    if key is None:
        return _error(400, "invalid_idempotency_key")
    normalized = _validate_request(request)
    if normalized is None:
        return _error(400, "invalid_request")

    connection = sqlite3.connect(str(db_path), timeout=10)
    try:
        connection.execute(
            """CREATE TABLE IF NOT EXISTS ledger (
                   id INTEGER PRIMARY KEY AUTOINCREMENT,
                   account TEXT NOT NULL,
                   amount INTEGER NOT NULL,
                   memo TEXT NOT NULL
               )"""
        )
        cursor = connection.execute(
            "INSERT INTO ledger(account, amount, memo) VALUES (?, ?, ?)",
            (normalized["account"], normalized["amount"], normalized["memo"]),
        )
        charge_id = f"ch_{cursor.lastrowid}"
        connection.commit()
    finally:
        connection.close()

    return {
        "status": 201,
        "body": {"chargeId": charge_id, **normalized},
    }
