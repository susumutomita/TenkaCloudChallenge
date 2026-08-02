"""POST /verify -- the scoring seam. Loopback only, stdlib only.

`scoring.kind: "verify"`: the platform holds no answer, posts whatever the player
typed into the answer box, and records the boolean this returns. The flag is derived
from the per-deploy FLAG_SEED inside the container, so there is nothing to compare
against in the repository and nothing to memorise between deployments.

This verifier runs no participant code. The grading that needs reasoning happens in
`shares.py` against the player's own readings, in their own terminal; by the time a
string reaches here the only question left is whether it is this deployment's flag.
That is why there is no submission sandbox in this file -- there is no submission to
sandbox.
"""

from __future__ import annotations

import hmac
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fixtures.generate import flag as derive_flag

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")

#: A flag is 40-odd characters. Anything larger is not an answer.
MAX_BODY_BYTES = 8 * 1024
#: Wall clock for reading a request body, so a stalled client cannot pin the server.
REQUEST_TIMEOUT_SECONDS = 15


def evaluate(submission: object) -> bool:
    """True iff the submission is this deployment's flag."""
    if not isinstance(submission, str):
        return False
    # Constant time, so a wrong answer's rejection does not measure how much of the
    # flag was right. The platform charges for wrong answers; a timing oracle would
    # make that charge avoidable.
    return hmac.compare_digest(submission.strip(), derive_flag(SEED))


class Handler(BaseHTTPRequestHandler):
    #: `StreamRequestHandler.setup` applies this to the socket before `rfile` is created,
    #: so it bounds `rfile.read` inside `do_POST` -- which a client that sends a
    #: content-length and then stops sending would otherwise block on forever, pinning
    #: this single-threaded server. Setting it here rather than in an overridden `setup`
    #: is deliberate: `self.connection` does not exist until the base `setup` has run.
    timeout = REQUEST_TIMEOUT_SECONDS

    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler's name
        if self.path.rstrip("/") != "/verify":
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
        try:
            correct = evaluate(body.get("submission"))
        except Exception:  # noqa: BLE001 - a broken verdict must not kill the verifier
            correct = False
        # The message never restates the expected value, so a wrong answer learns
        # nothing beyond "wrong".
        self._respond(
            200,
            {
                "correct": correct,
                "message": (
                    "Flag accepted."
                    if correct
                    else "That is not the flag for this deployment. `shares flag` prints it "
                    "once all four stages are cleared."
                ),
            },
        )

    def log_message(self, *_args: object) -> None:
        """Silence the default access log; it would echo submissions."""

    def _respond(self, status: int, payload: dict[str, object]) -> None:
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


def main() -> None:
    port = int(os.environ.get("VERIFY_PORT", "18095"))
    # Bind every interface *inside the container*, not the container's loopback. A published
    # port is forwarded to the container's bridge address, so a server listening only on
    # 127.0.0.1 inside the container accepts nothing from outside it -- the connection is
    # opened and closed without a response, and the platform can never score the problem.
    #
    # The loopback restriction that matters is on the host, and it lives in
    # docker-compose.yml, which publishes `127.0.0.1:<port>:<port>`. Nothing outside this
    # machine can reach the verifier either way.
    HTTPServer(("0.0.0.0", port), Handler).serve_forever()  # noqa: S104 - see above


if __name__ == "__main__":
    main()
