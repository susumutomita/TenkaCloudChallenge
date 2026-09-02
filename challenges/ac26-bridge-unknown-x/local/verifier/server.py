"""POST /verify — the scoring seam. Compose-internal only, stdlib only.

Security contract:
  - `checkpointId` is required and is echoed back verbatim. The platform fails closed
    on a missing or mismatched echo, so it can never credit another checkpoint.
  - No learner code is ever executed here. This problem is a drill: every checkpoint
    is a direct answer — the value one line of Python printed on the learner's own
    screen. The grader for every checkpoint is `_check_line`: the pasted value,
    normalised, against the value this deployment's seed decides.
  - Responses carry `correct` and nothing else. Never the hidden test names, the
    expected values, or reference output.
  - Malformed input produces a failed checkpoint, never a crashed process.

Issue 537/543 (option B2): this problem's `fixtures/generate.py` computes the ten
lines' expected values inside `setting(seed)`, in the same function as the public
numbers. That module therefore ships only in this verifier image (and the author
stage), never in the participant Workbench image a learner's own `make build`
produces. The participant side reads this deployment's public half — the assignment
statements and the numbers behind them — from this process's `GET /public` over the
Compose-internal network instead of importing the module (see ../Dockerfile,
../docker-compose.yml and participant/evidence.py).
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

from fixtures.generate import GRADED, LINES, assignments, normalize_answer, setting
from verifier.expected import expected_for

ROOT = Path(__file__).resolve().parents[1]
PROBLEM_ID = "ac26-bridge-unknown-x"
SEED = os.environ.get("FLAG_SEED", "local-dev-seed")

MAX_BODY_BYTES = 256 * 1024
#: Wall clock for reading a request body, so a stalled client cannot pin the server.
REQUEST_TIMEOUT_SECONDS = 15

#: No checkpoint runs learner code. The editor file is a scratchpad whose public test
#: prints the learner's own values; the grade is the pasted value, nothing else. Eight
#: of the eleven drill lines have an answer field (the platform's maximum per problem).
CHECKPOINTS = GRADED
MANUAL_CHECKPOINTS = GRADED


def _check_line(line: str, submission: object) -> bool:
    """The value the learner pasted for one drill line, against this deployment's value.

    A tuple may arrive as `[a, b, c]`, `(a, b, c)` or `a, b, c`; an integer as a number
    or a digit string. The comparison is exact: there is one right value per line per
    seed, and it is the value the line prints when typed against this seed's numbers.
    """
    if line not in GRADED or line not in LINES:
        return False
    answer = submission
    if isinstance(answer, str):
        try:
            answer = json.loads(answer)
        except json.JSONDecodeError:
            answer = answer.strip()
    if isinstance(answer, bool) or answer is None:
        return False
    got = normalize_answer(line, answer)
    if got is None:
        return False
    expected = expected_for(SEED)[line]
    return got == expected


def evaluate(checkpoint_id: str, submission: object) -> bool:
    if checkpoint_id in GRADED:
        return _check_line(checkpoint_id, submission)
    return False


def public_payload(seed: str) -> dict[str, object]:
    """This deployment's public half, served by `GET /public`.

    Exactly what `make inspect` has always printed for a drill, and nothing this
    image knows beyond it: the assignment statements ready to paste into a REPL, and
    the same numbers as a dict. The expected values `setting` also returns stay
    behind — only the `public` key travels.
    """
    return {"assignments": assignments(seed), "public": setting(seed)["public"]}


def _b64decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def _unwrap_submission(checkpoint_id: str, submission: object) -> object:
    """Undo the Workbench's `tcw1.` seal and check it against this deployment.

    A direct-answer submission is HMAC-bound to `PROBLEM_ID` and `SEED` by
    `participant/workbench.py`'s `PortalEditorSupport._seal_manual` — the same
    derivation, duplicated here rather than imported, because that module lives only
    in the participant image (see ../Dockerfile) and this process must not trust an
    unsealed value for any of this problem's checkpoints, all of which are manual.
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
    timeout = REQUEST_TIMEOUT_SECONDS

    def do_GET(self) -> None:  # noqa: N802 - stdlib handler API
        path = urlsplit(self.path).path
        # Compose's healthcheck and this deployment's public half, and nothing else.
        # The Portal editor routes live in participant/server.py: serving any of them
        # from here would put this image back on the participant's reading path, which
        # is the whole thing Issue 537/543 is about.
        if path == "/healthz":
            self._respond(200, {"ok": True})
            return
        if path == "/public":
            self._respond(200, public_payload(SEED))
            return
        self._respond(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802 - stdlib handler API
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
            correct = evaluate(checkpoint_id, submission)
        except Exception:  # noqa: BLE001 - a broken checkpoint must fail closed
            correct = False
        self._respond(200, {"checkpointId": checkpoint_id, "correct": correct})

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
        """Do not echo submissions into the access log."""

    def _respond(self, status: int, payload: dict[str, object]) -> None:
        content = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(content)))
        self.send_header("cache-control", "no-store")
        self.send_header("x-content-type-options", "nosniff")
        self.end_headers()
        self.wfile.write(content)


def main() -> None:
    port = int(os.environ.get("VERIFY_PORT", "18150"))
    # Bind every interface *inside the container*, not the container's loopback. The
    # Workbench reaches this process as `verifier:<port>` over the Compose network,
    # which resolves to this container's bridge address — a server listening only on
    # 127.0.0.1 inside the container would accept nothing from it, and the platform
    # could never score the problem.
    #
    # This service publishes no host port at all (see docker-compose.yml): it sits on
    # the `lab` network, which is `internal: true` and so carries no gateway. Nothing
    # but the participant container can reach it.
    HTTPServer(("0.0.0.0", port), Handler).serve_forever()  # noqa: S104 - see above


if __name__ == "__main__":
    main()
