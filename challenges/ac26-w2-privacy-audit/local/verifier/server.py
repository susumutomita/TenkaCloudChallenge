"""POST /verify — the scoring seam. Loopback only, stdlib only.

Security contract (docs/curricula/advanced-cryptography-2026/TEMPLATE.md §/verify):
  - `checkpointId` is required and is echoed back verbatim. The platform fails closed
    on a missing or mismatched echo, so it can never credit another checkpoint.
  - Sources are sent to a fresh bounded learner process. No source tree is written.
  - Learner code runs without the checker or seed. Only untrusted function values
    cross the channel; the parent checks the documented mathematical properties.
    Wall-clock, memory and output caps bound the child and its process group.
  - No learner input is ever concatenated into a shell command; the subprocess is
    invoked with an argument list and `shell=False`.
  - Responses carry `correct` and, at most, a property name. Never the hidden test
    names, the expected values, or reference output.
  - Malformed input produces a failed checkpoint, never a crashed process.

Issue 537/538 (Issue 543 option B2): this used to be the same process that also served
the Participant Portal's config, inspect, starter, public-test and prepare endpoints, in
the single Docker stage a learner's own `make build` produced -- so
`tests/hidden/check_auditor.py` shipped in the learner's own image alongside it, and all
seven checkpoints are graded by running that suite. Its `_expected_index` and `_leaks`
state, event kind by event kind, the rule `first_violation` exists to make a learner
derive, and `check_repair` states the acceptance rule for `repair` outright.
`fixtures/generate.py` shipped there too, and its `TRUTH` names the verdict for each of
the seven programs by id. That Portal-facing surface now lives in
`participant/server.py`, in a separate image (see ../Dockerfile) that this process's own
container never builds; this file, `fixtures/` and `tests/hidden/` are reachable only
over the Compose-internal network (see ../docker-compose.yml), never from the
participant container's filesystem.

`GET /public` below is what the participant image reads instead of importing
`fixtures.generate`.
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

from fixtures.generate import public_payload
from tests.hidden import check_auditor
from participant.execution import LearnerError, LearnerSession
from participant.isolation import protect_supervisor

ROOT = Path(__file__).resolve().parents[1]
PROBLEM_ID = "ac26-w2-privacy-audit"
SEED = os.environ.get("FLAG_SEED", "local-dev-seed")

MAX_BODY_BYTES = 256 * 1024
RUN_TIMEOUT_SECONDS = 20
MAX_ADDRESS_SPACE_BYTES = 512 * 1024 * 1024
MAX_PROCESSES = 64
MAX_OUTPUT_BYTES = 64 * 1024
#: Cap for the verdict's optional human-readable failure summary. Kept under the
#: platform's 2000-character message limit with room to spare.
MAX_MESSAGE_CHARS = 1900
#: Wall clock for reading a request body, so a stalled client cannot pin the server.
REQUEST_TIMEOUT_SECONDS = 15

# Every checkpoint runs the learner's auditor.py; they differ in which hidden phases
# they run. `mutation` additionally runs under a seed the learner has never been shown,
# so the renamed programs it audits are built from parameters it cannot have memorized.
CODE_CHECKPOINTS = {
    "allowed-opens": ("check_allowed",),
    "opened-secret": ("check_opened_secret",),
    "cross-party": ("check_cross_party",),
    "log-leak": ("check_log_leak",),
    "transcript": ("check_transcript",),
    "repair": ("check_repair",),
    "mutation": ("check_mutation",),
}
CHECKPOINTS = tuple(CODE_CHECKPOINTS)
#: Every checkpoint here is answered by submitting a file, so this set is empty today.
#: It is derived rather than written out so that adding a direct-answer checkpoint later
#: cannot silently skip the seal check in `_unwrap_submission`.
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
    source = submission
    if isinstance(source, dict):
        source = source.get("auditor.py")
    if not isinstance(source, str) or not source.strip():
        return False, None
    if len(source) > MAX_BODY_BYTES:
        return False, None
    try:
        with LearnerSession({'auditor.py': source}, timeout=RUN_TIMEOUT_SECONDS) as learner:
            module = learner.module()
            if phases:
                failures = []
                for name in phases:
                    failures.extend(getattr(check_auditor, name)(module, seed))
            else:
                failures = check_auditor.run(module, seed)
    except (LearnerError, OSError, ValueError):
        return False, 'The submitted functions could not be evaluated.'
    return not failures, _failure_message(failures)


def evaluate(checkpoint_id: str, submission: object) -> bool:
    """Boolean verdict for callers that need only pass/fail (mutation.py does)."""
    correct, _message = evaluate_with_message(checkpoint_id, submission)
    return correct


def evaluate_with_message(
    checkpoint_id: str, submission: object
) -> tuple[bool, str | None]:
    if checkpoint_id in CODE_CHECKPOINTS:
        seed = f"{SEED}:mutation" if checkpoint_id == "mutation" else SEED
        return _run_submission(submission, CODE_CHECKPOINTS[checkpoint_id], seed)
    return False, None

def _b64decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def _unwrap_submission(checkpoint_id: str, submission: object) -> object:
    """Undo the Workbench's `tcw1.` seal and check it against this deployment.

    The derivation is duplicated from `participant/workbench.py`'s
    `PortalEditorSupport._seal_manual` rather than imported, because that module lives
    only in the participant image (see ../Dockerfile). Repeating it here rather than
    trusting an already-unwrapped value from the Workbench is what keeps the seal
    meaningful: a caller who skips the Workbench is judged by the same rule. Same shape
    as ac26-w2-secret-sharing's, ac26-w2-beaver-mul's and ac26-w4-commit-open's verifiers, for the same reason.

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

    The Portal editor API is deliberately absent: it lives in `participant/server.py`,
    which runs in the image a learner builds. Everything here runs in the image that
    carries `fixtures/` and `tests/hidden/`, and is never published to the host.
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
        if urlsplit(self.path).path.rstrip("/") != "/verify":
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
    protect_supervisor()
    port = int(os.environ.get("VERIFY_PORT", "18149"))
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
