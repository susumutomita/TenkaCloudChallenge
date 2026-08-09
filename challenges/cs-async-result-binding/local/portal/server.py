"""Participant Portal API. It contains public material only."""

from __future__ import annotations

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fixtures.generate import audit_evidence, health_token
from sandbox import normalize_source, run_source

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")
MAX_BODY_BYTES = 256 * 1024
REQUEST_TIMEOUT_SECONDS = 15
CHECKPOINTS = ("environment", "audit", "overlap", "bind", "failure", "generalize")
CODE_CHECKPOINTS = frozenset(("overlap", "bind", "failure", "generalize"))
LABELS = {
    "environment": "environment — Portal が表示する Future gate の合言葉",
    "audit": "audit — 誤った request identity で保存された行番号（昇順）",
    "overlap": "overlap — 最初の完了前にすべての I/O を開始する collector.py",
    "bind": "bind — 完了順が変わっても結果を正しい request に結び付ける collector.py",
    "failure": "failure — 途中の失敗後も後続 identity をずらさない collector.py",
    "generalize": "generalize — permutation・同一 URL・同時完了にも耐える完成版",
}


def starter_payload() -> dict[str, str]:
    return {"collector.py": (ROOT / "starter" / "collector.py").read_text(encoding="utf-8")}


def config_payload() -> dict[str, object]:
    return {
        "id": "cs-async-result-binding",
        "name": "先に返ったのは、どの request の結果だろう",
        "description": "async I/O の完了順と request identity を、推測ではなくコードで結び付ける。",
        "submittedFiles": ["collector.py"],
        "checkpoints": [
            {
                "id": checkpoint,
                "label": LABELS[checkpoint],
                "kind": "code" if checkpoint in CODE_CHECKPOINTS else "answer",
            }
            for checkpoint in CHECKPOINTS
        ],
        "i18n": {
            "en": {
                "name": "Which request did that early result belong to?",
                "description": "Bind async I/O completion to request identity in code instead of guessing from order.",
                "checkpointLabels": {
                    "environment": "environment — the Future gate pass phrase shown by Portal",
                    "audit": "audit — indices stored under the wrong request identity, ascending",
                    "overlap": "overlap — start every I/O before the first completion",
                    "bind": "bind — preserve request identity when completion order changes",
                    "failure": "failure — do not shift later identities after a middle failure",
                    "generalize": "generalize — handle permutations, shared URLs, and simultaneous completion",
                },
            }
        },
    }


def inspect_payload(seed: str) -> dict[str, object]:
    return {
        "environment": {
            "python": sys.version.split()[0],
            "healthToken": health_token(seed),
            "gate": "asyncio.Future values are released explicitly; no sleep or network is used",
        },
        "audit": audit_evidence(seed),
    }


def run_public_tests(seed: str, files: object) -> dict[str, object]:
    source = normalize_source(files)
    if source is None:
        return {"passed": False, "output": "collector.py must be a non-empty Python file."}
    result = run_source(
        source,
        [sys.executable, "-I", str(ROOT / "tests" / "public" / "test_collect.py")],
        seed,
    )
    if result is None:
        return {"passed": False, "output": "Public tests timed out or could not start."}
    return {"passed": result[0] == 0, "output": result[1]}


def prepare_submissions(seed: str, files: object) -> dict[str, object]:
    source = normalize_source(files)
    if source is None:
        return {"ok": False, "output": "collector.py must be a non-empty Python file."}
    return {
        "ok": True,
        "submissions": {
            "environment": health_token(seed),
            "overlap": source,
            "bind": source,
            "failure": source,
            "generalize": source,
        },
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "AsyncResultPortal/1"
    timeout = REQUEST_TIMEOUT_SECONDS

    def _json(self, status: int, payload: object) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def _body(self) -> object | None:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return None
        if length < 0 or length > MAX_BODY_BYTES:
            return None
        try:
            return json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError, TimeoutError, OSError):
            return None

    def do_GET(self) -> None:  # noqa: N802
        path = urlsplit(self.path).path
        if path in ("/healthz", "/api/config"):
            self._json(200, {"ok": True} if path == "/healthz" else config_payload())
        elif path == "/api/inspect":
            self._json(200, inspect_payload(SEED))
        elif path == "/api/starter":
            self._json(200, starter_payload())
        elif path == "/":
            body = (
                "<!doctype html><meta charset='utf-8'><title>Async result binding</title>"
                "<main><h1>Async result binding</h1><p>Participant Portal の問題エディタから "
                "config → inspect → starter → test → prepare の順に利用します。</p></main>"
            ).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(body)
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        payload = self._body()
        if not isinstance(payload, dict):
            self._json(400, {"error": "malformed JSON object"})
            return
        path = urlsplit(self.path).path
        if path == "/api/test":
            self._json(200, run_public_tests(SEED, payload.get("files")))
        elif path == "/api/prepare":
            self._json(200, prepare_submissions(SEED, payload.get("files")))
        else:
            self._json(404, {"error": "not found"})

    def log_message(self, format: str, *args: object) -> None:
        return


def main() -> None:
    HTTPServer(("0.0.0.0", 8080), Handler).serve_forever()


if __name__ == "__main__":
    main()
