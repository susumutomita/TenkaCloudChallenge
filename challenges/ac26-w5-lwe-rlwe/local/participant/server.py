"""Public Participant Workbench and fail-closed verifier proxy.

This process carries public evidence, starter material, the deliberately-wrong product
and the public tests -- and nothing that grades. Every `/verify` request is forwarded to
the Compose-internal verifier, and any missing or invalid verifier response becomes a
canonical `correct: false` verdict.

Issue 543/537: the Portal editor API below used to live in `verifier/server.py`, in the
single Docker stage a learner's own `make build` produced -- the same image that carried
`tests/hidden/check_lwe.py` and the process that runs it. All eight checkpoints are
graded by running that suite against the submitted file, so the person being graded
could read the assertions. Option B2 took `fixtures/` out of this stage as well: it has
to define working `normalize`, `ring_mul`, `lwe_encrypt`, `lwe_decrypt`, `rlwe_encrypt`,
`rlwe_decrypt`, `encode`, `decode` and `centered` to derive a deployment's fixtures, and
those are the names `starter/lwe.py` asks the learner to write. `show.py` and the public
tests read this deployment's public half from the verifier's `GET /public` instead (see
show.py, tests/public/test_lwe.py, and the VERIFIER_PUBLIC_URL wiring in
../docker-compose.yml).
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
PROBLEM_ID = "ac26-w5-lwe-rlwe"
SEED = os.environ.get("FLAG_SEED", "local-dev-seed")
PORT = int(os.environ.get("WORKBENCH_PORT", "18108"))
VERIFIER_URL = os.environ.get("VERIFIER_URL", "")

MAX_BODY_BYTES = 256 * 1024
RUN_TIMEOUT_SECONDS = 30
MAX_ADDRESS_SPACE_BYTES = 512 * 1024 * 1024
MAX_PROCESSES = 64
MAX_OUTPUT_BYTES = 64 * 1024
REQUEST_TIMEOUT_SECONDS = 15
#: Cap for a forwarded verdict message; matches the platform schema's limit.
MAX_MESSAGE_CHARS = 2000

CHECKPOINTS = (
    "normalize",
    "ring",
    "lwe",
    "rlwe",
    "correspondence",
    "boundary",
    "transfer",
    "defense",
)


# Darwin aliases RLIMIT_AS onto RLIMIT_RSS and refuses to set it, while still
# reporting RLIM_INFINITY for it. Setting it anyway raises inside `preexec_fn`, which
# aborts the exec -- so on a macOS checkout every child run failed. The lab runs on
# Linux, where the cap does apply.
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
    problem_id='ac26-w5-lwe-rlwe',
    problem_name='符号 1 つと、その下流すべて',
    problem_name_en='One sign, and everything downstream',
    description='LWE と RLWE は同じ形で算術だけが違う。 X^N = -1 の符号 1 つが negacyclic と cyclic を分け、cyclic な環も立派な環なので自分の往復テストは全部通る。だから往復を交差させる。',
    description_en='LWE and RLWE have the same shape and different arithmetic. The single sign in X^N = -1 separates negacyclic from cyclic — and a cyclic ring is a perfectly good ring, so it passes every test you write yourself. Which is why the round trips are crossed.',
    checkpoint_labels={'normalize': '環の元へ畳む', 'ring': 'negacyclic に掛ける', 'lwe': 'ベクトルの秘密で暗号化する', 'rlwe': '多項式の秘密で暗号化する', 'correspondence': '2 つを並べて違いを名指す', 'boundary': '予算を越える最初の 1 つ', 'transfer': '見たことのない環で成立させる', 'defense': '壊れた暗号文を断る'},
    checkpoint_labels_en={'normalize': 'Fold into a ring element', 'ring': 'Multiply negacyclically', 'lwe': 'Encrypt under a vector secret', 'rlwe': 'Encrypt under a polynomial secret', 'correspondence': 'Put them side by side and name the difference', 'boundary': 'The first one out of budget', 'transfer': 'Hold up in a ring you have not seen', 'defense': 'Refuse a broken ciphertext'},
    submitted_files=('lwe.py',),
    code_checkpoints=('normalize', 'ring', 'lwe', 'rlwe', 'correspondence', 'boundary', 'transfer', 'defense'),
    checkpoints=('normalize', 'ring', 'lwe', 'rlwe', 'correspondence', 'boundary', 'transfer', 'defense'),
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
    verdict: dict[str, object] = {"checkpointId": checkpoint_id, "correct": decoded["correct"]}
    message = decoded.get("message")
    if isinstance(message, str):
        verdict["message"] = message[:MAX_MESSAGE_CHARS]
    return verdict


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
    # Host reachability is restricted by docker-compose.yml to the loopback publish.
    HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()  # noqa: S104


if __name__ == "__main__":
    main()
