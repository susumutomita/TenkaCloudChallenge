"""Reference implementation for durable HTTP idempotency.

This provides an at-most-once *business effect* for a logical operation.  It does
not make HTTP delivery exactly once: a response may still disappear and a caller
may still retry.  The durable receipt makes that retry observable as the same
operation instead of a second charge.
"""

from __future__ import annotations

import hashlib
import json
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


def _fingerprint(request: dict[str, object]) -> str:
    canonical = json.dumps(request, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _open_database(db_path: str | Path) -> sqlite3.Connection:
    connection = sqlite3.connect(str(db_path), timeout=10, isolation_level=None)
    connection.execute("PRAGMA busy_timeout = 10000")
    connection.execute(
        """CREATE TABLE IF NOT EXISTS ledger (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               account TEXT NOT NULL,
               amount INTEGER NOT NULL,
               memo TEXT NOT NULL
           )"""
    )
    connection.execute(
        """CREATE TABLE IF NOT EXISTS idempotency_receipts (
               idempotency_key TEXT PRIMARY KEY,
               request_fingerprint TEXT NOT NULL,
               response_status INTEGER NOT NULL,
               response_body TEXT NOT NULL
           )"""
    )
    return connection


def _lookup_receipt(connection: sqlite3.Connection, key: str) -> tuple[object, ...] | None:
    return connection.execute(
        """SELECT request_fingerprint, response_status, response_body
           FROM idempotency_receipts WHERE idempotency_key = ?""",
        (key,),
    ).fetchone()


def _replay_response(status: int, body_json: str) -> dict[str, object]:
    return {"status": status, "body": json.loads(body_json)}


def handle_request(
    db_path: str | Path, idempotency_key: object, request: object
) -> dict[str, object]:
    """Validate, then atomically create-or-replay a charge.

    Decision order is part of the participant-visible contract: malformed keys and
    requests are 400 and do not reserve a receipt; only a valid request reaches the
    key/fingerprint comparison.
    """
    key = _validate_key(idempotency_key)
    if key is None:
        return _error(400, "invalid_idempotency_key")
    normalized = _validate_request(request)
    if normalized is None:
        return _error(400, "invalid_request")
    fingerprint = _fingerprint(normalized)

    connection = _open_database(db_path)
    try:
        # BEGIN IMMEDIATE makes the absent-receipt check and the insert one serialized
        # decision.  Two concurrent first attempts cannot both observe "absent".
        connection.execute("BEGIN IMMEDIATE")
        stored = _lookup_receipt(connection, key)
        if stored is not None:
            stored_fingerprint, stored_status, stored_body = stored
            if stored_fingerprint != fingerprint:
                connection.rollback()
                return _error(409, "idempotency_conflict")
            response = _replay_response(int(stored_status), str(stored_body))
            connection.commit()
            return response

        cursor = connection.execute(
            "INSERT INTO ledger(account, amount, memo) VALUES (?, ?, ?)",
            (normalized["account"], normalized["amount"], normalized["memo"]),
        )
        body: dict[str, object] = {"chargeId": f"ch_{cursor.lastrowid}", **normalized}
        body_json = json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        connection.execute(
            """INSERT INTO idempotency_receipts(
                   idempotency_key, request_fingerprint, response_status, response_body
               ) VALUES (?, ?, ?, ?)""",
            (key, fingerprint, 201, body_json),
        )
        connection.commit()
        return {"status": 201, "body": body}
    except BaseException:
        connection.rollback()
        raise
    finally:
        connection.close()
