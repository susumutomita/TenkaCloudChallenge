"""Public Participant Workbench and fail-closed verifier proxy.

This process carries the starter, the public tests, the supplied Week 5 stack and
`show.py` -- and nothing that grades. Every `/verify` request is forwarded to the
Compose-internal verifier, and any missing or invalid verifier response becomes a canonical
`correct: false` verdict.

Issue 543/537: the Portal editor API below used to live in `verifier/server.py`, in the
single Docker stage a learner's own `make build` produced -- the same image that carried
`tests/hidden/check_pipeline.py` and the process that runs it. All eight checkpoints are
graded by running that suite against the submitted file, so the person being graded could
read the assertions. Option B2 took `fixtures/` out of this stage as well: it implements
`lookup_accumulator`, `to_rotation_domain`, `blind_rotate`, `output_noise_bound`,
`correctness_bound`, `refresh_report` and `nand_combine` -- seven of the twelve names
`starter/pipeline.py` asks the learner to write -- because it cannot derive a deployment's
trace and noise contract without them. `show.py` reads this deployment's public half from
the verifier's `GET /public` instead (see show.py and the VERIFIER_PUBLIC_URL wiring in
../docker-compose.yml).

The supplied half stayed: `participant/fhe.py` is the ring, the encoding, LWE and RLWE, the
gadget, RGSW, CMUX, extraction and key switching -- the five earlier Week 5 problems, which
this one explicitly supplies rather than grades. `starter/pipeline.py` imports from it on
its first line.
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
PROBLEM_ID = "ac26-w5-pbs-homnand"
SEED = os.environ.get("FLAG_SEED", "local-dev-seed")
PORT = int(os.environ.get("WORKBENCH_PORT", "18112"))
VERIFIER_URL = os.environ.get("VERIFIER_URL", "")

MAX_BODY_BYTES = 256 * 1024
RUN_TIMEOUT_SECONDS = 60
MAX_ADDRESS_SPACE_BYTES = 512 * 1024 * 1024
MAX_PROCESSES = 64
MAX_OUTPUT_BYTES = 64 * 1024
REQUEST_TIMEOUT_SECONDS = 15

CHECKPOINTS = (
    "lut",
    "domain",
    "rotate",
    "relabel",
    "evaluate",
    "refresh",
    "nand",
    "transfer",
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
    problem_id='ac26-w5-pbs-homnand',
    problem_name='暗号文のまま関数を引き、鍵を新品に戻す',
    problem_name_en='Look up a function on a ciphertext, and hand back a fresh key',
    description='Week 5 の 5 問が作った部品を 1 本の Programmable Bootstrapping につなぎ、 最後に暗号文のまま NAND を評価する。 復号は 1 回も起きない。',
    description_en="Chain what Week 5's five problems built into one Programmable Bootstrapping pipeline, then evaluate a NAND on ciphertexts. Nothing is decrypted at any step.",
    checkpoint_labels={'lut': '関数を多項式に書く', 'domain': '回転の単位へ移す', 'rotate': '暗号化されたまま回す', 'relabel': '鍵の所属を付け替える', 'evaluate': '暗号文のまま関数を引く', 'refresh': '何が起きたかを記録する', 'nand': 'ゲートを組んで真理値表をそろえる', 'transfer': '見たことのない設定で成立させる'},
    checkpoint_labels_en={'lut': 'Write the function into a polynomial', 'domain': 'Move to the units of rotation', 'rotate': 'Turn it while it stays encrypted', 'relabel': 'Move it between key domains', 'evaluate': 'Look up a function on a ciphertext', 'refresh': 'Record what actually happened', 'nand': 'Build the gate and complete the truth table', 'transfer': 'Hold up in a setting you have not seen'},
    submitted_files=('pipeline.py',),
    code_checkpoints=('lut', 'domain', 'rotate', 'relabel', 'evaluate', 'refresh', 'nand', 'transfer'),
    checkpoints=('lut', 'domain', 'rotate', 'relabel', 'evaluate', 'refresh', 'nand', 'transfer'),
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
    # Host reachability is restricted by docker-compose.yml to the loopback publish.
    HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()  # noqa: S104


if __name__ == "__main__":
    main()
