"""Public Participant Workbench and fail-closed verifier proxy.

This process carries the starter, the public tests, `show.py` and `fixtures/` — the
material the problem statement already hands the learner. It never grades a checkpoint
locally: every `/verify` request is forwarded to the Compose-internal verifier, and any
missing or invalid verifier response becomes a canonical `correct: false` verdict (see
`proxy_verdict`).

Issue 543/537: the Portal editor API below used to live in `verifier/server.py`, in the
same Docker stage and process that also ran the hidden suite — so `tests/hidden/
check_schnorr.py` shipped in the one image a learner's own `make build` produced. Every
one of this problem's eight checkpoints is graded by running that suite, so reading it
handed over what each checkpoint is about to assert. Two of the paid hints (`fiat-shamir`,
`serialization`) name a count the hidden phase's own call signature spells out, so the
hint penalty was avoidable by opening a file that shipped in the participant image.
`tests/hidden/` and `verifier/` are not copied into this stage at all any more (see
../Dockerfile).

`fixtures/` deliberately stays here, the same judgement `ac26-w1-underconstraint` made in
#567. It derives the deployment's *statement* — the toy group, the domains, and the
`"public"`-label secret and nonce the public tests sign with — not a graded value. The
hidden phases key their own secrets off different labels, `show.py` prints this material
already, and `tests/public/test_schnorr.py` imports it directly, so removing it would hide
the question rather than the answer.
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
PROBLEM_ID = "ac26-w3-schnorr"
SEED = os.environ.get("FLAG_SEED", "local-dev-seed")
PORT = int(os.environ.get("WORKBENCH_PORT", "18102"))
VERIFIER_URL = os.environ.get("VERIFIER_URL", "")

MAX_BODY_BYTES = 256 * 1024
RUN_TIMEOUT_SECONDS = 30
MAX_ADDRESS_SPACE_BYTES = 512 * 1024 * 1024
MAX_PROCESSES = 64
MAX_OUTPUT_BYTES = 64 * 1024
REQUEST_TIMEOUT_SECONDS = 15

CHECKPOINTS = (
    "keygen",
    "sigma",
    "transcript",
    "serialization",
    "fiat-shamir",
    "sign-verify",
    "cross-protocol",
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
    problem_id='ac26-w3-schnorr',
    problem_name='何をハッシュに入れ忘れたか',
    problem_name_en='What did you leave out of the hash',
    description='Sigma protocol を対話的に走らせ、Fiat-Shamir で署名へ変換する。ハッシュに入れ忘れたものは 1 つも守られない。domain separator を落とすと、1 つの署名が 2 つのプロトコルで通る。',
    description_en='Run a Sigma protocol interactively, then turn it into a signature with Fiat-Shamir. Whatever you leave out of the hash is not protected — drop the domain separator and one signature is valid under two protocols at once.',
    checkpoint_labels={'keygen': '鍵を作り、使えない鍵を断る', 'sigma': '3 手を実装する', 'transcript': '検証式の両辺を突き合わせる', 'serialization': '一意な符号化を書く', 'fiat-shamir': 'challenge を transcript から作る', 'sign-verify': '署名して検証する', 'cross-protocol': 'domain を落とすと何が起きるか示す', 'transfer': '実運用パラメータでも動かす'},
    checkpoint_labels_en={'keygen': 'Make a key, and refuse an unusable one', 'sigma': 'Implement the three moves', 'transcript': 'Check both sides of the equation', 'serialization': 'Write an encoding with one reading', 'fiat-shamir': 'Derive the challenge from the transcript', 'sign-verify': 'Sign and verify', 'cross-protocol': 'Show what dropping the domain costs', 'transfer': 'Run it on real parameters'},
    submitted_files=('schnorr.py',),
    code_checkpoints=('keygen', 'sigma', 'transcript', 'serialization', 'fiat-shamir', 'sign-verify', 'cross-protocol', 'transfer'),
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
        # The submission is forwarded exactly as it arrived. Unwrapping happens on the
        # verifier's side (see ../verifier/server.py), so a caller who bypasses this
        # process entirely is judged by the same rule as one who does not.
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
