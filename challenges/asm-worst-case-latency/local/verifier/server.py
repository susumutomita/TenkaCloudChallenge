"""Separated hidden verifier for the latency lab. Loopback only, stdlib only."""

from __future__ import annotations

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fixtures.generate import health_token, stable_seed
from tests.hidden.check_candidate import Rejected, grade

ROOT = Path(__file__).resolve().parents[1]
SEED = os.environ.get("FLAG_SEED", "local-dev-seed")
MAX_BODY_BYTES = 256 * 1024
REQUEST_TIMEOUT_SECONDS = 15

CHECKPOINTS = ("environment", "measure", "dependency", "miss", "generalize")
CODE_CHECKPOINTS = frozenset(("measure", "dependency", "miss", "generalize"))

#: What each code checkpoint requires of the normalized score. The ladder is the
#: problem: a dependent chain beats independent arithmetic, and a dependent chain
#: through memory the machine cannot predict beats everything.
THRESHOLDS = {
    # The candidate and baseline wrappers are byte-for-byte equivalent for the
    # starter, but they are sampled at different moments. Leave a bounded noise
    # window around the expected ~1.0 ratio so the shipped starting point does
    # not randomly fail its first checkpoint on an otherwise supported host.
    "measure": 0.75,
    "dependency": 3.0,  # slower than register arithmetic can be made
    "miss": 20.0,       # unmistakably off-core
    "generalize": 20.0, # ...and again under a seed the participant has not seen
}

# Metadata parity guard (#381) reads this authored verifier source: the English here
# must be the English metadata.json carries, verbatim.
PORTAL_ENGLISH_CONTRACT = {
    "name": "One instruction, as slow as you can make it",
    "description": "On a harness that measures a single instruction honestly, find the one this machine hates most.",
    "labels": {
        "environment": "environment - paste the pass phrase",
        "measure": "measure - produce an honest measurement at all",
        "dependency": "dependency - beat register arithmetic",
        "miss": "miss - reach memory the machine cannot predict",
        "generalize": "generalize - hold up under an unseen seed",
    },
}


def _seed_for(checkpoint_id: str) -> int:
    """`generalize` runs under a seed the participant has never measured on.

    Everything else uses the deployment seed, so a participant tuning against
    their own numbers is tuning against the same arena the grader uses.
    """
    label = f"{SEED}:{checkpoint_id}" if checkpoint_id == "generalize" else SEED
    return stable_seed(label)


def _check_environment(submission: object) -> bool:
    return isinstance(submission, str) and submission.strip() == health_token(SEED)


def _check_code(checkpoint_id: str, submission: object) -> bool:
    if not isinstance(submission, str) or not submission.strip():
        return False
    if len(submission) > MAX_BODY_BYTES:
        return False
    try:
        result = grade(submission, _seed_for(checkpoint_id))
    except Rejected:
        return False
    except Exception:  # noqa: BLE001 - a broken checkpoint must fail closed
        return False
    return result["normalizedScore"] >= THRESHOLDS[checkpoint_id]


def evaluate(checkpoint_id: str, submission: object) -> bool:
    if checkpoint_id == "environment":
        return _check_environment(submission)
    if checkpoint_id in CODE_CHECKPOINTS:
        return _check_code(checkpoint_id, submission)
    return False


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
        correct = isinstance(checkpoint_id, str) and evaluate(checkpoint_id, body.get("submission"))
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
    port = int(os.environ.get("VERIFY_PORT", "18571"))
    # Bind every interface *inside the container*, not the container's loopback. A
    # published port is forwarded to the container's bridge address, so a server listening
    # only on 127.0.0.1 inside the container accepts nothing from outside it — the
    # connection is opened and closed without a response, and the platform can never score
    # the problem.
    #
    # The loopback restriction that matters is on the host, and it lives in
    # docker-compose.yml, which publishes only the Workbench and only on 127.0.0.1. This
    # verifier has no host port at all.
    HTTPServer(("0.0.0.0", port), Handler).serve_forever()  # noqa: S104 - see above


if __name__ == "__main__":
    main()
