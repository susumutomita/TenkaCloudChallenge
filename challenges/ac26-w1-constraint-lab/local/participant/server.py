"""Participant editor API with public-only function inputs and a fixed verifier proxy.

The Workbench receives no deployment seed, fixture generator or hidden checker.
Preparing code bundles copies the learner's three files; first-broken remains the
participant's manual JSON answer. The published tests run in the controller against
untrusted function values from a separate Linux-restricted worker.
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

from participant.execution import LearnerSession
from participant.isolation import protect_supervisor
from tests.public.test_circuit import run_cases

ROOT = Path(__file__).resolve().parents[1]
SEED = "local-dev-seed"  # author-only fallback; live evidence comes from verifier
PORT = int(os.environ.get("WORKBENCH_PORT", "18093"))
VERIFIER_URL = os.environ.get("VERIFIER_URL", "")
#: Derived from VERIFIER_URL (which points at /verify) rather than a second required
#: env var: the two routes always name the same host and port in every deployment this
#: problem ships, and a second knob that can drift from the first is one more way to
#: misconfigure the split.
VERIFIER_PUBLIC_URL = VERIFIER_URL.rsplit("/", 1)[0] + "/public" if VERIFIER_URL else ""

MAX_BODY_BYTES = 256 * 1024
MAX_OUTPUT_BYTES = 64 * 1024
REQUEST_TIMEOUT_SECONDS = 15

SUBMITTED_FILES = ("field.py", "circuit.py", "gadgets.py")
FILE_CHECKPOINTS = ("residuals", "boolean", "membership", "range")
CODE_CHECKPOINTS_FOR_PORTAL = frozenset(FILE_CHECKPOINTS)
CHECKPOINTS = ("residuals", "first-broken", "boolean", "membership", "range")
CHECKPOINT_LABELS = {'residuals': '各行の残りを計算する', 'first-broken': '最初に破れた行と残りを答える', 'boolean': '0と1だけを許す条件を作る', 'membership': '許可リストの値だけを通す', 'range': '0/1の桁で範囲を縛る'}


def fetch_public(verifier_public_url: str = VERIFIER_PUBLIC_URL) -> dict[str, object] | None:
    """This deployment's public evidence, fetched from the verifier over the network.

    Never returns anything `verifier/server.py`'s own `/public` route would not: this
    is a plain relay, not a second implementation. `None` means the network path could
    not be used -- most callers turn that into a fail-closed response rather than
    guessing.
    """
    if verifier_public_url:
        request = Request(verifier_public_url, method="GET")
        try:
            with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:  # noqa: S310
                body = response.read(MAX_BODY_BYTES + 1)
                if len(body) <= MAX_BODY_BYTES:
                    decoded = json.loads(body.decode("utf-8"))
                    if isinstance(decoded, dict):
                        return decoded
        except (
            HTTPError,
            URLError,
            TimeoutError,
            OSError,
            ValueError,
            UnicodeDecodeError,
            json.JSONDecodeError,
        ):
            pass
    # Author checkout fallback only; the participant image has no fixtures package.
    try:
        from fixtures.generate import public_payload
    except ImportError:
        return None
    return public_payload(SEED)


def starter_payload() -> dict[str, str]:
    """Return the three editable files shipped to the Portal editor."""
    return {
        name: (ROOT / "starter" / name).read_text(encoding="utf-8") for name in SUBMITTED_FILES
    }


def config_payload() -> dict[str, object]:
    """Declare the generic editor contract consumed by the Participant Portal."""
    return {
        "id": "ac26-w1-constraint-lab",
        "name": "0 になるべき式の集まり",
        "description": '「不合格」しか返さない検査道具を直す。条件の式に値を入れ、最初の違反を見つける。最後は0/1の桁を使い、範囲外を通さない条件を組み立てる。',
        "submittedFiles": list(SUBMITTED_FILES),
        "checkpoints": [
            {
                "id": checkpoint,
                "label": CHECKPOINT_LABELS[checkpoint],
                "kind": "code" if checkpoint in CODE_CHECKPOINTS_FOR_PORTAL else "answer",
            }
            for checkpoint in CHECKPOINTS
        ],
        # Portal selects the locale. Keep labels/descriptions aligned by ID with metadata.json.
        "i18n": {
            "en": {
                "name": 'A set of things that must be zero',
                "description": 'Repair a checker that only says rejected. Substitute values, find the first broken condition, then build digit constraints that reject values outside a range.',
                "checkpointLabels": {'residuals': 'Calculate each row’s remainder', 'first-broken': 'Identify the first broken row and its remainder', 'boolean': 'Build a condition allowing only zero and one', 'membership': 'Allow only the listed values', 'range': 'Constrain a range using zero/one digits'},
            }
        },
    }


def inspect_payload() -> dict[str, object]:
    """This deployment's public evidence, as fetched from the verifier.

    Same fields `show.py` prints. The id of the first violated constraint stays out
    of it: that is the answer participants derive from the visible witness.
    The verifier alone imports the answer helper; this route only relays evidence.
    """
    payload = fetch_public()
    if payload is None:
        return {"error": "public evidence unavailable"}
    return payload


def _submission_sources(files: object) -> dict[str, str] | None:
    if not isinstance(files, dict):
        return None
    sources = {name: files.get(name) for name in SUBMITTED_FILES}
    if any(not isinstance(text, str) or not text.strip() for text in sources.values()):
        return None
    normalized = {name: text for name, text in sources.items() if isinstance(text, str)}
    if sum(len(text) for text in normalized.values()) > MAX_BODY_BYTES:
        return None
    return normalized


def run_public_tests(files: object) -> dict[str, object]:
    """Run the published assertions on learner values, with public inputs only."""
    sources = _submission_sources(files)
    if sources is None:
        return {"passed": False, "output": "All three editable Python files are required."}
    public = fetch_public()
    if public is None:
        return {"passed": False, "output": "Public evidence unavailable; is the verifier running?"}
    learner = LearnerSession(sources)
    try:
        with learner:
            result = run_cases(*learner.modules(), public)
            result['output'] = (learner.log + result['output'])[-MAX_OUTPUT_BYTES:]
            return result
    except Exception:
        # Only the public-test surface shows source startup diagnostics. Grading
        # continues to report generic failures, without hidden-call input values.
        return {"passed": False, "output": learner.initialization_diagnostic
                or "The functions did not return values within the execution limits."}


def prepare_submissions(files: object) -> dict[str, object]:
    """Format the JSON bundle the four code checkpoints take.

    `first-broken` is deliberately absent: it is read off the broken witness's trace
    by the learner. Producing it here would erase what that checkpoint measures. No
    fixtures are needed for this one -- the bundle is just the learner's own three
    files, so unlike `inspect`/`test` it never has to leave this process. `range`
    takes the same bundle: its two functions live in `gadgets.py`.
    """
    sources = _submission_sources(files)
    if sources is None:
        return {"ok": False, "output": "All three editable Python files are required."}
    bundle = json.dumps(sources, separators=(",", ":"))
    return {
        "ok": True,
        "submissions": {checkpoint: bundle for checkpoint in FILE_CHECKPOINTS},
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
    timeout = REQUEST_TIMEOUT_SECONDS

    def do_GET(self) -> None:  # noqa: N802 - stdlib handler API
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

    def do_POST(self) -> None:  # noqa: N802 - stdlib handler API
        path = urlsplit(self.path).path.rstrip("/") or "/"
        if path not in ("/verify", "/api/test", "/api/prepare"):
            self._respond(404, {"error": "not found"})
            return
        body = self._read_json_body()
        if body is None:
            return
        if path == "/api/test":
            self._respond(200, run_public_tests(body.get("files")))
            return
        if path == "/api/prepare":
            self._respond(200, prepare_submissions(body.get("files")))
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
    protect_supervisor()
    # Host reachability is restricted by docker-compose.yml to the loopback publish.
    HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()  # noqa: S104


if __name__ == "__main__":
    main()
