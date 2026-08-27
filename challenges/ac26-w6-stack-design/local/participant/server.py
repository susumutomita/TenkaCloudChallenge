"""Public Participant Workbench and fail-closed verifier proxy.

This process carries public material, the starter, the supplied lab layer and the public tests
— and nothing that grades. Every `/verify` request is forwarded to the Compose-internal
verifier, and any missing or invalid verifier response becomes a canonical `correct: false`
verdict (see `proxy_verdict`).

Issue 537/538 (Issue 543 option B2): the Portal editor API below used to live in
`verifier/server.py`, in the single Docker stage a learner's own `make build` produced — the
same image that carried `fixtures/generate.py` and `tests/hidden/check_stack.py` and the process
that runs them. `fixtures/generate.py` holds this problem's entire ground truth under other
names: `constrained` is `carried`, `underwritten` is `underwrites`, `load_bearing` is
`property_map`, `violations` is `contract_violations`, `first_broken` is `first_failure`,
`selection_truth` is `select`, and `_one_change_neighbours` with `local_checks_pass`,
`properties_at_risk` and `_whole` is the whole search `counterexample` and `repair` are graded
on. Beside those it carried `BREAKS`, which names — per variant, and identically on every seed —
which node or edge each deployment broke and which attribute it changed. A submission
transcribed from that one file, with no reasoning past copying, scored 8 of 8 checkpoints
(300 of 300 points).

The supplied half stayed on this side, in `participant/lab.py`: the closed vocabularies, the
three levels of contract, the eleven boundary classes and what breaking one costs, and four
one-line accessors for walking a typed graph — none of which is graded, and every one of which
`starter/stack.py`'s own docstring names, so a submission has to be able to import it. What it no
longer has is this deployment's data: `show.py` and the public tests read the three sound
architectures, the thirteen deployments to diagnose and the eight briefs from the verifier's
`GET /public` instead (see show.py, tests/public/test_stack.py, and the VERIFIER_PUBLIC_URL
wiring in ../docker-compose.yml).
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
PROBLEM_ID = "ac26-w6-stack-design"
SEED = os.environ.get("FLAG_SEED", "local-dev-seed")
PORT = int(os.environ.get("WORKBENCH_PORT", "18118"))
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
    "dataflow",
    "properties",
    "contracts",
    "diagnosis",
    "counterexample",
    "repair",
    "selection",
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
    problem_id='ac26-w6-stack-design',
    problem_name='部品はどれも正しい。 つないだものが正しくない',
    problem_name_en='Every part is correct. What you built out of them is not',
    description='primitive が検証できるのは **渡されたものの形** だけである。 MPC engine は share かどうかを見るが、 それが secret のはずだったかは知らない。 zkVM は guest が走ったことを言うが、 journal が読み手の持っている program の話かは言わない。 部品の test は全部通り、 architecture は壊れている。 その **composition failure** を 9 通りの角度から診断する。',
    description_en="A primitive can only check the **shape** of what it was handed. An MPC engine sees that something is a share and not that it was supposed to be secret. A zkVM says the guest ran and not that its journal is about the program you are holding. Every component's test passes and the architecture is broken. Diagnose that **composition failure** from nine angles.",
    checkpoint_labels={'dataflow': '何がその wire を渡っていて、 primitive の保証はどこで終わるか', 'properties': 'どの wire がどの property を担っているか', 'contracts': '5 種類の違反があり、 それは 5 種類である', 'diagnosis': 'どれが最初に壊れたのか', 'counterexample': 'どの部品も壊さずに 1 つ落とす', 'repair': '要求を下げずに戻す', 'selection': 'まだ誰も作っていないものに stack を選ぶ', 'transfer': '見たことのない field・statement・program・brief で'},
    checkpoint_labels_en={'dataflow': "What is crossing that wire, and where the primitive's guarantee stops", 'properties': 'Which wire carries which property', 'contracts': 'There are five kinds of breach, and they really are five', 'diagnosis': 'Which one broke first', 'counterexample': 'Lose one without breaking a single component', 'repair': 'Put it back without lowering the requirement', 'selection': 'Choose a stack for something nobody has built yet', 'transfer': 'A field, a statement, a program and a brief you have not seen'},
    submitted_files=('stack.py',),
    code_checkpoints=('dataflow', 'properties', 'contracts', 'diagnosis', 'counterexample', 'repair', 'selection', 'transfer'),
    checkpoints=('dataflow', 'properties', 'contracts', 'diagnosis', 'counterexample', 'repair', 'selection', 'transfer'),
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
