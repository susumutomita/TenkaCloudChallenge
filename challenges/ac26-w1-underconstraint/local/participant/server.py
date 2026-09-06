"""Public Participant Workbench: the Portal editor API, a fail-closed verifier proxy,
and nothing that can derive an answer.

This process never grades a checkpoint locally -- every `/verify` request is forwarded
to the Compose-internal verifier, and any missing or invalid verifier response becomes
a canonical `correct: false` verdict (see `proxy_verdict`).

Issue 525/543/537: `verifier/server.py` used to ship in the single participant Docker
stage together with this Portal API. That file derives the exact JSON the `root-cause`
checkpoint accepts, keyed by a seed the learner already has in their own container's
`FLAG_SEED` -- its own docstring says knowing the answer is that function's entire
purpose. #533 moved the four answer functions out of `fixtures/generate.py`, but the
derivation that replaced them lives in the grader, so shipping the grader alongside the
Workbench simply relocated the leak. The answer-deriving half now runs in a separate,
unpublished image (see ../Dockerfile, ../docker-compose.yml).

Issue 537/543 option B2: `fixtures/` used to stay in this stage on the grounds that
after #533 it handed back INPUTS only. That was wrong. `_ISZERO_HALVES` there is both
halves of the is-zero gadget as dicts under the exact ids the checkpoints require, so
`intended_circuit()` was a copy out of it and `audit` and `repair` fell out as a set
difference; measured on the shipped image, transcription alone scored 3 of 6
checkpoints and transcription plus a scan over the supplied evaluator scored 5 of 6 --
every checkpoint a code submission can reach. `fixtures/` is out of this stage now, and
the public half it also held is read from the verifier's `GET /public` (see
evidence.py, ../show.py and the VERIFIER_PUBLIC_URL wiring in ../docker-compose.yml).
"""

from __future__ import annotations

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from participant.evidence import public_evidence
from participant.execution import run_functions
from participant.isolation import protect_supervisor
from participant.evaluator import satisfies

ROOT = Path(__file__).resolve().parents[1]
SEED = "local-dev-seed"  # public evidence comes from the internal verifier
PORT = int(os.environ.get("WORKBENCH_PORT", "18094"))
VERIFIER_URL = os.environ.get("VERIFIER_URL", "")

MAX_BODY_BYTES = 256 * 1024
#: Wall clock for reading a request body, so a stalled client cannot pin the server.
REQUEST_TIMEOUT_SECONDS = 15

CHECKPOINTS = ("build", "audit", "exploit", "root-cause", "repair", "mutation-transfer")
SUBMISSION_FILES = ("policy.py",)
#: The five checkpoints whose portal submission is the learner's policy.py source.
CODE_CHECKPOINT_IDS = ("build", "audit", "exploit", "repair", "mutation-transfer")
CODE_CHECKPOINTS_FOR_PORTAL = frozenset(CODE_CHECKPOINT_IDS)
CHECKPOINT_LABELS = {'build': '本来の検査を組む', 'audit': '欠けた検査を見つける', 'exploit': '検査の不足を示す値を作る', 'root-cause': '原因と変更した値を報告する', 'repair': '足りない検査だけを戻す', 'mutation-transfer': '別の欠落と数でも確かめる'}

def starter_payload() -> dict[str, str]:
    """Return the editable file shipped to the Portal editor."""
    return {
        name: (ROOT / "starter" / name).read_text(encoding="utf-8") for name in SUBMISSION_FILES
    }


def config_payload() -> dict[str, object]:
    """Declare the generic editor contract consumed by the Participant Portal."""
    return {
        "id": "ac26-w1-underconstraint",
        "name": "通るのに、守れていない",
        "description": "不足した検査を見つけ、反例を作り、正常な値を通すまま修復します。",
        "submittedFiles": list(SUBMISSION_FILES),
        "checkpoints": [
            {
                "id": checkpoint,
                "label": CHECKPOINT_LABELS[checkpoint],
                "kind": "code" if checkpoint in CODE_CHECKPOINTS_FOR_PORTAL else "answer",
            }
            for checkpoint in CHECKPOINTS
        ],
        # 英語は Portal 側の locale が選ぶ (共有 workbench.py の config_payload と同じ契約)。
        # 文言の正本は metadata.json — scripts/generate-course-workbenches.py --check が
        # 乖離を落とす (#381)。 この payload は手書きなので、 直すときはここを編集する。
        "i18n": {
            "en": {
                "name": 'It passes, but it does not protect',
                "description": 'Find a missing check, construct a counterexample, and repair it while preserving honest results.',
                "checkpointLabels": {'build': 'Build the intended checks', 'audit': 'Find the missing check', 'exploit': 'Construct a counterexample', 'root-cause': 'Report the cause and changed values', 'repair': 'Restore only the missing check', 'mutation-transfer': 'Handle another gap and other numbers'},
            }
        },
    }


def inspect_payload() -> dict[str, object]:
    """The seeded evidence shown by the browser's inspect command.

    Same facts as `show.py`, from the same place: this deployment's own verifier over
    the internal network. It used to be built here from `fixtures.generate`, which is
    what Issue 543 option B2 took out of this image. The id of the dropped constraint
    stays out of the payload -- finding it is the audit checkpoint -- and the
    root-cause diagnosis is not derivable here at all.
    """
    return public_evidence()


