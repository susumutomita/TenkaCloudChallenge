"""POST /verify — the scoring seam. Compose-internal only, stdlib only.

Issue 537/538 (Issue 543 option B2): this used to be the same process that also served the
Participant Portal's config, inspect, starter, public-test and prepare endpoints, in the single
Docker stage a learner's own `make build` produced -- so `fixtures/generate.py` and
`tests/hidden/check_stack.py` shipped in the learner's own image alongside it.
`fixtures/generate.py` holds this problem's entire ground truth under other names: `constrained`
is `carried`, `underwritten` is `underwrites`, `load_bearing` is `property_map`, `violations` is
`contract_violations`, `first_broken` is `first_failure`, `selection_truth` is `select`, and
`_one_change_neighbours` with `local_checks_pass`, `properties_at_risk` and `_whole` is the whole
search `counterexample` and `repair` are graded on. It also holds `BREAKS`, which names -- per
variant, and identically on every seed, the hidden labels included -- which node or edge each
deployment broke and which attribute it changed. A submission transcribed from that one shipped
file, with no reasoning past copying, scored 8 of 8 checkpoints (300 of 300 points).

That Portal-facing surface now lives in `participant/server.py`, in a separate image (see
../Dockerfile) that this process's own container never builds; this file, `fixtures/` and
`tests/hidden/` are reachable only over the Compose-internal network (see
../docker-compose.yml), never from the participant container's filesystem.

`GET /public` below is what the participant image reads instead of importing
`fixtures.generate`.

Security contract (docs/curricula/advanced-cryptography-2026/TEMPLATE.md §/verify):
  - `checkpointId` is required and is echoed back verbatim. The platform fails closed
    on a missing or mismatched echo, so it can never credit another checkpoint.
  - The parent owns the hidden checker and final verdict. Restricted workers return
    typed values and permitted API requests, never an authoritative score.
  - Learner code runs in a subprocess with a wall-clock timeout, a memory cap, and a
    capped output size. A hang, a fork bomb, or a gigabyte of prints fails the
    checkpoint instead of the verifier.
  - No learner input is ever concatenated into a shell command; the subprocess is
    invoked with an argument list and `shell=False`.
  - Responses carry `checkpointId`, `correct` and, on a failed code checkpoint, a
    `message` summarizing the checker's property-level failures (Issue 630). Never
    the hidden test names, the expected values, or reference output.
  - Malformed input produces a failed checkpoint, never a crashed process.
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

from participant.execution import LearnerError, LearnerSession
from tests.hidden import check_stack
from fixtures.generate import public_payload  # noqa: E402 - after the sys.path insert above

ROOT = Path(__file__).resolve().parents[1]
SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


#: Mirrors `participant/workbench.py`'s `PortalEditorSupport` problem id: the seal key is
#: derived from it and this deployment's seed, so a submission sealed for another
#: problem or another deployment never unwraps here.
PROBLEM_ID = "ac26-w6-stack-design"
#: Every checkpoint here is a code checkpoint. Kept as a tuple so the unwrap rule below
#: stays the shape of ac26-w4-commit-open's, which does have manual ones.
MANUAL_CHECKPOINTS: tuple[str, ...] = ()


def _b64decode(text: str) -> bytes:
    padding = "=" * (-len(text) % 4)
    return base64.urlsafe_b64decode(text + padding)


def _unwrap_submission(checkpoint_id: str, submission: object) -> object:
    """Undo the Workbench's `tcw1.` seal and check it against this deployment.

    `participant/workbench.py`'s `prepare_submissions` seals every code checkpoint's
    source with an HMAC over (problem id, seed), and the Portal forwards that sealed
    string to `/verify` unchanged. Until this function existed, this verifier wrote the
    sealed string itself to the submission file and every submission -- the unedited
    starter included -- failed with "could not be imported: NameError". Found by a
    firewalled playtest that could only see what a participant sees.

    The derivation is duplicated from `PortalEditorSupport._seal_manual` rather than
    imported, because that module lives only in the participant image. An unsealed
    code submission still passes through unchanged, which is the format `/verify`
    accepted before the Workbench sealed anything.
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
    answer = decoded.get("answer")
    # More than one editable file is sealed as one JSON object of file name to source.
    if isinstance(answer, str) and answer.lstrip().startswith("{"):
        try:
            parsed = json.loads(answer)
        except json.JSONDecodeError:
            return answer
        if isinstance(parsed, dict):
            return parsed
    return answer

