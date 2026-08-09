"""Private multi-verify scoring seam. Hidden fixtures never enter participant image."""

from __future__ import annotations

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fixtures.generate import audit_answer, audit_evidence, health_token
from sandbox import MAX_SOURCE_BYTES, run_source

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")
MAX_BODY_BYTES = 256 * 1024
REQUEST_TIMEOUT_SECONDS = 15
CHECKPOINTS = ("environment", "audit", "overlap", "bind", "failure", "generalize")
CODE_CHECKPOINT_PHASES = {
    "overlap": "check_overlap",
    "bind": "check_bind",
    "failure": "check_failure",
    "generalize": "check_generalize",
}
CODE_CHECKPOINTS = frozenset(CODE_CHECKPOINT_PHASES)


RUNNER = """
import json, os, sys
import asyncio
hard_exit = os._exit
sys.path.insert(0, {root!r})
sys.path.insert(0, {workspace!r})
from tests.hidden import check_collect
try:
    import collector
except Exception as error:
    os._exit = hard_exit
    print(json.dumps({{"failures": ["submission could not be imported: " + type(error).__name__]}}))
    sys.stdout.flush()
    os._exit(0)
try:
    passed, message = asyncio.run(check_collect.evaluate_module(collector, {phase!r}, {seed!r}))
except Exception as error:
    passed, message = False, "collector could not be checked: " + type(error).__name__
os._exit = hard_exit
print(json.dumps({{"failures": [] if passed else [message]}}))
sys.stdout.flush()
os._exit(0)
"""


def _normalized_indices(submission: object) -> list[int] | None:
    if isinstance(submission, str):
        try:
            submission = json.loads(submission)
        except json.JSONDecodeError:
            return None
    if not isinstance(submission, list):
        return None
    if any(isinstance(value, bool) or not isinstance(value, int) for value in submission):
        return None
    if submission != sorted(set(submission)):
        return None
    return submission


def _check_environment(submission: object) -> bool:
    return isinstance(submission, str) and submission.strip() == health_token(SEED)


def _check_audit(submission: object) -> bool:
    return _normalized_indices(submission) == audit_answer(SEED)


def _check_code(checkpoint: str, submission: object) -> bool:
    if not isinstance(submission, str) or not submission.strip():
        return False
    if len(submission.encode()) > MAX_SOURCE_BYTES:
        return False
    phase = CODE_CHECKPOINT_PHASES[checkpoint]
    script = RUNNER.format(root=str(ROOT), workspace="{workspace}", phase=phase, seed=SEED)
    result = run_source(
        submission,
        [sys.executable, "-I", "-c", script],
        SEED,
    )
    if result is None or result[0] != 0:
        return False
    for line in reversed(result[1].splitlines()):
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(payload, dict):
            continue
        failures = payload.get("failures")
        return isinstance(failures, list) and len(failures) == 0
    return False


def evaluate(checkpoint: object, submission: object) -> bool:
    if checkpoint == "environment":
        return _check_environment(submission)
    if checkpoint == "audit":
        return _check_audit(submission)
    if isinstance(checkpoint, str) and checkpoint in CODE_CHECKPOINTS:
        return _check_code(checkpoint, submission)
    return False


class Handler(BaseHTTPRequestHandler):
    server_version = "AsyncResultVerifier/1"
    timeout = REQUEST_TIMEOUT_SECONDS

    def _json(self, status: int, payload: object) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if urlsplit(self.path).path == "/healthz":
            self._json(200, {"ok": True})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if urlsplit(self.path).path != "/verify":
            self._json(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 0 or length > MAX_BODY_BYTES:
                raise ValueError
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict):
                raise ValueError
        except (ValueError, json.JSONDecodeError, UnicodeDecodeError, TimeoutError, OSError):
            self._json(400, {"correct": False, "error": "malformed request"})
            return
        checkpoint = payload.get("checkpointId")
        if not isinstance(checkpoint, str) or checkpoint not in CHECKPOINTS:
            self._json(400, {"correct": False, "error": "unknown checkpoint"})
            return
        try:
            correct = evaluate(checkpoint, payload.get("submission"))
        except Exception:  # a broken submission or fixture must fail closed
            correct = False
        self._json(200, {"correct": correct, "checkpointId": checkpoint})

    def log_message(self, format: str, *args: object) -> None:
        return


def main() -> None:
    HTTPServer(("0.0.0.0", 8081), Handler).serve_forever()


if __name__ == "__main__":
    main()
