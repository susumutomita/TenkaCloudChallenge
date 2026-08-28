"""Public Participant Workbench and fail-closed verifier proxy.

This process carries public material, the starter, the supplied lab layer and the public tests
— and nothing that grades. Every `/verify` request is forwarded to the Compose-internal
verifier, and any missing or invalid verifier response becomes a canonical `correct: false`
verdict (see `proxy_verdict`).

Issue 537/538 (Issue 543 option B2): the Portal editor API below used to live in
`verifier/server.py`, in the single Docker stage a learner's own `make build` produced — the
same image that carried `tests/hidden/check_guest.py` and the process that runs it. That file
holds a complete and correct implementation of four of the eight graded functions: `_encode` is
`encode_statement`, `_run` is `run_guest`, `_journal` is `seal_journal`, and `_leaks` is the
policy `leak_report` applies, with `_not_statements` and `_not_witnesses` enumerating every
refusal three more of them are graded on. Beside it, `fixtures/generate.py` carried `_machine`
(the same run again), `replay_truth` (which of the fifteen receipts a verifier may accept) and
`disclosure_truth` (which `(channel, name)` pairs each of the ten audited runs gave away). A
submission transcribed from those two files, with no reasoning past copying, scored 8 of 8
checkpoints (300 of 300 points).

The supplied half stayed on this side, in `participant/lab.py`: the vocabulary, the semantics
profiles, the commitment, the image decoder, the two encoders and the toy runner are what the
problem deliberately hands over — nothing in them is graded — and `show.py`, the public tests
and the learner's own submission all build on them. What they no longer have is this
deployment's data: they read the statement, the image and its four siblings, the witness, the
colliding pair and the ten audited runs from the verifier's `GET /public` instead (see show.py,
tests/public/test_guest.py, and the VERIFIER_PUBLIC_URL wiring in ../docker-compose.yml).
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
PROBLEM_ID = "ac26-w6-zkvm-witness-binding"
SEED = os.environ.get("FLAG_SEED", "local-dev-seed")
PORT = int(os.environ.get("WORKBENCH_PORT", "18117"))
VERIFIER_URL = os.environ.get("VERIFIER_URL", "")

MAX_BODY_BYTES = 256 * 1024
RUN_TIMEOUT_SECONDS = 60
MAX_ADDRESS_SPACE_BYTES = 512 * 1024 * 1024
MAX_PROCESSES = 64
MAX_OUTPUT_BYTES = 64 * 1024
REQUEST_TIMEOUT_SECONDS = 15
#: Cap for a forwarded verdict message; matches the platform schema's limit.
MAX_MESSAGE_CHARS = 2000

#: The Portal's checkpoint list, in display order. Kept here rather than only inside the
#: generated block below because scripts/verify-course-workbenches.py probes for it, and
#: because nothing in this process may decide a checkpoint -- this is a list of names, not a
#: grading table. The verifier keeps its own copy (see ../verifier/server.py).
CHECKPOINTS = (
    "encoding",
    "identity",
    "ingestion",
    "reexec",
    "journal",
    "replay",
    "privacy",
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
    problem_id='ac26-w6-zkvm-witness-binding',
    problem_name='証明は valid だった。 ただし、 別の口座についての証明だった',
    problem_name_en='The proof was valid. It was a proof about a different account',
    description='zkVM が証明するのは 「そのプログラムが走った」 ことだけである。 **どの**プログラムか、 **どの**入力についてか、 **何を**主張しているのかは、 guest が bytes で言い切るしかない。 その contract — public statement・private witness・public journal — を書く。',
    description_en='A zkVM proves that a program ran, and nothing else. Which program, about which inputs, asserting what — the guest has to say all of that out loud, in bytes. Write the contract: public statement, private witness, public journal.',
    checkpoint_labels={'encoding': '同じ statement は同じ bytes、 違う statement は違う bytes', 'identity': 'どのプログラムの話かを、 走る bytes で名指す', 'ingestion': 'witness を通す扉は 1 つだけ', 'reexec': 'host の言い分は入力であって答えではない', 'journal': '公開してよいのは、 読者がすでに計算できるものだけ', 'replay': 'その receipt は、 その statement の証拠か', 'privacy': '承認された名前は、 承認ではない', 'transfer': '見たことのない target・claim・protocol version で'},
    checkpoint_labels_en={'encoding': 'Same statement, same bytes; different statement, different bytes', 'identity': 'Name the program by the bytes that run', 'ingestion': 'The witness goes through one door', 'reexec': "The host's account is an input, not the answer", 'journal': 'Publish only what a reader could already compute', 'replay': 'Is this receipt evidence for this statement?', 'privacy': 'An approved name is not an approval', 'transfer': 'A target, a claim and a protocol version you have not seen'},
    submitted_files=('guest.py',),
    code_checkpoints=('encoding', 'identity', 'ingestion', 'reexec', 'journal', 'replay', 'privacy', 'transfer'),
    checkpoints=('encoding', 'identity', 'ingestion', 'reexec', 'journal', 'replay', 'privacy', 'transfer'),
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
