"""The parent owns fixtures, checks and verdicts; the isolated child returns values only.

Submitted modules cannot publish grading decisions through output or process exit.
Existing checkpoint routing, signed submissions and property-level messages are retained.
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
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fixtures.generate import public_payload
from participant.execution import LearnerError, LearnerSession
from participant.isolation import protect_supervisor
from tests.hidden import check_pipeline

ROOT = Path(__file__).resolve().parents[1]
PROBLEM_ID = "ac26-w5-pbs-homnand"
SEED = os.environ.get("FLAG_SEED", "local-dev-seed")

MAX_BODY_BYTES = 256 * 1024
RUN_TIMEOUT_SECONDS = 12
#: Cap for the verdict's optional human-readable failure summary. Kept under the
#: platform's 2000-character message limit with room to spare.
MAX_MESSAGE_CHARS = 1900
#: Wall clock for reading a request body, so a stalled client cannot pin the server.
REQUEST_TIMEOUT_SECONDS = 15

# Ten stage contracts, eight scored checkpoints.
#
# The pipeline has ten stages and `tests/hidden/check_pipeline.py` grades each one
# separately, with its own failure messages. The multi-verify contract caps a problem at
# eight checks -- catalog-side in SCHEMA.json and again in the platform's
# `packages/problem-sdk/src/scoring-metadata/multi-verify.ts`, which drops the whole scoring
# object rather than truncating it. The two caps are deliberately mirrored, so raising one
# without the other produces a problem that validates and cannot be scored.
#
# So the two most closely coupled pairs share a checkpoint. `relabel` is extraction and the
# key switch: both apply a supplied primitive and both exist to move the ciphertext between
# key domains, so a learner who gets one right and the other wrong has one misunderstanding,
# not two. `nand` is the combination and the gate, which is the same argument -- the gate is
# the combination plus one bootstrap, and grading them apart would suggest otherwise.
CODE_CHECKPOINTS = {
    "lut": ("check_lut",),
    "domain": ("check_domain",),
    "rotate": ("check_rotate",),
    "relabel": ("check_extract", "check_switch"),
    "evaluate": ("check_evaluate",),
    "refresh": ("check_refresh",),
    "nand": ("check_combine", "check_nand"),
    "transfer": ("check_transfer",),
}
CHECKPOINTS = tuple(CODE_CHECKPOINTS)


def _failure_message(failures: list[object]) -> str | None:
    """Join the hidden checker's failure list into one participant-facing message.

    Only checker-authored strings are kept: anything else that ends up in the list
    is dropped rather than serialized, so a checker bug cannot push raw values
    through the message field.
    """
    text = "; ".join(dict.fromkeys(item for item in failures if isinstance(item, str)))
    return text[:MAX_MESSAGE_CHARS] if text else None


def _run_submission(submission: object, phases: tuple[str, ...], seed: str) -> tuple[bool, str | None]:
    """Validate inert function results in the trusted process."""
    source = submission.get('pipeline.py') if isinstance(submission, dict) else submission
    if not isinstance(source, str) or not source.strip() or len(source.encode()) > MAX_BODY_BYTES:
        return False, None
    if sys.platform != "linux":
        return False, "the deployed evaluator requires Linux isolation"
    try:
        protect_supervisor()
        with LearnerSession({'pipeline.py': source}, timeout=RUN_TIMEOUT_SECONDS) as learner:
            module = learner.module()
            failures = []
            for name in phases:
                failures.extend(getattr(check_pipeline, name)(module, seed))
        return (False, _failure_message(failures)) if failures else (True, None)
    except (LearnerError, OSError, ValueError, TypeError, RecursionError):
        return False, "pipeline.py could not produce the required values within the execution limits"


def evaluate(checkpoint_id: str, submission: object) -> bool:
    """Boolean verdict for callers that need only pass/fail."""
    correct, _message = evaluate_with_message(checkpoint_id, submission)
    return correct


def evaluate_with_message(
    checkpoint_id: str, submission: object
) -> tuple[bool, str | None]:
    if checkpoint_id in CODE_CHECKPOINTS:
        # `transfer` runs under a derived seed, so its parameter sets, keys, lookup tables
        # and input bits are not the ones any other checkpoint used.
        seed = f"{SEED}:transfer" if checkpoint_id == "transfer" else SEED
        return _run_submission(submission, CODE_CHECKPOINTS[checkpoint_id], seed)
    return False, None

#: Checkpoints whose answer is typed rather than submitted as code. This problem has none
#: -- all eight run the learner's `pipeline.py` -- so nothing here requires the `tcw1.`
#: seal. The name exists so the rule below reads the same as it does in the problems that
#: do have one.
MANUAL_CHECKPOINTS: tuple[str, ...] = ()


def _b64decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def _unwrap_submission(checkpoint_id: str, submission: object) -> object:
    """Undo the Workbench's `tcw1.` seal and check it against this deployment.

    The derivation is duplicated from `participant/workbench.py`'s
    `PortalEditorSupport._seal_manual` rather than imported, because that module lives only
    in the participant image (see ../Dockerfile). Repeating it here rather than trusting an
    already-unwrapped value from the Workbench is what keeps the seal meaningful: a caller
    who skips the Workbench is judged by the same rule. Same shape as
    `ac26-w5-rgsw-external`'s verifier, for the same reason.

    This problem has no direct-answer checkpoint today, so an unsealed code submission
    passes through unchanged -- which is the format the Portal has always sent.
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
        parts = urlsplit(self.path)
        if parts.path == "/healthz":
            self._respond(200, {"ok": True})
            return
        if parts.path == "/public":
            # The public half of the deployment, and only that: the values `show.py` has
            # always printed. Issue 543's option B2 -- `fixtures/` does not ship in the
            # participant image, so this route is where `show.py` gets them from.
            # `fixtures.generate.public_payload` is the one place that decides what counts
            # as public; no checkpoint's expected value is derived there.
            #
            # `f` and `m` select which of the eight demonstration variants to compute,
            # because `make inspect F=... M=...` has always been able to ask for any of
            # them. `public_payload` normalises an unknown `f` back to `identity`, so a
            # malformed query returns the default view rather than an error.
            query = parse_qs(parts.query)
            function_name = (query.get("f") or ["identity"])[0]
            try:
                message = 1 if int((query.get("m") or ["1"])[0]) else 0
            except ValueError:
                message = 1
            self._respond(200, public_payload(SEED, function_name, message))
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
    port = int(os.environ.get("VERIFY_PORT", "18143"))
    # Bind every interface *inside the container*, not the container's loopback. The
    # Workbench reaches this process over the Compose-internal `lab` network, so a server
    # listening only on 127.0.0.1 inside the container accepts nothing from it — the
    # connection is opened and closed without a response, and the platform can never score
    # the problem.
    #
    # Since Issue 543's option B2 this service publishes no host port at all (see
    # ../docker-compose.yml): the only route to it is from the Workbench container.
    HTTPServer(("0.0.0.0", port), Handler).serve_forever()  # noqa: S104 - see above


if __name__ == "__main__":
    main()
