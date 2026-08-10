"""Author-only mutant whose receipt source of truth is an adjacent JSON file."""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import threading
from pathlib import Path

_LOCK = threading.Lock()


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


def _sidecar_path(db_path: str | Path) -> Path:
    return Path(f"{Path(db_path)}.receipts.json")


def _read_sidecar(path: Path) -> dict[str, dict[str, object]]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    if not isinstance(value, dict):
        raise ValueError("invalid receipt sidecar")
    return value


def _write_sidecar(path: Path, receipts: dict[str, dict[str, object]]) -> None:
    temporary = path.with_name(f"{path.name}.tmp")
    temporary.write_text(
        json.dumps(receipts, sort_keys=True, separators=(",", ":"), ensure_ascii=False),
        encoding="utf-8",
    )
    os.replace(temporary, path)


def handle_request(
    db_path: str | Path, idempotency_key: object, request: object
) -> dict[str, object]:
    key = _validate_key(idempotency_key)
    if key is None:
        return _error(400, "invalid_idempotency_key")
    normalized = _validate_request(request)
    if normalized is None:
        return _error(400, "invalid_request")
    fingerprint = _fingerprint(normalized)
    sidecar_path = _sidecar_path(db_path)

    with _LOCK:
        receipts = _read_sidecar(sidecar_path)
        stored = receipts.get(key)
        if stored is not None:
            if stored.get("fingerprint") != fingerprint:
                return _error(409, "idempotency_conflict")
            return {"status": int(stored["status"]), "body": stored["body"]}

        connection = sqlite3.connect(str(db_path), timeout=10)
        try:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute(
                """CREATE TABLE IF NOT EXISTS ledger (
                       id INTEGER PRIMARY KEY AUTOINCREMENT,
                       account TEXT NOT NULL,
                       amount INTEGER NOT NULL,
                       memo TEXT NOT NULL,
                       evidence_key TEXT NOT NULL,
                       evidence_fingerprint TEXT NOT NULL,
                       evidence_status INTEGER NOT NULL,
                       evidence_body TEXT NOT NULL
                   )"""
            )
            next_id = int(
                connection.execute("SELECT COALESCE(MAX(id), 0) + 1 FROM ledger").fetchone()[0]
            )
            body = {"chargeId": f"ch_{next_id}", **normalized}
            body_json = json.dumps(body, separators=(",", ":"), ensure_ascii=False)
            connection.execute(
                """INSERT INTO ledger(
                       id, account, amount, memo,
                       evidence_key, evidence_fingerprint, evidence_status, evidence_body
                   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    next_id,
                    normalized["account"],
                    normalized["amount"],
                    normalized["memo"],
                    key,
                    fingerprint,
                    201,
                    body_json,
                ),
            )
            connection.commit()
        finally:
            connection.close()

        receipts[key] = {"fingerprint": fingerprint, "status": 201, "body": body}
        _write_sidecar(sidecar_path, receipts)
        return {"status": 201, "body": body}
