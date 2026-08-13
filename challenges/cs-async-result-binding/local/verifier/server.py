"""Private multi-verify scoring seam. Hidden fixtures never enter participant image."""

from __future__ import annotations

import json
import os
import secrets
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fixtures.generate import audit_evidence, health_token
from sandbox import MAX_SOURCE_BYTES, run_source
from verifier.expected import audit_answer

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

# The Participant Portal runs in a separate process, but the repository parity gate
# reads this authored verifier source. Keep the exact English metadata material here
# so a future edit cannot silently drift the two participant-facing surfaces.
PORTAL_ENGLISH_CONTRACT = {
    "name": "Which request did that early result belong to?",
    "description": "Bind async I/O completion to request identity in code instead of guessing from order.",
    "labels": {
        "environment": "environment — the Future gate pass phrase shown by Portal",
        "audit": "audit — indices stored under the wrong request identity, ascending",
        "overlap": "overlap — start every I/O before the first completion",
        "bind": "bind — preserve request identity when completion order changes",
        "failure": "failure — do not shift later identities after a middle failure",
        "generalize": "generalize — handle permutations, shared URLs, and simultaneous completion",
    },
}


RUNNER = """
import json, os, sys
import asyncio
hard_exit = os._exit
trusted_stdout = sys.stdout
trusted_write = sys.stdout.buffer.write
trusted_asyncio_run = asyncio.run
sys.path.insert(0, {root!r})
from tests.hidden import check_collect
private_checker = check_collect.evaluate_module
for module_name in tuple(sys.modules):
    if module_name == "tests" or module_name.startswith("tests.") or module_name == "fixtures" or module_name.startswith("fixtures."):
        sys.modules.pop(module_name, None)
while {root!r} in sys.path:
    sys.path.remove({root!r})
sys.path.insert(0, {workspace!r})

try:
    import collector
except Exception:
    # submission could not be imported: emit only the private, nonce-bound failure record.
    os._exit = hard_exit
    sys.stdout = trusted_stdout
    trusted_write({fail_record!r})
    sys.stdout.flush()
    os._exit(0)

async def evaluate_submission(checker, participant_module):
    try:
        return await checker(participant_module, {phase!r}, {seed!r})
    except Exception:
        return False, "collector could not be checked"

try:
    passed, _message = trusted_asyncio_run(evaluate_submission(private_checker, collector))
except Exception:
    passed = False

# Participant imports may replace json.dumps, print, asyncio.run, sys.stdout, or
# os._exit. Restore the trusted C-backed output/exit handles and write a fixed record
# instead of calling any participant-mutable serializer after grading.
os._exit = hard_exit
sys.stdout = trusted_stdout
trusted_write({pass_record!r} if passed is True else {fail_record!r})
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
    verdict_token = secrets.token_hex(32)
    pass_line = f"TC-VERDICT:{verdict_token}:PASS"
    fail_line = f"TC-VERDICT:{verdict_token}:FAIL"
    script = RUNNER.format(
        root=str(ROOT),
        workspace="{workspace}",
        phase=phase,
        seed=SEED,
        pass_record=(pass_line + "\n").encode("utf-8"),
        fail_record=(fail_line + "\n").encode("utf-8"),
    )
    result = run_source(
        submission,
        [sys.executable, "-I", "-c", script],
        SEED,
    )
    if result is None or result[0] != 0:
        return False
    lines = result[1].splitlines()
    return bool(lines) and lines[-1] == pass_line


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
    port = int(os.environ.get("VERIFY_PORT", "8081"))
    # Bind every interface *inside the container*, not the container's loopback. A published
    # port is forwarded to the container's bridge address, so a server listening only on
    # 127.0.0.1 inside the container accepts nothing from outside it — the connection is
    # opened and closed without a response, and the platform can never score the problem.
    #
    # The loopback restriction that matters is on the host, and it lives in
    # docker-compose.yml, which publishes `127.0.0.1:<port>:<port>`. Nothing outside this
    # machine can reach the verifier either way.
    HTTPServer(("0.0.0.0", port), Handler).serve_forever()  # noqa: S104 - see above


if __name__ == "__main__":
    main()
