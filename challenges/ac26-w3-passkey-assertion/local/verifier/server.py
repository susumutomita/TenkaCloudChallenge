"""POST /verify — the scoring seam. Compose-internal only, stdlib only.

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
  - Responses carry `correct` and, at most, a property name. Never the hidden test
    names, the expected values, or reference output.
  - Malformed input produces a failed checkpoint, never a crashed process.

Issue 537/538 (Issue 543 option B2): this used to be the same process that also served
the Participant Portal's config, inspect, starter, public-test and prepare endpoints, in
the single Docker stage a learner's own `make build` produced -- so
`tests/hidden/check_assertion.py` shipped in the learner's own image alongside it, and
all three checkpoints are graded by running that suite. `fixtures/generate.py` shipped
there too: it defines `signed_message` under the exact name `starter/assertion.py`'s own
stub asks the learner to write, and `fixture()` labels every assertion by kind for any
seed a caller names -- and a learner knows their own `FLAG_SEED`, from which the hidden
suite's derived seeds follow. Together those two answered all three checkpoints from a
lookup table with no WebAuthn reasoning at all. That Portal-facing surface now lives in
`participant/server.py`, in a separate image (see ../Dockerfile) that this process's own
container never builds; this file, `fixtures/` and `tests/hidden/` are reachable only
over the Compose-internal network (see ../docker-compose.yml), never from the participant
container's filesystem.

`GET /public` below is what the participant image reads instead of importing
`fixtures.generate`.
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
from tests.hidden import check_assertion

from fixtures.generate import public_payload

ROOT = Path(__file__).resolve().parents[1]
SEED = os.environ.get("FLAG_SEED", "local-dev-seed")

MAX_BODY_BYTES = 256 * 1024
RUN_TIMEOUT_SECONDS = 12
#: Wall clock for reading a request body, so a stalled client cannot pin the server.
REQUEST_TIMEOUT_SECONDS = 15
#: Cap for the failed-code-checkpoint `message`, under the platform's 2000-char schema.
MAX_MESSAGE_CHARS = 1900

CHECKPOINTS = ("signature", "find-uv-gap", "enforce-uv")
#: Every checkpoint is graded by running the hidden suite against the learner's file, so
#: this process only ever receives source. The Portal editor contract -- config, starter,
#: inspect, public tests, prepare -- lives in `participant/server.py` since Issue 543 B2.
CODE_CHECKPOINTS = CHECKPOINTS


def _failure_detail(failures: list[object]) -> str:
    """Join the checker's property-level failure strings for the response `message`.

    The checker's strings name broken properties and assertion categories, never a
    hidden caseId or expected value (AGENTS.md §15). Non-string entries are dropped
    rather than serialized.
    """
    return "; ".join(dict.fromkeys(item for item in failures if isinstance(item, str)))[:MAX_MESSAGE_CHARS]


def _check_source(checkpoint_id: str, submission: object):
    source = submission
    if not isinstance(source, str) or not source.strip() or len(source) > MAX_BODY_BYTES:
        return False, ""
    try:
        with LearnerSession({'assertion.py': source}, timeout=RUN_TIMEOUT_SECONDS) as learner:
            failures = check_assertion.run(learner.module(), SEED, checkpoint_id)
    except (LearnerError, OSError, ValueError, TypeError, RecursionError):
        return False, 'The submitted functions could not be evaluated within the time limit.'
    return not failures, _failure_detail(failures)



def evaluate(checkpoint_id: str, submission: object) -> tuple[bool, str]:
    """Verdict plus, on failure, a property-level failure summary (AGENTS.md §15)."""
    if checkpoint_id not in CHECKPOINTS:
        return False, ""
    return _check_source(checkpoint_id, submission)


class Handler(BaseHTTPRequestHandler):
    """Serve the /verify contract, and nothing a participant-facing client needs.

    The Portal editor API is deliberately absent: it lives in `participant/server.py`,
    which runs in the image a learner builds. Everything here runs in the image that
    carries `fixtures/` and `tests/hidden/`, and is never published to the host.
    """

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
        path = urlsplit(self.path).path.rstrip("/") or "/"
        if path != "/verify":
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
    port = int(os.environ.get("VERIFY_PORT", "18146"))
    # Bind every interface *inside the container*, not the container's loopback: the
    # Workbench reaches this process as `verifier:<port>` over the Compose network, which
    # resolves to this container's bridge address — a server listening only on 127.0.0.1
    # inside the container would accept nothing from it, and the platform could never
    # score the problem.
    #
    # Since Issue 537/538 this service publishes no host port at all (see
    # docker-compose.yml): it sits on the `lab` network, which is `internal: true` and so
    # carries no gateway. Nothing but the Workbench container can reach it.
    HTTPServer(("0.0.0.0", port), Handler).serve_forever()  # noqa: S104 - see above


if __name__ == "__main__":
    main()
