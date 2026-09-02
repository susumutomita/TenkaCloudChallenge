"""Author-only honest shape (must pass): the statement's recipe (b) applied to the starter.

No write turn is taken before the read. A `PRIMARY KEY` on the key column makes SQLite
refuse the loser's receipt; the loser rolls back (which also undoes its ledger row) and
reads the receipt again.
"""
import hashlib, json, sqlite3

def _error(status, name):
    return {"status": status, "body": {"error": name}}

def _validate_key(value):
    if not isinstance(value, str) or not value or len(value) > 64:
        return None
    allowed = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._:-"
    return value if all(c in allowed for c in value) else None

def _validate_request(value):
    if not isinstance(value, dict) or not set(value).issubset({"account", "amount", "memo"}):
        return None
    account = value.get("account"); amount = value.get("amount"); memo = value.get("memo", "")
    if not isinstance(account, str) or not account or len(account) > 80:
        return None
    if type(amount) is not int or not 1 <= amount <= 1_000_000:
        return None
    if not isinstance(memo, str) or len(memo) > 120:
        return None
    return {"account": account, "amount": amount, "memo": memo}

def _read_receipt(connection, key):
    return connection.execute(
        "SELECT fingerprint, status, body FROM receipts WHERE key = ?", (key,)
    ).fetchone()

def _replay(row, fingerprint):
    if row[0] != fingerprint:
        return _error(409, "idempotency_conflict")
    return {"status": int(row[1]), "body": json.loads(row[2])}

def handle_request(db_path, idempotency_key, request):
    key = _validate_key(idempotency_key)
    if key is None:
        return _error(400, "invalid_idempotency_key")
    normalized = _validate_request(request)
    if normalized is None:
        return _error(400, "invalid_request")
    canonical = json.dumps(normalized, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    fingerprint = hashlib.sha256(canonical.encode("utf-8")).hexdigest()

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
        connection.execute(
            "CREATE TABLE IF NOT EXISTS receipts (key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, status INTEGER NOT NULL, body TEXT NOT NULL)"
        )
        row = _read_receipt(connection, key)
        if row is not None:
            return _replay(row, fingerprint)
        cursor = connection.execute(
            "INSERT INTO ledger(account, amount, memo) VALUES (?, ?, ?)",
            (normalized["account"], normalized["amount"], normalized["memo"]),
        )
        body = {"chargeId": f"ch_{cursor.lastrowid}", **normalized}
        body_json = json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        try:
            connection.execute(
                "INSERT INTO receipts(key, fingerprint, status, body) VALUES (?, ?, ?, ?)",
                (key, fingerprint, 201, body_json),
            )
            connection.commit()
        except sqlite3.IntegrityError:
            connection.rollback()               # the loser; its ledger row disappears here too
            return _replay(_read_receipt(connection, key), fingerprint)
    finally:
        connection.close()
    return {"status": 201, "body": body}
