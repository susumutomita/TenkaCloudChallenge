"""Public Participant Workbench and fail-closed verifier proxy.

This process carries public evidence, starter material, the supplied key derivation and
the public tests -- and nothing that grades. Every `/verify` request is forwarded to the
Compose-internal verifier, and any missing or invalid verifier response becomes a
canonical `correct: false` verdict (see `proxy_verdict`).

Issue 537/538 (Issue 543 option B2): the Portal editor API below used to live in
`verifier/server.py`, in the single Docker stage a learner's own `make build` produced
-- the same image that carried `tests/hidden/check_oblivious.py` and the process that
runs it. All six checkpoints are graded by running that suite against the submitted
file, so the person being graded could read the assertions, including the two the whole
problem is about: `check_receiver_privacy`, which states the condition on the blind's
range, and `check_gate_privacy`, which states that the gate's two transfers must be
independently masked. `fixtures/generate.py` left this stage too. `show.py` and the
public tests read this deployment's public half -- the group, the sender's key, the
session on offer and the gate's share layout -- from the verifier's `GET /public`
instead (see show.py and tests/public/test_oblivious.py, and the VERIFIER_PUBLIC_URL
wiring in ../docker-compose.yml).
"""

from __future__ import annotations

import json
import os
import resource
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from participant.workbench import PortalEditorSupport

ROOT = Path(__file__).resolve().parents[1]
PROBLEM_ID = "ac26-w2-oblivious-transfer"
SEED = os.environ.get("FLAG_SEED", "local-dev-seed")
PORT = int(os.environ.get("WORKBENCH_PORT", "18310"))
VERIFIER_URL = os.environ.get("VERIFIER_URL", "")

MAX_BODY_BYTES = 256 * 1024
RUN_TIMEOUT_SECONDS = 20
MAX_ADDRESS_SPACE_BYTES = 512 * 1024 * 1024
MAX_PROCESSES = 64
MAX_OUTPUT_BYTES = 64 * 1024
#: Wall clock for reading a request body, so a stalled client cannot pin the server.
REQUEST_TIMEOUT_SECONDS = 15

#: The Portal's checkpoint list, in display order. Kept here rather than only inside the
#: generated block below because scripts/verify-course-workbenches.py probes for it, and
#: because nothing in this process may decide a checkpoint -- this is a list of names,
#: not a grading table. The verifier keeps its own copy (see ../verifier/server.py).
CHECKPOINTS = ("request", "choice-privacy", "transfer", "and-gate", "gate-privacy", "unseen")


# Darwin aliases RLIMIT_AS onto RLIMIT_RSS and refuses to set it, while still reporting
# RLIM_INFINITY for it. Setting it anyway raises inside `preexec_fn` and aborts the exec,
# so on a macOS checkout every child run failed. The lab runs on Linux, where the cap does
# apply, so skipping it on Darwin does not change what participants run.
_ADDRESS_SPACE_CAPPABLE = sys.platform.startswith("linux")


def _limits() -> None:
    if _ADDRESS_SPACE_CAPPABLE:
        resource.setrlimit(resource.RLIMIT_AS, (MAX_ADDRESS_SPACE_BYTES, MAX_ADDRESS_SPACE_BYTES))
    resource.setrlimit(resource.RLIMIT_NPROC, (MAX_PROCESSES, MAX_PROCESSES))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_OUTPUT_BYTES, MAX_OUTPUT_BYTES))


