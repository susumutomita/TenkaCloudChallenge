"""Public Participant Workbench and fail-closed verifier proxy.

This process carries starter material and public tests only. It never grades a
checkpoint locally: every `/verify` request is forwarded to the Compose-internal
verifier, and any missing or invalid verifier response becomes a canonical
`correct: false` verdict.

Issue 537/543 (option B2): this problem's `fixtures/generate.py` computes the ten
lines' expected values inside `setting(seed)`, next to the public numbers, so the
module does not ship in this image at all. The inspect output and the public tests
read this deployment's public half from the verifier's `GET /public` over the
Compose-internal network instead (see participant/evidence.py and ../Dockerfile).
"""

from __future__ import annotations

import json
import os
import resource
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, urlunsplit
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from participant.workbench import PortalEditorSupport
from participant.isolation import block_network, protect_supervisor

ROOT = Path(__file__).resolve().parents[1]
PROBLEM_ID = "ac26-bridge-unknown-x"
PORT = int(os.environ.get("WORKBENCH_PORT", "18140"))
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
    "covered",
    "sum-covered",
    "huge",
    "held",
    "recover",
    "guesses",
    "gap",
    "product",
)


def _limits() -> None:
    block_network()
    if sys.platform.startswith("linux"):
        resource.setrlimit(resource.RLIMIT_AS, (MAX_ADDRESS_SPACE_BYTES, MAX_ADDRESS_SPACE_BYTES))
    resource.setrlimit(resource.RLIMIT_NPROC, (MAX_PROCESSES, MAX_PROCESSES))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_OUTPUT_BYTES, MAX_OUTPUT_BYTES))


# BEGIN GENERATED PORTAL EDITOR API
_WORKBENCH = PortalEditorSupport(
    root=ROOT,
    seed=None,
    problem_id='ac26-bridge-unknown-x',
    problem_name='x を知らないまま、足し算が済む',
    problem_name_en='The addition finishes without ever knowing x',
    description='覆った 2 数を足す役と、覆いを外す役を比べます。紙か Portal のエディタで計算し、8 欄を提出。後半は候補の数え上げ、同じ覆いが漏らす差、積に残る項を調べます。',
    description_en='Compare adding covered numbers with removing their cover. Calculate on paper or in the Portal editor and submit eight answers, then investigate candidates, the difference a reused cover reveals, and extra terms in a product.',
    checkpoint_labels={'covered': 'covered — 覆いをかぶせる', 'sum-covered': 'sum-covered — 覆ったまま足す', 'huge': 'huge — 大きい覆いでも式は同じか', 'held': 'held — 返事と覆いの総量', 'recover': 'recover — 元の合計を受け取る', 'guesses': 'guesses — 生き残る候補を数える', 'gap': 'gap — 同じ覆いが漏らす差', 'product': 'product — 積と残る項を調べる'},
    checkpoint_labels_en={'covered': 'covered — Put on the cover', 'sum-covered': 'sum-covered — Add the covered numbers', 'gap': 'gap — The difference a shared cover leaks', 'huge': 'huge — Compare with a large cover', 'held': 'held — The reply and total cover', 'recover': 'recover — Recover the original sum', 'guesses': 'guesses — Count surviving candidates', 'product': 'product — Examine the product and leftover'},
    submitted_files=('unknown_x_drill.py',),
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


def load_public_snapshot() -> dict[str, object]:
    """Trusted supervisor fetch; learner subprocesses receive only these public fields."""
    url = os.environ.get("VERIFIER_PUBLIC_URL")
    if not url:
        raise RuntimeError("VERIFIER_PUBLIC_URL is required")
    with urlopen(url, timeout=REQUEST_TIMEOUT_SECONDS) as response:
        raw = response.read(MAX_BODY_BYTES + 1)
    if len(raw) > MAX_BODY_BYTES:
        raise RuntimeError("public evidence exceeds the size limit")
    payload = json.loads(raw)
    if not isinstance(payload, dict) or not isinstance(payload.get("public"), dict):
        raise RuntimeError("invalid public evidence")
    return {key: payload[key] for key in ("public", "assignments")}


def load_sealing_key() -> bytes:
    """Fetch only the derived key from the unpublished verifier, before serving learners."""
    target = urlsplit(VERIFIER_URL)
    if target.scheme not in ("http", "https") or not target.netloc:
        raise RuntimeError("VERIFIER_URL is required")
    # Fixed internal path: participant request paths and query strings never flow here.
    url = urlunsplit((target.scheme, target.netloc, "/workbench-key", "", ""))
    with urlopen(url, timeout=REQUEST_TIMEOUT_SECONDS) as response:
        raw = response.read(1025)
    if len(raw) > 1024:
        raise RuntimeError("invalid workbench key response")
    payload = json.loads(raw)
    value = payload.get("key") if isinstance(payload, dict) else None
    if not isinstance(value, str) or len(value) != 64:
        raise RuntimeError("invalid workbench key response")
    try:
        key = bytes.fromhex(value)
    except ValueError:
        raise RuntimeError("invalid workbench key response") from None
    if len(key) != 32:
        raise RuntimeError("invalid workbench key response")
    return key


def main() -> None:
    protect_supervisor()
    _WORKBENCH.sealing_key = load_sealing_key()
    _WORKBENCH.public_payload = load_public_snapshot()
    # Host reachability is restricted by docker-compose.yml to the loopback publish.
    HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()  # noqa: S104


if __name__ == "__main__":
    main()
