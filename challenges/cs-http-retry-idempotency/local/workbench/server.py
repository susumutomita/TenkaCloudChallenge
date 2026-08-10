"""Participant Workbench API.

This image carries public fixtures, tests, and the starter only.  ``/verify`` is a
small reverse proxy to the separately built verifier container, so the Portal keeps
one loopback URL while author artifacts stay out of the participant image.
"""

from __future__ import annotations

import json
import os
import resource
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fixtures.generate import audit_log, dropped_response_trace, health_token, public_operation

ROOT = Path(__file__).resolve().parents[1]
SEED = os.environ.get("FLAG_SEED", "local-dev-seed")
PORT = int(os.environ.get("WORKBENCH_PORT", "18350"))
VERIFIER_URL = os.environ.get("VERIFIER_URL", "http://verifier:18351/verify")

MAX_BODY_BYTES = 256 * 1024
MAX_OUTPUT_BYTES = 64 * 1024
RUN_TIMEOUT_SECONDS = 12
REQUEST_TIMEOUT_SECONDS = 15
SUBMISSION_FILES = ("idempotency.py",)
CHECKPOINTS = ("environment", "uncertain", "audit", "replay", "bind", "generalize")
CODE_CHECKPOINTS = frozenset(("replay", "bind", "generalize"))
CHECKPOINT_LABELS = {
    "environment": "environment — Workbench の合言葉を貼る",
    "uncertain": "uncertain — timeout直後にclientが断言できるserver状態を答える",
    "audit": "audit — 同じ論理操作を二重計上した後発ledger行を挙げる",
    "replay": "replay — 同じkeyと同じ要求を保存済みstatus/bodyで再生する",
    "bind": "bind — keyを要求fingerprintに結び、別要求を409にする",
    "generalize": "generalize — 同時retryとhandler再生成でも副作用を一度にする",
}


def _limits() -> None:
    if sys.platform.startswith("linux"):
        resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_NPROC, (64, 64))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_OUTPUT_BYTES, MAX_OUTPUT_BYTES))


def starter_payload() -> dict[str, str]:
    return {name: (ROOT / "starter" / name).read_text(encoding="utf-8") for name in SUBMISSION_FILES}


def config_payload() -> dict[str, object]:
    return {
        "id": "cs-http-retry-idempotency",
        "name": "応答が消えた。再送で同じ支払いを増やさない",
        "description": "commit後にHTTP応答だけが消えたtraceを監査し、SQLite receiptで同じ論理操作を再生する。",
        "submittedFiles": list(SUBMISSION_FILES),
        "checkpoints": [
            {
                "id": checkpoint,
                "label": CHECKPOINT_LABELS[checkpoint],
                "kind": "code" if checkpoint in CODE_CHECKPOINTS else "answer",
            }
            for checkpoint in CHECKPOINTS
        ],
        "i18n": {
            "en": {
                "name": "The response vanished. Do not create the payment again",
                "description": "Audit a response lost after commit, then use a durable SQLite receipt to replay one logical operation.",
                "checkpointLabels": {
                    "environment": "environment - paste the Workbench pass phrase",
                    "uncertain": "uncertain - state what server state the client can assert immediately after timeout",
                    "audit": "audit - list later ledger rows that duplicated one logical operation",
                    "replay": "replay - replay stored status/body for the same key and request",
                    "bind": "bind - bind a key to the request fingerprint and return 409 for another request",
                    "generalize": "generalize - keep one business effect across concurrent retries and handler recreation",
                },
            }
        },
    }


def inspect_payload(seed: str) -> dict[str, object]:
    rows = audit_log(seed)
    return {
        "environment": {"python": sys.version.split()[0], "healthToken": health_token(seed)},
        "uncertain": {
            "operation": public_operation(seed),
            "firstAttempt": dropped_response_trace(seed)[0],
        },
        "audit": {
            "brokenGatewayTrace": dropped_response_trace(seed),
            "ledger": [{"index": index, **row} for index, row in enumerate(rows)],
        },
    }


def _submission_sources(files: object) -> dict[str, str] | None:
    if not isinstance(files, dict):
        return None
    source = files.get("idempotency.py")
    if not isinstance(source, str) or not source.strip() or len(source) > MAX_BODY_BYTES:
        return None
    return {"idempotency.py": source}


