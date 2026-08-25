"""Public Participant Workbench and fail-closed verifier proxy.

This process carries public evidence, starter material, and public tests only. It
never grades a checkpoint locally: every `/verify` request is forwarded to the
Compose-internal verifier, and any missing or invalid verifier response becomes a
canonical `correct: false` verdict.

Issue 543/537: the Portal editor API below used to live in `verifier/server.py`, in the
same Docker stage and process that also compared a submission against this
deployment's expected values -- so the expected-value derivation (then a plain function
in `fixtures/generate.py`) shipped in the one image a learner's own `make build`
produced. That grading logic and its `verifier/expected.py` import now live only in the
separate `verifier` image (see ../Dockerfile), which this container never builds and
cannot import from.
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
PROBLEM_ID = "ac26-w3-schnorr-drill"
SEED = os.environ.get("FLAG_SEED", "local-dev-seed")
PORT = int(os.environ.get("WORKBENCH_PORT", "18132"))
VERIFIER_URL = os.environ.get("VERIFIER_URL", "")

MAX_BODY_BYTES = 256 * 1024
RUN_TIMEOUT_SECONDS = 20
MAX_ADDRESS_SPACE_BYTES = 512 * 1024 * 1024
MAX_PROCESSES = 64
MAX_OUTPUT_BYTES = 64 * 1024
REQUEST_TIMEOUT_SECONDS = 15

#: No checkpoint of this drill routes a learner's file through code execution; every
#: graded line is a pasted value. `code_checkpoints=()` below tells the Workbench
#: adapter every checkpoint is manual, so `prepare_submissions` seals every one of them
#: the same way.
CHECKPOINTS = (
    "field-inv",
    "add-points",
    "double",
    "order",
    "response",
    "verify",
    "nonce-reuse",
    "transfer",
)


def _limits() -> None:
    if sys.platform.startswith("linux"):
        resource.setrlimit(resource.RLIMIT_AS, (MAX_ADDRESS_SPACE_BYTES, MAX_ADDRESS_SPACE_BYTES))
    resource.setrlimit(resource.RLIMIT_NPROC, (MAX_PROCESSES, MAX_PROCESSES))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_OUTPUT_BYTES, MAX_OUTPUT_BYTES))


# BEGIN GENERATED PORTAL EDITOR API
_WORKBENCH = PortalEditorSupport(
    root=ROOT,
    seed=SEED,
    problem_id='ac26-w3-schnorr-drill',
    problem_name='ec_add は、4 行の計算に場合分けを足しただけ',
    problem_name_en='ec_add is four lines of arithmetic plus the cases',
    description='手元の Python で 1 行打って、出た値を貼る。12 行で、有限体の逆元 → 曲線の足し算 → 位数 → 公開鍵 → Schnorr の 3 手 → 検証式 → nonce 再利用で秘密が出る → 別の曲線、を自分の手で出した数だけで通す。',
    description_en="Type one line in your own Python, paste the value it prints. Twelve lines: the field inverse → point addition → the order → the public key → Schnorr's three moves → the check → the secret falls out of a reused nonce → another curve — on numbers you produced yourself.",
    checkpoint_labels={'field-inv': '逆元 — 掛けて 1 になる相手', 'add-points': '3 つ目の交点を折り返す = G + Q', 'double': '同じ点を 2 回 = 接線', 'order': '一周して O に戻るまでの回数 = 位数 n', 'response': '手 3: レスポンス s = r + e·x (mod n)', 'verify': '検証式 s·G = R + e·P', 'nonce-reuse': 'nonce を使い回した鍵から秘密を取り出す', 'transfer': '別の曲線で同じ 12 行 — s を出す'},
    checkpoint_labels_en={'field-inv': 'The inverse — the partner that multiplies to 1', 'add-points': 'Reflect the third intersection = G + Q', 'double': 'The same point twice = tangent', 'order': 'How many steps until O = the order n', 'response': 'Move 3: response s = r + e·x (mod n)', 'verify': 'The check s·G = R + e·P', 'nonce-reuse': 'Extract the secret from a key that reused its nonce', 'transfer': 'The same 12 lines on another curve — produce s'},
    submitted_files=('schnorr_drill.py',),
    code_checkpoints=(),
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
    timeout = REQUEST_TIMEOUT_SECONDS

    def do_GET(self) -> None:  # noqa: N802 - stdlib handler API
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

    def do_POST(self) -> None:  # noqa: N802 - stdlib handler API
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
        """Do not echo submissions into the access log."""

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
