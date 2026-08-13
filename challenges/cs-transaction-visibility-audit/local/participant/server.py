"""Public Participant Portal Workbench and fail-closed verifier proxy.

This process carries public evidence, starter material, and public tests only.  It
never grades a checkpoint locally: every ``/verify`` request is forwarded to the
Compose-internal verifier, and any missing or invalid verifier response becomes a
canonical ``correct: false`` verdict.
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

import show
from participant.workbench import PortalEditorSupport

ROOT = Path(__file__).resolve().parents[1]
PROBLEM_ID = "cs-transaction-visibility-audit"
SEED = os.environ.get("FLAG_SEED", "local-dev-seed")
PORT = int(os.environ.get("WORKBENCH_PORT", "18320"))
VERIFIER_URL = os.environ.get("VERIFIER_URL", "")

MAX_BODY_BYTES = 256 * 1024
RUN_TIMEOUT_SECONDS = 10
MAX_ADDRESS_SPACE_BYTES = 512 * 1024 * 1024
MAX_PROCESSES = 64
MAX_OUTPUT_BYTES = 64 * 1024
REQUEST_TIMEOUT_SECONDS = 15

CHECKPOINTS = ("audit", "counterexample", "snapshot", "transfer")
CODE_CHECKPOINTS = ("snapshot", "transfer")


def _limits() -> None:
    if sys.platform.startswith("linux"):
        resource.setrlimit(resource.RLIMIT_AS, (MAX_ADDRESS_SPACE_BYTES, MAX_ADDRESS_SPACE_BYTES))
    resource.setrlimit(resource.RLIMIT_NPROC, (MAX_PROCESSES, MAX_PROCESSES))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_OUTPUT_BYTES, MAX_OUTPUT_BYTES))


_WORKBENCH = PortalEditorSupport(
    root=ROOT,
    seed=SEED,
    problem_id=PROBLEM_ID,
    problem_name="どちらも committed。だが、その合計は一度も存在しない",
    problem_name_en="Both reads were committed. The total never existed",
    description="ポイント台帳の各 read は、その瞬間の committed 値を返している。公開テストも緑。それでも複数口座を束ねた report は、一度も存在しなかった合計を返せる。seed 固有の監査ログから反例を組み立て、1 revision の snapshot で report を直す。",
    description_en="Every account read returns a committed value and the public tests are green. A multi-account report can still return a total that never existed. Audit seed-derived traces, construct the counterexample, and bind the report to one immutable snapshot revision.",
    checkpoint_labels={
        "audit": "audit — 一度も存在しない report と観測 revision を特定する",
        "counterexample": "counterexample — read の途中へ 1 commit を置き、反例を作る",
        "snapshot": "snapshot — report の全 row と revision を 1 つの view に固定する",
        "transfer": "transfer — 未見の ID・順序・複数 commit でも同じ性質を保つ",
    },
    checkpoint_labels_en={
        "audit": "audit - name the report that never existed and its observed revisions",
        "counterexample": "counterexample - place one commit inside the reads and build the failure",
        "snapshot": "snapshot - bind every row and the revision to one view",
        "transfer": "transfer - keep the property for unseen IDs, orders, and commits",
    },
    submitted_files=("report.py",),
    code_checkpoints=CODE_CHECKPOINTS,
    checkpoints=CHECKPOINTS,
    max_body_bytes=MAX_BODY_BYTES,
    run_timeout_seconds=RUN_TIMEOUT_SECONDS,
    max_output_bytes=MAX_OUTPUT_BYTES,
    limit_fn=_limits,
)


def inspect_payload(seed: str) -> dict[str, object]:
    """Structured evidence, rather than the shared workbench's stdout capture.

    `PortalEditorSupport.inspect_payload` runs `show.py` and returns its text as one
    `output` string. That is fine for a problem whose inspect view is a transcript, but
    here it left the browser with an English-only blob it could not render as evidence
    and could not localize. Calling `show.evidence` directly keeps the two surfaces
    identical -- `scripts/cs-foundations-evidence.test.ts` asserts exactly that -- while
    giving the Portal the same JSON the rest of cs-foundations serves.
    """
    return show.evidence(seed)


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
            self._respond(200, inspect_payload(SEED))
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