PUBLIC_SCRIPT = """
import os, runpy
os.environ["FLAG_SEED"] = {seed!r}
os.environ["SUBMISSION_DIR"] = {workspace!r}
os.environ["BROWSER_PUBLIC_TESTS"] = "1"
runpy.run_path({root!r} + "/tests/public/test_idempotency.py", run_name="__main__")
"""


def run_public_tests(seed: str, files: object) -> dict[str, object]:
    sources = _submission_sources(files)
    if sources is None:
        return {"passed": False, "output": "idempotency.py must be a non-empty Python file."}
    with tempfile.TemporaryDirectory() as workspace:
        Path(workspace, "idempotency.py").write_text(sources["idempotency.py"], encoding="utf-8")
        transcript = Path(workspace, "stdout")
        try:
            with transcript.open("w", encoding="utf-8") as sink:
                completed = subprocess.run(
                    [
                        sys.executable,
                        "-I",
                        "-c",
                        PUBLIC_SCRIPT.format(root=str(ROOT), workspace=workspace, seed=seed),
                    ],
                    stdout=sink,
                    stderr=subprocess.STDOUT,
                    text=True,
                    timeout=RUN_TIMEOUT_SECONDS,
                    preexec_fn=_limits,
                    cwd=workspace,
                    env={"PATH": "/usr/local/bin:/usr/bin:/bin"},
                    check=False,
                )
            output = transcript.read_text(encoding="utf-8", errors="replace")[-MAX_OUTPUT_BYTES:]
        except (OSError, ValueError, subprocess.TimeoutExpired):
            return {"passed": False, "output": "Public tests timed out or could not start."}
    return {"passed": completed.returncode == 0, "output": output}


def prepare_submissions(seed: str, files: object) -> dict[str, object]:
    sources = _submission_sources(files)
    if sources is None:
        return {"ok": False, "output": "idempotency.py must be a non-empty Python file."}
    source = sources["idempotency.py"]
    return {
        "ok": True,
        "submissions": {
            "environment": health_token(seed),
            "replay": source,
            "bind": source,
            "generalize": source,
        },
    }


class Handler(BaseHTTPRequestHandler):
    timeout = REQUEST_TIMEOUT_SECONDS

    def do_GET(self) -> None:  # noqa: N802
        path = urlsplit(self.path).path
        payloads = {
            "/api/config": config_payload,
            "/api/inspect": lambda: inspect_payload(SEED),
            "/api/starter": starter_payload,
        }
        builder = payloads.get(path)
        if builder is None:
            self._respond(404, {"error": "not found"})
            return
        self._respond(200, builder())

    def do_POST(self) -> None:  # noqa: N802
        path = urlsplit(self.path).path.rstrip("/") or "/"
        if path not in ("/verify", "/api/test", "/api/prepare"):
            self._respond(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("content-length", "0"))
        except ValueError:
            self._respond(400, {"error": "bad content-length"})
            return
        if length <= 0 or length > MAX_BODY_BYTES:
            self._respond(400, {"error": "bad content-length"})
            return
        try:
            raw = self.rfile.read(length)
            body = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError, OSError, TimeoutError):
            self._respond(400, {"error": "bad json"})
            return
        if not isinstance(body, dict):
            self._respond(400, {"error": "bad json"})
            return
        if path == "/api/test":
            self._respond(200, run_public_tests(SEED, body.get("files")))
            return
        if path == "/api/prepare":
            self._respond(200, prepare_submissions(SEED, body.get("files")))
            return
        request = urllib.request.Request(
            VERIFIER_URL, data=raw, headers={"content-type": "application/json"}, method="POST"
        )
        try:
            with urllib.request.urlopen(request, timeout=RUN_TIMEOUT_SECONDS + 5) as response:
                forwarded = response.read(MAX_BODY_BYTES)
                status = response.status
        except (urllib.error.URLError, OSError, TimeoutError):
            self._respond(503, {"error": "verifier unavailable"})
            return
        self._raw(status, forwarded)

    def _respond(self, status: int, payload: object) -> None:
        self._raw(status, json.dumps(payload, ensure_ascii=False).encode("utf-8"))

    def _raw(self, status: int, payload: bytes) -> None:
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, _format: str, *_args: object) -> None:
        return


def main() -> None:
    # Containers must bind all interfaces so Docker port publishing can reach the
    # process. Compose exposes it only on host loopback (127.0.0.1).
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
