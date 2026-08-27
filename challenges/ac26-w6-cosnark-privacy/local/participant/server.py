"""Public Participant Workbench and fail-closed verifier proxy.

This process carries public evidence, starter material, the supplied layer, the eight
specimens and the public tests -- and nothing that grades. Every `/verify` request is
forwarded to the Compose-internal verifier, and any missing or invalid verifier response
becomes a canonical `correct: false` verdict (see `proxy_verdict`).

Issue 537/538 (Issue 543 option B2): the Portal editor API below used to live in
`verifier/server.py`, in the single Docker stage a learner's own `make build` produced -- the
same image that carried `tests/hidden/check_prover.py` and the process that runs it. That
checker holds the rules every checkpoint is graded against: `_expected_class` is `classify`'s
answer, `_authorized` is `open-set`'s, and `_expected_leakage` is `leakage`'s. Beside it
shipped `fixtures/specimens.py`, whose `GROUND_TRUTH` names -- per specimen -- the
capabilities reached, the unauthorized openings, the disclosed `(channel, name)` pairs and the
recoverable secret, for exactly the eight provers the problem asks about; and
`fixtures/generate.py`, with the `setting`, `coefficients`, `witness`, `relation` and
`value_catalog` the hidden labels `h0`..`h3` are drawn from.

The supplied half stayed on this side: `participant/mpc.py` (the sharing runtime, the
disclosure sink, the policy vocabulary and the two answers this problem hands over),
`participant/specimens.py` (the eight runnable provers, without the table of answers about
them) and `participant/lab.py` (the bench). What they no longer have is the derivation -- they
read this deployment's setting, row, witness and catalog from the verifier's `GET /public`
instead (see show.py, tests/public/test_prover.py, and the VERIFIER_PUBLIC_URL wiring in
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
PROBLEM_ID = "ac26-w6-cosnark-privacy"
SEED = os.environ.get("FLAG_SEED", "local-dev-seed")
PORT = int(os.environ.get("WORKBENCH_PORT", "18115"))
VERIFIER_URL = os.environ.get("VERIFIER_URL", "")

MAX_BODY_BYTES = 256 * 1024
RUN_TIMEOUT_SECONDS = 60
MAX_ADDRESS_SPACE_BYTES = 512 * 1024 * 1024
MAX_PROCESSES = 64
MAX_OUTPUT_BYTES = 64 * 1024
REQUEST_TIMEOUT_SECONDS = 15

#: The Portal's checkpoint list, in display order. Kept here rather than only inside the
#: generated block below because scripts/verify-course-workbenches.py probes for it, and
#: because nothing in this process may decide a checkpoint -- this is a list of names, not a
#: grading table. The verifier keeps its own copy (see ../verifier/server.py).
CHECKPOINTS = (
    "classify",
    "capability",
    "open-set",
    "cross-party",
    "leakage",
    "evidence",
    "repair",
    "transfer",
)


def _limits() -> None:
    # Darwin aliases RLIMIT_AS onto RLIMIT_RSS and refuses to set it; setting it anyway
    # raises inside `preexec_fn` and aborts the exec. See ../verifier/server.py.
    if sys.platform.startswith("linux"):
        resource.setrlimit(resource.RLIMIT_AS, (MAX_ADDRESS_SPACE_BYTES, MAX_ADDRESS_SPACE_BYTES))
    resource.setrlimit(resource.RLIMIT_NPROC, (MAX_PROCESSES, MAX_PROCESSES))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_OUTPUT_BYTES, MAX_OUTPUT_BYTES))


# BEGIN GENERATED PORTAL EDITOR API
_WORKBENCH = PortalEditorSupport(
    root=ROOT,
    seed=SEED,
    problem_id='ac26-w6-cosnark-privacy',
    problem_name='同じ答えを返す 8 つの prover が、 それぞれ別のことを言っている',
    problem_name_en='Eight provers that agree on the answer and disagree on what they say',
    description='8 つの co-SNARK prover はどれも同じ `C = A × B` を返す。 違うのは何を、 どの出口から外へ出すかだけ。 最初の privacy violation を記録から特定し、 correctness と round 数を保ったまま塞ぐ。',
    description_en='All eight co-SNARK provers return the same `C = A * B`. What differs is what each one lets out, and through which exit. Find the first privacy violation in the record and close it without changing the answer or the round count.',
    checkpoint_labels={'classify': 'どの値が、 誰のものか', 'capability': '1 回動かして分かることと、 分からないこと', 'open-set': '話してよかった値と、 そうでない値', 'cross-party': '何も言わずに、 読むだけの実装', 'leakage': '答えを見る test が、 見ていない 3 つの出口', 'evidence': '漏れた値から、 秘密を組み立てる', 'repair': '同じ答えを返し、 何も言わない prover', 'transfer': '見たことのない設定と、 見たことのない実装で'},
    checkpoint_labels_en={'classify': 'Which values belong to whom', 'capability': 'What one run tells you, and what it does not', 'open-set': 'The values it was allowed to say, and the ones it was not', 'cross-party': 'The implementation that says nothing and reads everything', 'leakage': 'The three exits a correctness test never looks at', 'evidence': 'Build the secret out of what leaked', 'repair': 'Same answer, nothing said', 'transfer': 'A setting you have not seen, and provers you have not seen'},
    submitted_files=('prover.py',),
    code_checkpoints=('classify', 'capability', 'open-set', 'cross-party', 'leakage', 'evidence', 'repair', 'transfer'),
    checkpoints=('classify', 'capability', 'open-set', 'cross-party', 'leakage', 'evidence', 'repair', 'transfer'),
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

    Nothing here decides a checkpoint. The grading process runs in the image that carries
    `fixtures/` and `tests/hidden/`, which this container never builds.
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