# BEGIN GENERATED PORTAL EDITOR API
_WORKBENCH = PortalEditorSupport(
    root=ROOT,
    seed=SEED,
    problem_id='ac26-w2-oblivious-transfer',
    problem_name='選んだことを言わずに、選ぶ',
    problem_name_en='Choosing without saying which',
    description='公式 Week 2 Part B の oblivious transfer と GMW secret AND を 1 つの問題で組む。正しく動くことと、相手に秘密を渡さないことを別々に確かめる。',
    description_en='Build the official Week 2 Part B topics — oblivious transfer and a GMW secret AND — in one problem, and test correctness separately from whether either party learns a secret.',
    checkpoint_labels={'request': 'choice を隠した request を作る', 'choice-privacy': 'choice が request から読めない範囲を選ぶ', 'transfer': '片方だけを渡す', 'and-gate': '転送 2 回で AND を作る', 'gate-privacy': 'ゲートが相手の秘密を渡さないようにする', 'unseen': '見たことのない群でも成立させる'},
    checkpoint_labels_en={'request': 'Build a request that hides the choice', 'choice-privacy': 'Pick a range that keeps the choice unreadable', 'transfer': 'Hand over exactly one of the two', 'and-gate': 'Build AND from two transfers', 'gate-privacy': "Stop the gate handing over the other party's secret", 'unseen': 'Hold up in groups you have not seen'},
    submitted_files=('oblivious.py',),
    code_checkpoints=CHECKPOINTS,
    checkpoints=CHECKPOINTS,
    max_body_bytes=MAX_BODY_BYTES,
    run_timeout_seconds=RUN_TIMEOUT_SECONDS,
    max_output_bytes=MAX_OUTPUT_BYTES,
    limit_fn=_limits,
)
# END GENERATED PORTAL EDITOR API


def failed_verdict(body: dict[str, object]) -> dict[str, object]:
    checkpoint_id = body.get("checkpointId")
    return {
        "checkpointId": checkpoint_id if isinstance(checkpoint_id, str) else "",
        "correct": False,
    }


def proxy_verdict(
    body: dict[str, object],
    verifier_url: str = VERIFIER_URL,
) -> dict[str, object]:
    if not verifier_url:
        return failed_verdict(body)
    payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
    request = Request(
        verifier_url,
        data=payload,
        headers={"content-type": "application/json"},
        method="POST",
    )
    try:
        # VERIFIER_URL is a trusted Compose-only environment value.
        with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:  # noqa: S310
            response_body = response.read(MAX_BODY_BYTES + 1)
            if len(response_body) > MAX_BODY_BYTES:
                return failed_verdict(body)
            decoded = json.loads(response_body.decode("utf-8"))
    except (
        HTTPError,
        URLError,
        TimeoutError,
        OSError,
        ValueError,
        UnicodeDecodeError,
        json.JSONDecodeError,
    ):
        return failed_verdict(body)

    checkpoint_id = body.get("checkpointId")
    if (
        not isinstance(decoded, dict)
        or not isinstance(checkpoint_id, str)
        or decoded.get("checkpointId") != checkpoint_id
        or type(decoded.get("correct")) is not bool
    ):
        return failed_verdict(body)
    return {"checkpointId": checkpoint_id, "correct": decoded["correct"]}


class Handler(BaseHTTPRequestHandler):
    """Serve the Portal editor API and forward /verify inward.

    Nothing here decides a checkpoint. The grading process runs in the image that
    carries `fixtures/` and `tests/hidden/`, which this container never builds.
    """

    timeout = REQUEST_TIMEOUT_SECONDS

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler's API
        path = urlsplit(self.path).path
        if path == "/api/config":
            self._respond(200, _WORKBENCH.config_payload())
            return
        if path == "/api/inspect":
            self._respond(200, _WORKBENCH.inspect_payload())
            return
        if path == "/api/starter":
            self._respond(200, _WORKBENCH.starter_payload())
            return
        if path == "/healthz":
            self._respond(200, {"ok": True})
            return
        self._respond(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler's API
        path = urlsplit(self.path).path.rstrip("/") or "/"
        if path not in ("/verify", "/api/test", "/api/prepare"):
            self._respond(404, {"error": "not found"})
            return
        body = self._read_json_body()
        if body is None:
            return
        if path == "/api/test":
            self._respond(200, _WORKBENCH.run_public_tests(body.get("files")))
            return
        if path == "/api/prepare":
            self._respond(
                200,
                _WORKBENCH.prepare_submissions(body.get("files"), body.get("manual")),
            )
            return
        self._respond(200, proxy_verdict(body))

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
        content = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
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
    # Bind every interface *inside the container*, not the container's loopback. A published
    # port is forwarded to the container's bridge address, so a server listening only on
    # 127.0.0.1 inside the container accepts nothing from outside it.
    #
    # The loopback restriction that matters is on the host, and it lives in
    # docker-compose.yml, which publishes `127.0.0.1:<port>:<port>`.
    HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()  # noqa: S104 - see above


if __name__ == "__main__":
    main()
