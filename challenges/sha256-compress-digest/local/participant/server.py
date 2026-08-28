"""Public Participant Workbench and fail-closed verifier proxy.

This process carries the given primitives, the starter and the public tests only. It
never grades a checkpoint locally: every `/verify` request is forwarded to the
Compose-internal verifier, and any missing or invalid verifier response becomes a
canonical `correct: false` verdict (see `proxy_verdict`).

Issue 543/537: the Portal editor API below used to live in `verifier/server.py`, in the
same Docker stage and process that also graded every checkpoint -- so what `avalanche`,
`properties` and `storage` compare against shipped in the one image a learner's own
`make build` produced, in `fixtures/generate.py`. Moving the comparison alone would not
have closed that: `avalanche_distance` was a plain function that only needed this
deployment's seed, and `PROPERTY_STATEMENTS` / `STORAGE_STATEMENTS` ship every
statement's correct verdict in plaintext, so they were the answer regardless of where
the `==` lived. `fixtures/` is not copied into this stage at all any more (see
../Dockerfile), and this deployment's public evidence -- the round/feedforward fixtures,
the avalanche message and bit, and the two quizzes' statement text -- is fetched from
the verifier's `GET /public` at runtime by `show.py` and
`tests/public/test_compress.py`, which is the only source for it here.
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
PROBLEM_ID = "sha256-compress-digest"
SEED = os.environ.get("FLAG_SEED", "local-dev-seed")
PORT = int(os.environ.get("WORKBENCH_PORT", "18091"))
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
    "round",
    "compress",
    "feedforward",
    "digest",
    "avalanche",
    "properties",
    "storage",
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
    problem_id='sha256-compress-digest',
    problem_name='SHA-256 その 3: 圧縮関数と digest、そしてパスワード保存',
    problem_name_en='SHA-256 part 3: the compression function, the digest, and password storage',
    description='1 round の T1 / T2、64 round、digest、そして「64 round は可逆で、最後の足し戻しだけが一方向性を作っている」ことを反例で確かめる。最後にハッシュ関数の性質とパスワード保存を問う。',
    description_en='T1 and T2 for one round, then 64 of them, then the digest — and a counterexample showing that the 64 rounds are invertible and only the final addition makes SHA-256 one-way. Ends with what you can and cannot claim about a hash, and how to store a password.',
    checkpoint_labels={'round': '1 round を実装する', 'compress': '64 round と足し戻しを実装する', 'feedforward': '64 round を逆にたどる', 'digest': 'SHA-256 を完成させる', 'avalanche': '1 bit の変化がどこまで広がるかを測る', 'properties': 'ハッシュ関数について何が言えるか', 'storage': 'パスワードをどう保存するか'},
    checkpoint_labels_en={'round': 'Implement one round', 'compress': 'Implement the 64 rounds and the feed-forward', 'feedforward': 'Walk the 64 rounds backwards', 'digest': 'Finish SHA-256', 'avalanche': 'Measure how far one bit reaches', 'properties': 'What can be claimed about a hash function', 'storage': 'How to store a password'},
    submitted_files=('compress.py',),
    code_checkpoints=('round', 'compress', 'feedforward', 'digest'),
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
    verdict: dict[str, object] = {"checkpointId": checkpoint_id, "correct": decoded["correct"]}
    message = decoded.get("message")
    if isinstance(message, str):
        verdict["message"] = message[:MAX_MESSAGE_CHARS]
    return verdict


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
        # The `tcw1.` seal is deliberately NOT undone here: the verifier repeats the
        # same HMAC derivation on its own side (see ../verifier/server.py), so an
        # avalanche/quiz answer that never went through `/api/prepare` is rejected even
        # by a caller who bypasses this process entirely.
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