def _submission_sources(files: object) -> dict[str, str] | None:
    if not isinstance(files, dict):
        return None
    sources = {name: files.get(name) for name in SUBMISSION_FILES}
    if any(not isinstance(text, str) or not text.strip() for text in sources.values()):
        return None
    normalized = {name: text for name, text in sources.items() if isinstance(text, str)}
    if sum(len(text) for text in normalized.values()) > MAX_BODY_BYTES:
        return None
    return normalized


def run_public_tests(seed: str, files: object) -> dict[str, object]:
    """The visible checks: honest assignments and return shapes, no counterexamples."""
    del seed
    sources = _submission_sources(files)
    if sources is None:
        return {"passed": False, "output": "policy.py must be a non-empty Python file."}
    evidence = public_evidence()
    circuit, prm = evidence["deployedCircuit"], evidence["parameters"]
    result = run_functions(sources, [{"function": "intended_circuit", "args": []},
                                     {"function": "audit", "args": [circuit]},
                                     {"function": "repair", "args": [circuit]}])
    values = result and result.get("values")
    if not isinstance(values, list) or len(values) != 3:
        return {"passed": False, "output": (result or {}).get("output") or "Functions did not return values within the execution limits."}
    if any(not isinstance(value, dict) or set(value) != {"returned"} for value in values):
        return {"passed": False, "output": "A function raised an exception; check the editor code."}
    built, audited, repaired = [value["returned"] for value in values]
    try:
        passed = (isinstance(built, list) and bool(built)
                  and all(isinstance(c, dict) and "id" in c for c in built)
                  and isinstance(audited, list) and isinstance(repaired, list) and bool(repaired)
                  and all(satisfies(built, witness, prm["p"]) for witness in evidence["honestWitnesses"].values()))
    except (KeyError, TypeError, ValueError, OverflowError):
        passed = False
    return {"passed": passed, "output": "public tests: " + ("all passed" if passed else "failed: check the documented return shapes and honest witnesses")
            + "\nNo counterexample was tried. This does not establish that the missing check is repaired."}


def prepare_submissions(seed: str, files: object) -> dict[str, object]:
    """Format the policy.py source the five code checkpoints take.

    `root-cause` is deliberately absent: its JSON names the dropped constraint
    and the manipulated signals, which is the diagnosis the learner derives from
    their own audit and forgery. Producing it here would erase what that
    checkpoint measures. The seed does not enter the values; it stays in the
    signature so every Portal prepare API has the same shape.
    """
    del seed
    sources = _submission_sources(files)
    if sources is None:
        return {"ok": False, "output": "policy.py must be a non-empty Python file."}
    return {
        "ok": True,
        "submissions": {
            checkpoint: sources["policy.py"] for checkpoint in CODE_CHECKPOINT_IDS
        },
    }


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
    """Forward one `/verify` request to the internal verifier, fail-closed.

    An unset URL, an unreachable verifier, an oversized or malformed body, or a
    verdict that does not name the checkpoint that was asked about all collapse to
    the same `correct: false` -- never to a locally-computed verdict, because this
    process has nothing to compute one from.
    """
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
        # Property-level failure summary the verifier chose to surface (AGENTS.md §15).
        # Everything else the verifier might add stays dropped.
        verdict["message"] = message[:2000]
    return verdict


class Handler(BaseHTTPRequestHandler):
    #: `StreamRequestHandler.setup` applies this to the socket before `rfile` is created,
    #: so it bounds `rfile.read` inside `do_POST` -- which a client that sends a
    #: content-length and then stops sending would otherwise block on forever, pinning
    #: this single-threaded server.
    timeout = REQUEST_TIMEOUT_SECONDS

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler's name
        path = urlsplit(self.path).path
        if path == "/api/config":
            self._respond(200, config_payload())
            return
        if path == "/api/inspect":
            self._respond(200, inspect_payload())
            return
        if path == "/api/starter":
            self._respond(200, starter_payload())
            return
        if path == "/healthz":
            self._respond(200, {"ok": True})
            return
        self._respond(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler's name
        path = urlsplit(self.path).path.rstrip("/") or "/"
        if path not in ("/verify", "/api/test", "/api/prepare"):
            self._respond(404, {"error": "not found"})
            return
        body = self._read_json_body()
        if body is None:
            return
        if path == "/api/test":
            self._respond(200, run_public_tests(SEED, body.get("files")))
            return
        if path == "/api/prepare":
            self._respond(200, prepare_submissions(SEED, body.get("files")))
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
            # A stalled body read, not a malformed one. Same fail-closed outcome.
            self._respond(400, {"error": "incomplete body"})
            return None
        if not isinstance(body, dict):
            self._respond(400, {"error": "bad json"})
            return None
        return body

    def log_message(self, *_args: object) -> None:
        """Silence the default access log; it would echo submissions."""

    def _respond(self, status: int, payload: dict[str, object]) -> None:
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(encoded)))
        self.send_header("cache-control", "no-store")
        self.send_header("x-content-type-options", "nosniff")
        self.send_header(
            "content-security-policy",
            "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; "
            "img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; "
            "form-action 'self'",
        )
        self.end_headers()
        self.wfile.write(encoded)


def main() -> None:
    protect_supervisor()
    # Bind every interface *inside the container*, not the container's loopback: a
    # published port is forwarded to the container's bridge address. The loopback
    # restriction that matters is on the host, and it lives in docker-compose.yml.
    HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()  # noqa: S104 - see above


if __name__ == "__main__":
    main()