MAX_BODY_BYTES = 256 * 1024
RUN_TIMEOUT_SECONDS = 12
#: Cap for the verdict's optional human-readable failure summary. Kept under the
#: platform's 2000-character message limit with room to spare.
MAX_MESSAGE_CHARS = 1900
#: Wall clock for reading a request body, so a stalled client cannot pin the server.
REQUEST_TIMEOUT_SECONDS = 15

# Nine hidden phases behind eight scored checkpoints.
#
# The multi-verify contract caps a problem at eight checks, catalog-side in SCHEMA.json and
# again in the platform's `packages/problem-sdk/src/scoring-metadata/multi-verify.ts`, which
# drops the whole scoring object rather than truncating it -- a ninth check would take the other
# eight down with it and leave the problem unscorable. Issue #244 asks for nine things, so two
# of them share a checkpoint.
#
# `dataflow` is the pair, and they are paired for a reason rather than because they were
# adjacent on the list: reading what each wire is carrying and knowing where the primitive's
# guarantee stops are the same act of reading the typed graph. Everything else is one phase to
# one checkpoint.
CODE_CHECKPOINTS = {
    "dataflow": ("check_flow", "check_layers"),
    "properties": ("check_properties",),
    "contracts": ("check_contracts",),
    "diagnosis": ("check_first_failure",),
    "counterexample": ("check_counterexample",),
    "repair": ("check_repair",),
    "selection": ("check_selection",),
    "transfer": ("check_transfer",),
}
CHECKPOINTS = tuple(CODE_CHECKPOINTS)


# Darwin aliases RLIMIT_AS onto RLIMIT_RSS and refuses to set it, while still
# reporting RLIM_INFINITY for it. Setting it anyway raises inside `preexec_fn`, which
# aborts the exec -- so on a macOS checkout every submission run failed, including the
# reference. The lab runs on Linux, where the cap does apply, so skipping it on Darwin
# does not change what participants run.


def _failure_message(failures: list[object]) -> str | None:
    """Join the hidden checker's failure list into one participant-facing message.

    Only checker-authored strings are kept: anything else that ends up in the list
    is dropped rather than serialized, so a checker bug cannot push raw values
    through the message field.
    """
    text = "; ".join(dict.fromkeys(item for item in failures if isinstance(item, str)))
    return text[:MAX_MESSAGE_CHARS] if text else None


def _run_submission(submission: object, phases: tuple[str, ...], seed: str) -> tuple[bool, str | None]:
    source = submission.get('stack.py') if isinstance(submission, dict) else submission
    if not isinstance(source, str) or not source.strip() or len(source) > MAX_BODY_BYTES:
        return False, None
    try:
        with LearnerSession({'stack.py': source}, timeout=RUN_TIMEOUT_SECONDS) as learner:
            module = learner.module()
            failures = []
            if phases:
                for name in phases:
                    failures.extend(getattr(check_stack, name)(module, seed))
            else:
                failures = check_stack.run(module, seed)
    except (LearnerError, OSError, ValueError, TypeError, RecursionError):
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
        # `transfer` derives its own seed inside the checker, so the field each case works in,
        # the statement a proof is about, the program a journal names and the six briefs are
        # none of the ones the other seven checkpoints used.
        return _run_submission(submission, CODE_CHECKPOINTS[checkpoint_id], SEED)
    return False, None


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
    port = int(os.environ.get("VERIFY_PORT", "18162"))
    # Bind every interface *inside the container*, not the container's loopback. This service is
    # reached by the Workbench container over the Compose-internal `lab` network, so a server
    # listening only on 127.0.0.1 inside the container would accept nothing from it — the
    # connection is opened and closed without a response, and the platform can never score the
    # problem.
    #
    # Nothing publishes this port. docker-compose.yml puts this service on an `internal: true`
    # network with no host publish at all, so it is unreachable from the host and from the
    # outside world alike; the Workbench is the only client it has.
    HTTPServer(("0.0.0.0", port), Handler).serve_forever()  # noqa: S104 - see above


if __name__ == "__main__":
    main()
