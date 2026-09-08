"""POST /verify -- the scoring seam. Compose-internal only, stdlib only.

Security contract (docs/curricula/advanced-cryptography-2026/TEMPLATE.md §/verify):
  - `checkpointId` is required and is echoed back verbatim. The platform fails closed
    on a missing or mismatched echo, so it can never credit another checkpoint.
  - Grading stays in the parent. Restricted learner processes return function
    values, never grading verdicts. The source tree is never written to.
  - Learner code runs in a subprocess with a wall-clock timeout, a memory cap, and a
    capped output size. A hang, a fork bomb, or a gigabyte of prints fails the
    checkpoint instead of the verifier.
  - No learner input is ever concatenated into a shell command; the subprocess is
    invoked with an argument list and `shell=False`.
  - Responses carry `correct` and, for a failed code checkpoint, a `message` naming
    the broken properties the starter docstring already states (AGENTS.md §15). Never
    the hidden test names, the expected values, or reference output.
  - Malformed input produces a failed checkpoint, never a crashed process.

Issue 543/537: this used to be the same process that also served the Participant
Portal's config, inspect, starter, public-test, and prepare endpoints, in the single
Docker stage a learner's own `make build` produced -- so `window`'s and `audit`'s
expected values (`validity_window`, and the second element of what `decision_log` used
to return) were importable from inside the learner's own container. That Portal-facing
surface now lives in `participant/server.py`, in a separate image (see ../Dockerfile)
that this process's own container never builds; this file and its `verifier/expected.py`
import are reachable only over the Compose-internal network (see ../docker-compose.yml),
never from the participant container's filesystem.
"""

from __future__ import annotations

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from participant.execution import LearnerError, LearnerSession
from tests.hidden import check_authorize

from fixtures.generate import decision_log, health_token, public_payload, validity_window
from verifier.expected import audit_wrong_rows

ROOT = Path(__file__).resolve().parents[1]
SEED = os.environ.get("FLAG_SEED", "local-dev-seed")

MAX_BODY_BYTES = 256 * 1024
RUN_TIMEOUT_SECONDS = 12
#: Wall clock for reading a request body, so a stalled client cannot pin the server.
REQUEST_TIMEOUT_SECONDS = 15
#: Cap for the failed-code-checkpoint `message`, under the platform's 2000-char schema.
MAX_MESSAGE_CHARS = 1900

CHECKPOINTS = ("environment", "window", "audit", "verify", "isolate", "generalize")
SUBMISSION_FILES = ("authorize.py",)
#: Checkpoints scored by running the learner's file against a hidden phase, and which
#: phase each one buys. The direct-answer checkpoints are not in here.
CODE_CHECKPOINT_PHASES = {
    "verify": "check_verify",
    "isolate": "check_isolate",
    "generalize": "check_generalize",
}
CODE_CHECKPOINTS = frozenset(CODE_CHECKPOINT_PHASES)


