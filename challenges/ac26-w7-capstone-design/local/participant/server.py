"""Public Participant Workbench and fail-closed verifier proxy.

This process carries public material, the starter, the supplied lab layer and the public
tests — and nothing that grades. Every `/verify` request is forwarded to the Compose-internal
verifier, and any missing or invalid verifier response becomes a canonical `correct: false`
verdict (see `proxy_verdict`).

Issue 537/538 (Issue 543 option B2): the Portal editor API below used to live in
`verifier/server.py`, in the single Docker stage a learner's own `make build` produced — the
same image that carried `tests/hidden/check_design.py` and the process that runs it. That
checker states, in full, the rule each of this problem's eight checkpoints is graded on:
`_spec_requirements` is `required_properties`' answer written out, `_spec_admissible` is the
`admissible` column of `compare_alternatives`, `_selection_failures` states the four
conditions `select_primitive` is accepted on, `_graph_failures` states every condition an
`architecture` must meet, and `_matrix_failures` states each row's contract. Beside it,
`fixtures/generate.py` carried the whole graded population — the six written briefs, their
eighteen variants and the twelve generated from the seed. A submission transcribed from those
two files, with no reasoning past copying, scored 4 of 8 checkpoints (155 of 300 points) from
the stated rules alone, and 8 of 8 (300 of 300) once the remaining four artifacts were built
to the conditions the same file writes out.

The supplied half stayed on this side, in `participant/lab.py`: the property vocabulary and
the option table are what the problem deliberately hands over — nothing in them is graded —
and `show.py`, the public tests and the learner's own submission all build on them. What they
no longer have is the population: they read this deployment's brief and its review variant
from the verifier's `GET /public` instead (see show.py, tests/public/test_design.py, and the
VERIFIER_PUBLIC_URL wiring in ../docker-compose.yml).
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
PROBLEM_ID = "ac26-w7-capstone-design"
SEED = os.environ.get("FLAG_SEED", "local-dev-seed")
PORT = int(os.environ.get("WORKBENCH_PORT", "18119"))
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
    "assets",
    "requirements",
    "alternatives",
    "selection",
    "architecture",
    "attacks",
    "matrix",
    "revision",
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
    problem_id='ac26-w7-capstone-design',
    problem_name='道具から決めない',
    problem_name_en='Do not start from the tool',
    description='brief には actor と asset と信頼関係しか書いていない。 primitive の名前は 1 つも出てこない。 そこから必要な性質を導き、 必要な分だけ選び、 境界に型をつけ、 前提が動いた brief にもう一度答える。',
    description_en='The brief names actors, assets, and who trusts whom. It names no primitive. Derive the properties it requires, select exactly that much, type every boundary, then answer the same brief with one fact moved.',
    checkpoint_labels={'assets': '誰の何を、どこまで隠すのかを並べる', 'requirements': 'brief から必要な性質だけを取り出す', 'alternatives': '使わない場合を含めて並べる', 'selection': 'brief が要求した分だけ選ぶ', 'architecture': '何がどの形で境界を越えるかを書く', 'attacks': '壊れ方を、観測できる形で書く', 'matrix': '性質ごとに、誰が担うのかを書く', 'revision': '前提が 1 つ動いた brief に答える'},
    checkpoint_labels_en={'assets': 'List what belongs to whom, and how far it is hidden', 'requirements': 'Take from the brief only the properties it asks for', 'alternatives': 'Lay the options out, including using none of them', 'selection': 'Select as much as the brief asked for, and no more', 'architecture': 'Say what crosses each boundary, and in what form', 'attacks': 'Write down how it breaks, in a form you could observe', 'matrix': 'Say, for each property, which component carries it', 'revision': 'Answer a brief in which one fact has moved'},
    submitted_files=('design.py',),
    code_checkpoints=('assets', 'requirements', 'alternatives', 'selection', 'architecture', 'attacks', 'matrix', 'revision'),
    checkpoints=('assets', 'requirements', 'alternatives', 'selection', 'architecture', 'attacks', 'matrix', 'revision'),
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
