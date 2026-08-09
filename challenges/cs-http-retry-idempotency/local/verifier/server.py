"""Separated hidden verifier for the retry/idempotency lab."""

from __future__ import annotations

import json
import os
import resource
import subprocess
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fixtures.generate import audit_log, health_token, public_operation

ROOT = Path(__file__).resolve().parents[1]
SEED = os.environ.get("FLAG_SEED", "local-dev-seed")
PORT = int(os.environ.get("VERIFY_PORT", "18351"))
MAX_BODY_BYTES = 256 * 1024
MAX_OUTPUT_BYTES = 64 * 1024
RUN_TIMEOUT_SECONDS = 15
REQUEST_TIMEOUT_SECONDS = 15
_ADDRESS_SPACE_CAPPABLE = sys.platform.startswith("linux")
CHECKPOINTS = ("environment", "uncertain", "audit", "replay", "bind", "generalize")
CODE_CHECKPOINT_PHASES = {
    "replay": "check_replay",
    "bind": "check_bind",
    "generalize": "check_generalize",
}
CODE_CHECKPOINTS = frozenset(CODE_CHECKPOINT_PHASES)

# Metadata parity guard (#381) reads this authored verifier source. The participant
# renders the same strings from workbench/server.py; keeping the full English material
# here makes drift visible even though the two responsibilities are separate images.
PORTAL_ENGLISH_CONTRACT = {
    "name": "The response vanished. Do not create the payment again",
    "description": "Audit a response lost after commit, then use a durable SQLite receipt to replay one logical operation.",
    "labels": {
        "environment": "environment - paste the Workbench pass phrase",
        "uncertain": "uncertain - state what server state the client can assert immediately after timeout",
        "audit": "audit - list later ledger rows that duplicated one logical operation",
        "replay": "replay - replay stored status/body for the same key and request",
        "bind": "bind - bind a key to the request fingerprint and return 409 for another request",
        "generalize": "generalize - keep one business effect across concurrent retries and handler recreation",
    },
}


def _limits() -> None:
    if _ADDRESS_SPACE_CAPPABLE:
        resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_NPROC, (64, 64))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_OUTPUT_BYTES, MAX_OUTPUT_BYTES))


def _json_value(value: object) -> object:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return value.strip()
    return value


def _check_environment(submission: object) -> bool:
    return isinstance(submission, str) and submission.strip() == health_token(SEED)


def _check_uncertain(submission: object) -> bool:
    expected = [public_operation(SEED)["requestId"], "unknown"]
    return _json_value(submission) == expected


def _check_audit(submission: object) -> bool:
    value = _json_value(submission)
    if not isinstance(value, list) or any(type(item) is not int for item in value):
        return False
    expected = [index for index, row in enumerate(audit_log(SEED)) if row["attempt"] == 2]
    return len(value) == len(set(value)) and sorted(value) == expected


RUNNER = """
import json, os, sys
sys.path.insert(0, {root!r})
from tests.hidden import check_idempotency
private_checker = getattr(check_idempotency, {phase!r})
for module_name in tuple(sys.modules):
    if module_name == "tests" or module_name.startswith("tests.") or module_name == "fixtures" or module_name.startswith("fixtures."):
        sys.modules.pop(module_name, None)
while {root!r} in sys.path:
    sys.path.remove({root!r})
sys.path.insert(0, {workspace!r})

def evaluate_submission(checker):
    try:
        import idempotency
    except Exception as error:
        return ["submission could not be imported: " + type(error).__name__]
    if not hasattr(idempotency, "handle_request"):
        return ["submission does not define handle_request()"]
    return checker(idempotency, {seed!r})

print(json.dumps({{"failures": evaluate_submission(private_checker)}}))
sys.stdout.flush()
os._exit(0)
"""


def _check_code(phase: str, submission: object) -> bool:
    if not isinstance(submission, str) or not submission.strip() or len(submission) > MAX_BODY_BYTES:
        return False
    with tempfile.TemporaryDirectory() as workspace:
        Path(workspace, "idempotency.py").write_text(submission, encoding="utf-8")
        transcript = Path(workspace, "stdout")
        try:
            with transcript.open("w", encoding="utf-8") as sink:
                completed = subprocess.run(
                    [
                        sys.executable,
                        "-I",
                        "-c",
                        RUNNER.format(root=str(ROOT), workspace=workspace, phase=phase, seed=SEED),
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
            return False
    if completed.returncode != 0:
        return False
    for line in reversed(output.splitlines()):
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        failures = payload.get("failures")
        return isinstance(failures, list) and not failures
    return False


def _check_replay(submission: object) -> bool:
    return _check_code(CODE_CHECKPOINT_PHASES["replay"], submission) and bool(SEED)


def _check_bind(submission: object) -> bool:
    return _check_code(CODE_CHECKPOINT_PHASES["bind"], submission) and bool(SEED)


def _check_generalize(submission: object) -> bool:
    return _check_code(CODE_CHECKPOINT_PHASES["generalize"], submission) and bool(SEED)


def evaluate(checkpoint_id: str, submission: object) -> bool:
    if checkpoint_id == "environment":
        return _check_environment(submission)
    if checkpoint_id == "uncertain":
        return _check_uncertain(submission)
    if checkpoint_id == "audit":
        return _check_audit(submission)
    checker = globals().get(f"_check_{checkpoint_id}")
    return bool(checker(submission)) if callable(checker) else False


class Handler(BaseHTTPRequestHandler):
    timeout = REQUEST_TIMEOUT_SECONDS

    def do_GET(self) -> None:  # noqa: N802
        if urlsplit(self.path).path == "/health":
            self._respond(200, {"ok": True})
            return
        self._respond(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if urlsplit(self.path).path.rstrip("/") != "/verify":
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
            body = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError, OSError, TimeoutError):
            self._respond(400, {"error": "bad json"})
            return
        if not isinstance(body, dict):
            self._respond(400, {"error": "bad json"})
            return
        checkpoint_id = body.get("checkpointId")
        submission = body.get("submission")
        correct = isinstance(checkpoint_id, str) and evaluate(checkpoint_id, submission)
        self._respond(200, {"checkpointId": checkpoint_id, "correct": correct})

    def _respond(self, status: int, payload: object) -> None:
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, _format: str, *_args: object) -> None:
        return


def main() -> None:
    # Bind all container interfaces for the internal Compose network; this verifier
    # has no published host port. The Workbench is the only loopback entry point.
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