def _normalized_int(value: object) -> int | None:
    """Accept an int or a decimal string; reject everything else. No eval, ever."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        text = value.strip()
        try:
            return int(text, 10)
        except ValueError:
            return None
    return None


def _normalized_int_list(submission: object) -> list[int] | None:
    """Accept a JSON array of integers, or the same thing as a string. No eval, ever."""
    value = submission
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return None
    if not isinstance(value, list):
        return None
    out: list[int] = []
    for item in value:
        number = _normalized_int(item)
        if number is None:
            return None
        out.append(number)
    return out





def _check_environment(submission: object) -> bool:
    return isinstance(submission, str) and submission.strip() == health_token(SEED)


def _check_window(submission: object) -> bool:
    """The first and last `now` the shown token is accepted at.

    Both ends are required. Accepting a one-element answer would let "I found `exp`"
    score the same as "I worked out that `exp` is exclusive".
    """
    value = _normalized_int_list(submission)
    return value is not None and value == validity_window(SEED)


def _check_audit(submission: object) -> bool:
    """The decision-log rows the gateway allowed and should not have.

    Order-insensitive on the way in, because the learner reads the log in whatever
    order they like; duplicates are rejected, because a list that names a row twice is
    not an audit finding.
    """
    value = _normalized_int_list(submission)
    if value is None or len(set(value)) != len(value):
        return False
    return sorted(value) == audit_wrong_rows(SEED)





def _failure_detail(failures: list[object]) -> str:
    """Join the checker's property-level failure strings for the response `message`.

    The checker's strings name broken properties the starter docstring already
    states, never expected values (AGENTS.md §15). Non-string entries are dropped
    rather than serialized.
    """
    return "; ".join(dict.fromkeys(item for item in failures if isinstance(item, str)))[:MAX_MESSAGE_CHARS]


def _check_code(phase: str, submission: object):
    source = submission
    if not isinstance(source, str) or not source.strip() or len(source) > MAX_BODY_BYTES:
        return False, ""
    try:
        with LearnerSession({'authorize.py': source}, timeout=RUN_TIMEOUT_SECONDS) as learner:
            failures = getattr(check_authorize, phase)(learner.module(), SEED)
    except (LearnerError, OSError, ValueError, TypeError, RecursionError):
        return False, 'The submitted functions could not be evaluated within the time limit.'
    return not failures, _failure_detail(failures)



def evaluate(checkpoint_id: str, submission: object) -> tuple[bool, str]:
    """Verdict plus, for a failed code checkpoint, a property-level failure summary.

    Direct-answer checkpoints never carry detail: a reason would narrow their
    expected value (AGENTS.md §15).
    """
    if checkpoint_id == "environment":
        return _check_environment(submission), ""
    if checkpoint_id == "window":
        return _check_window(submission), ""
    if checkpoint_id == "audit":
        return _check_audit(submission), ""
    phase = CODE_CHECKPOINT_PHASES.get(checkpoint_id)
    if phase is not None:
        return _check_code(phase, submission)
    return False, ""


class Handler(BaseHTTPRequestHandler):
    #: `StreamRequestHandler.setup` applies this to the socket before `rfile` is created,
    #: so it bounds `rfile.read` inside `do_POST` -- which a client that sends a
    #: content-length and then stops sending would otherwise block on forever, pinning
    #: this single-threaded server. Setting it here rather than in an overridden `setup`
    #: is deliberate: `self.connection` does not exist until the base `setup` has run.
    timeout = REQUEST_TIMEOUT_SECONDS

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler's name
        path = urlsplit(self.path).path
        if path == "/healthz":
            self._respond(200, {"ok": True})
            return
        if path == "/public":
            self._respond(200, public_payload(SEED))
            return
        self._respond(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler's name
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
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._respond(400, {"error": "bad json"})
            return
        except (TimeoutError, OSError):
            # A stalled body read, not a malformed one. Same fail-closed outcome.
            self._respond(400, {"error": "incomplete body"})
            return
        if not isinstance(body, dict):
            self._respond(400, {"error": "bad json"})
            return

        checkpoint_id = body.get("checkpointId")
        if not isinstance(checkpoint_id, str) or checkpoint_id not in CHECKPOINTS:
            # Unknown checkpoint is a failed verdict with the id echoed when it is at
            # least a string, so the platform's echo check still holds.
            self._respond(
                200,
                {
                    "checkpointId": checkpoint_id if isinstance(checkpoint_id, str) else "",
                    "correct": False,
                },
            )
            return

        try:
            correct, detail = evaluate(checkpoint_id, body.get("submission"))
        except Exception:  # noqa: BLE001 - a broken checkpoint must not kill the verifier
            correct, detail = False, ""
        payload: dict[str, object] = {"checkpointId": checkpoint_id, "correct": correct}
        if not correct and detail:
            payload["message"] = detail
        self._respond(200, payload)

    def log_message(self, *_args: object) -> None:
        """Silence the default stderr access log; it would echo submissions."""

    def _respond(self, status: int, payload: dict[str, object]) -> None:
        encoded = json.dumps(payload).encode("utf-8")
        self._respond_bytes(status, encoded, "application/json")

    def _respond_bytes(self, status: int, encoded: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("content-type", content_type)
        self.send_header("content-length", str(len(encoded)))
        self.send_header("cache-control", "no-store")
        self.send_header("x-content-type-options", "nosniff")
        self.send_header(
            "content-security-policy",
            "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; "
            "img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; "
            "form-action 'self'",
        )
        self.end_headers()
        self.wfile.write(encoded)


def main() -> None:
    port = int(os.environ.get("VERIFY_PORT", "18301"))
    # Bind every interface *inside the container*, not the container's loopback. The
    # Workbench reaches this process as `verifier:<port>` over the Compose network, which
    # resolves to this container's bridge address -- a server listening only on
    # 127.0.0.1 inside the container would accept nothing from it, and the platform
    # could never score the problem.
    #
    # Since Issue 543/537 this service publishes no host port at all (see
    # docker-compose.yml): it sits on the `lab` network, which is `internal: true` and so
    # carries no gateway. Nothing but the Workbench container can reach it.
    HTTPServer(("0.0.0.0", port), Handler).serve_forever()  # noqa: S104 - see above


if __name__ == "__main__":
    main()
