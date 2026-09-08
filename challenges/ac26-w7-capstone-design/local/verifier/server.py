"""Compose-internal scoring service: the parent owns all checks and verdicts.

The isolated worker receives the submission and individual public-shape function
arguments. It returns inert values only; its stdout, exceptions, modules and exit
status cannot claim checkpoint success. GET /public serves the deployment's brief.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fixtures.generate import public_payload  # noqa: E402 - after the sys.path insert
from participant.execution import LearnerError, LearnerSession
from participant.isolation import protect_supervisor
from tests.hidden import check_design

ROOT = Path(__file__).resolve().parents[1]
PROBLEM_ID = "ac26-w7-capstone-design"
SEED = os.environ.get("FLAG_SEED", "local-dev-seed")

MAX_BODY_BYTES = 256 * 1024
RUN_TIMEOUT_SECONDS = 12
#: Cap for the verdict's optional human-readable failure summary. Kept under the
#: platform's 2000-character message limit with room to spare.
MAX_MESSAGE_CHARS = 1900
#: Wall clock for reading a request body, so a stalled client cannot pin the server.
REQUEST_TIMEOUT_SECONDS = 15

#: checkpoint id -> the hidden phases it closes on. One outcome per checkpoint.
CODE_CHECKPOINTS = {
    "assets": ("check_assets",),
    "requirements": ("check_requirements",),
    "alternatives": ("check_alternatives",),
    "selection": ("check_selection",),
    "architecture": ("check_architecture",),
    "attacks": ("check_attacks",),
    "matrix": ("check_matrix",),
    "revision": ("check_revision",),
}
CHECKPOINTS = tuple(CODE_CHECKPOINTS)
MANUAL_CHECKPOINTS = frozenset(CHECKPOINTS) - frozenset(CODE_CHECKPOINTS)


def _failure_message(failures: list[object]) -> str | None:
    """Join the hidden checker's failure list into one participant-facing message.

    Only checker-authored strings are kept: anything else that ends up in the list
    is dropped rather than serialized, so a checker bug cannot push raw values
    through the message field.
    """
    text = "; ".join(dict.fromkeys(item for item in failures if isinstance(item, str)))
    return text[:MAX_MESSAGE_CHARS] if text else None


def _run_submission(
    submission: object, phases: tuple[str, ...], seed: str
) -> tuple[bool, str | None]:
    """Validate worker function values in this trusted process, never learner stdout."""
    source = submission.get("design.py") if isinstance(submission, dict) else submission
    if not isinstance(source, str) or not source.strip() or len(source.encode()) > MAX_BODY_BYTES:
        return False, None
    if sys.platform != "linux":
        return False, "the deployed evaluator requires Linux isolation"
    try:
        protect_supervisor()
        with LearnerSession({"design.py": source}, timeout=RUN_TIMEOUT_SECONDS) as learner:
            module = learner.module()
            failures = []
            for name in phases:
                failures.extend(getattr(check_design, name)(module, seed))
        return (False, _failure_message(failures)) if failures else (True, None)
    except (LearnerError, OSError, ValueError, TypeError, RecursionError):
        return False, "design.py could not produce the required values within the execution limits"


def evaluate(checkpoint_id: str, submission: object) -> bool:
    """Boolean verdict for callers that need only pass/fail (mutation.py does)."""
    correct, _message = evaluate_with_message(checkpoint_id, submission)
    return correct


def evaluate_with_message(
    checkpoint_id: str, submission: object
) -> tuple[bool, str | None]:
    if checkpoint_id in CODE_CHECKPOINTS:
        return _run_submission(submission, CODE_CHECKPOINTS[checkpoint_id], SEED)
    return False, None

def _b64decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def _unwrap_submission(checkpoint_id: str, submission: object) -> object:
    """Undo the Workbench's `tcw1.` seal and check it against this deployment.

    The derivation is duplicated from `participant/workbench.py`'s
    `PortalEditorSupport._seal_manual` rather than imported, because that module lives only in
    the participant image (see ../Dockerfile). Repeating it here rather than trusting an
    already-unwrapped value from the Workbench is what keeps the seal meaningful: a caller who
    skips the Workbench is judged by the same rule. Same shape as ac26-w7-capstone-demo's and
    ac26-w4-commit-open's verifiers, for the same reason.

    Every checkpoint here is a code checkpoint, so `MANUAL_CHECKPOINTS` is empty and an
    unsealed submission keeps its historical raw-source format. The seal path is still
    honoured, so a Portal that seals a code submission is graded rather than rejected.
    """
    if not isinstance(submission, str) or not submission.startswith("tcw1."):
        return None if checkpoint_id in MANUAL_CHECKPOINTS else submission
    try:
        prefix, encoded_payload, encoded_signature = submission.split(".", 2)
        if prefix != "tcw1":
            return None
        payload = _b64decode(encoded_payload)
        signature = _b64decode(encoded_signature)
        key = hashlib.sha256((PROBLEM_ID + "\0" + SEED).encode("utf-8")).digest()
        expected_signature = hmac.new(key, payload, hashlib.sha256).digest()[:16]
        if not hmac.compare_digest(signature, expected_signature):
            return None
        decoded = json.loads(payload.decode("utf-8"))
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
        return None
    if not isinstance(decoded, dict):
        return None
    if decoded.get("v") != 1 or decoded.get("checkpointId") != checkpoint_id:
        return None
    return decoded.get("answer")

class Handler(BaseHTTPRequestHandler):
    """Serve the /verify contract, and nothing a participant-facing client needs.

    The Portal editor API is deliberately absent: it lives in `participant/server.py`, which
    runs in the image a learner builds. Everything here runs in the image that carries
    `fixtures/` and `tests/hidden/`, and is never published to the host.
    """

    timeout = REQUEST_TIMEOUT_SECONDS

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler's API
        path = urlsplit(self.path).path
        if path == "/healthz":
            self._respond(200, {"ok": True})
            return
        if path == "/public":
            self._respond(200, public_payload(SEED))
            return
        self._respond(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler's API
        path = urlsplit(self.path).path.rstrip("/") or "/"
        if path != "/verify":
            self._respond(404, {"error": "not found"})
            return
        body = self._read_json_body()
        if body is None:
            return

        checkpoint_id = body.get("checkpointId")
        if not isinstance(checkpoint_id, str) or checkpoint_id not in CHECKPOINTS:
            self._respond(
                200,
                {
                    "checkpointId": checkpoint_id if isinstance(checkpoint_id, str) else "",
                    "correct": False,
                },
            )
            return
        submission = _unwrap_submission(checkpoint_id, body.get("submission"))
        try:
            correct, message = evaluate_with_message(checkpoint_id, submission)
        except Exception:  # noqa: BLE001 - a broken checkpoint must fail closed
            correct, message = False, None
        verdict: dict[str, object] = {"checkpointId": checkpoint_id, "correct": correct}
        if not correct and message:
            verdict["message"] = message
        self._respond(200, verdict)

    def _read_json_body(self) -> dict[str, object] | None:
        try:
            length = int(self.headers.get("content-length", "0"))
        except ValueError:
            self._respond(400, {"error": "bad content-length"})
            return None
        if length <= 0 or length > MAX_BODY_BYTES:
            self._respond(400, {"error": "bad content-length"})
            return None
        try:
            body = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._respond(400, {"error": "bad json"})
            return None
        except (TimeoutError, OSError):
            self._respond(400, {"error": "incomplete body"})
            return None
        if not isinstance(body, dict):
            self._respond(400, {"error": "bad json"})
            return None
        return body

    def log_message(self, *_args: object) -> None:
        """Do not echo source submissions into the access log."""

    def _respond(self, status: int, payload: dict[str, object]) -> None:
        self._respond_bytes(
            status,
            json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            "application/json; charset=utf-8",
        )

    def _respond_bytes(self, status: int, content: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("content-type", content_type)
        self.send_header("content-length", str(len(content)))
        self.send_header("cache-control", "no-store")
        self.send_header("x-content-type-options", "nosniff")
        self.send_header(
            "content-security-policy",
            "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; "
            "img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; "
            "form-action 'self'",
        )
        self.end_headers()
        self.wfile.write(content)

def main() -> None:
    port = int(os.environ.get("VERIFY_PORT", "18159"))
    # Bind every interface *inside the container*, not the container's loopback. Compose
    # reaches this service by name over the internal `lab` network, which has no gateway and
    # is never published to the host (see ../docker-compose.yml).
    HTTPServer(("0.0.0.0", port), Handler).serve_forever()  # noqa: S104 - see above


if __name__ == "__main__":
    main()
