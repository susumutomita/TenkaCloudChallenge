"""Author-only mutant: check-then-insert guarded by a module-level threading.Lock.

Correct inside one copy of the program, and exactly what a gateway with two worker
copies does not have. The two-copy round must kill it.
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

def _fingerprint(normalized):
    canonical = json.dumps(normalized, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()

def _dumps(body):
    return json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)

LEDGER = """CREATE TABLE IF NOT EXISTS ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT, account TEXT NOT NULL, amount INTEGER NOT NULL, memo TEXT NOT NULL)"""
RECEIPTS_PLAIN = """CREATE TABLE IF NOT EXISTS receipts (
    key TEXT NOT NULL, fingerprint TEXT NOT NULL, status INTEGER NOT NULL, body TEXT NOT NULL)"""
RECEIPTS_PK = """CREATE TABLE IF NOT EXISTS receipts (
    key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, status INTEGER NOT NULL, body TEXT NOT NULL)"""

import threading
_LOCK = threading.Lock()

def handle_request(db_path, idempotency_key, request):
    key = _validate_key(idempotency_key)
    if key is None:
        return _error(400, "invalid_idempotency_key")
    normalized = _validate_request(request)
    if normalized is None:
        return _error(400, "invalid_request")
    fingerprint = _fingerprint(normalized)
    with _LOCK:
        connection = sqlite3.connect(str(db_path), timeout=10)
        try:
            connection.execute(LEDGER); connection.execute(RECEIPTS_PLAIN)
            row = connection.execute("SELECT fingerprint, status, body FROM receipts WHERE key = ?", (key,)).fetchone()
            if row is not None:
                if row[0] != fingerprint:
                    return _error(409, "idempotency_conflict")
                return {"status": int(row[1]), "body": json.loads(row[2])}
            cursor = connection.execute("INSERT INTO ledger(account, amount, memo) VALUES (?, ?, ?)",
                                        (normalized["account"], normalized["amount"], normalized["memo"]))
            body = {"chargeId": f"ch_{cursor.lastrowid}", **normalized}
            connection.execute("INSERT INTO receipts(key, fingerprint, status, body) VALUES (?, ?, ?, ?)",
                               (key, fingerprint, 201, _dumps(body)))
            connection.commit()
        finally:
            connection.close()
    return {"status": 201, "body": body}
