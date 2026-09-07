"""Participant editor API: public evidence, untrusted function execution, fixed verifier proxy.

The Workbench has no run seed, fixtures or hidden checker. Submitted functions run
with public inputs only; Linux denies file opening, network access and supervisor
interference. Public test success is a shape check, never scoring evidence.
Preparing checkpoint values and grading them use fixed internal verifier routes.
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

from participant.execution import run_functions
from participant.isolation import protect_supervisor

ROOT = Path(__file__).resolve().parents[1]
SEED = "local-dev-seed"  # author-only fallback; live public evidence comes from verifier
PORT = int(os.environ.get("WORKBENCH_PORT", "18092"))
VERIFIER_URL = os.environ.get("VERIFIER_URL", "")
#: Both derived from VERIFIER_URL (which points at /verify) rather than requiring two
#: more env vars: all three routes always name the same host and port in every
#: deployment this problem ships, and knobs that can drift from each other are one
#: more way to misconfigure the split.
VERIFIER_PUBLIC_URL = VERIFIER_URL.rsplit("/", 1)[0] + "/public" if VERIFIER_URL else ""
VERIFIER_PREPARE_URL = VERIFIER_URL.rsplit("/", 1)[0] + "/prepare" if VERIFIER_URL else ""

MAX_BODY_BYTES = 256 * 1024
RUN_TIMEOUT_SECONDS = 15
MAX_ADDRESS_SPACE_BYTES = 512 * 1024 * 1024
MAX_PROCESSES = 64
MAX_OUTPUT_BYTES = 64 * 1024
REQUEST_TIMEOUT_SECONDS = 15
# Reading a client body and waiting for bounded computation are different budgets.
VERIFIER_TIMEOUT_SECONDS = 20

CHECKPOINTS = ("incompleteness", "unsoundness", "privacy-leak", "property-matrix", "transfer")
SUBMISSION_FILES = ("classify.py", "counterexamples.py")
# All five controls submit the current editor files. The verifier's transfer
# feedback classification is separate from this existing Portal input contract.
CODE_CHECKPOINTS = frozenset(CHECKPOINTS)
CHECKPOINT_LABELS = {'incompleteness': '正しい入力が弾かれる場面を作る', 'unsoundness': '範囲外の入力が通る例を作る', 'privacy-leak': '記録から証拠の値を読み取る', 'property-matrix': '3 つの検証者を性質で分類する', 'transfer': '別の数値でも成立させる'}


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
            with urlopen(request, timeout=VERIFIER_TIMEOUT_SECONDS) as response:  # noqa: S310
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
    # Author checkout fallback only. The participant image has no fixtures package.
    try:
        from fixtures.generate import public_payload
    except ImportError:
        return None
    return public_payload(SEED)


def starter_payload() -> dict[str, str]:
    """Return the two editable files shipped to the Portal editor."""
    return {
        name: (ROOT / "starter" / name).read_text(encoding="utf-8") for name in SUBMISSION_FILES
    }


def config_payload() -> dict[str, object]:
    """Declare the generic editor contract consumed by the Participant Portal."""
    return {
        "id": "ac26-bridge-properties",
        "name": "満たす性質、破る性質",
        "description": '3 つの検証者（入力を受理・拒否するプログラム）を監査する。証拠を確認し、正しい入力・範囲外の入力・記録を比べ、反例を作るコードで 3 つの性質を確かめる。',
        "submittedFiles": list(SUBMISSION_FILES),
        "checkpoints": [
            {
                "id": checkpoint,
                "label": CHECKPOINT_LABELS[checkpoint],
                "kind": "code" if checkpoint in CODE_CHECKPOINTS else "answer",
            }
            for checkpoint in CHECKPOINTS
        ],
        # 英語は Portal 側の locale が選ぶ (共有 workbench.py の config_payload と同じ契約)。
        # Keep these problem-local labels aligned with metadata.json by checkpoint ID.
        "i18n": {
            "en": {
                "name": 'What it holds, what it breaks',
                "description": 'Audit three verifiers: programs that accept or reject an input. Inspect their checks and records, then write counterexamples to distinguish three properties.',
                "checkpointLabels": {'incompleteness': 'Make a valid input get rejected', 'unsoundness': 'Make an out-of-range input get accepted', 'privacy-leak': 'Read the witness from the record', 'property-matrix': 'Classify the three verifiers by property', 'transfer': 'Make the same code work on different numbers'},
            }
        },
    }


def inspect_payload() -> dict[str, object]:
    """This deployment's public evidence, as fetched from the verifier."""
    payload = fetch_public()
    if payload is None:
        return {"error": "public evidence unavailable"}
    return payload


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


def run_public_tests(files: object) -> dict[str, object]:
    """Check output shapes using only the same public inputs shown by Inspect."""
    sources = _submission_sources(files)
    if sources is None:
        return {"passed": False, "output": "Both editable Python files are required."}
    public = fetch_public()
    if public is None:
        return {"passed": False, "output": "Public evidence unavailable; is the verifier running?"}
    calls = [{"function": "classify", "argument": alias} for alias in public["verifiers"]]
    calls.extend({"function": name, "argument": public["statement"]} for name in
                 ("incompleteness_witness", "unsoundness_witness"))
    calls.append({"function": "extract_witness", "argument": public["transcript"]})
    result = run_functions(sources, calls)
    values = result and result.get("values")
    if not isinstance(values, list) or len(values) != len(calls):
        return {"passed": False, "output": (result or {}).get("output") or "Functions did not return values within the execution limits."}
    matrix_size = len(public["verifiers"])
    matrix_ok = all(isinstance(value, dict) and set(value) == {"complete", "sound", "private"}
                    and all(type(item) is bool for item in value.values()) for value in values[:matrix_size])
    numbers_ok = all(type(value) is int for value in values[matrix_size:])
    passed = matrix_ok and numbers_ok
    detail = "public tests: all passed (shapes only; the starter passes too)" if passed else "Return three boolean keys from classify and integers from the other functions."
    return {"passed": passed, "output": result["output"] + "\n" + detail}


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
        with urlopen(request, timeout=VERIFIER_TIMEOUT_SECONDS) as response:  # noqa: S310
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


def proxy_prepare(
    files: object,
    prepare_url: str = VERIFIER_PREPARE_URL,
) -> dict[str, object]:
    """Ask the fixed internal prepare route for values derived from source and inputs."""
    if not prepare_url:
        return _prepare_fallback(files)
    payload = json.dumps({"files": files}, ensure_ascii=False).encode("utf-8")
    request = Request(
        prepare_url,
        data=payload,
        headers={"content-type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=VERIFIER_TIMEOUT_SECONDS) as response:  # noqa: S310
            response_body = response.read(MAX_BODY_BYTES + 1)
            if len(response_body) > MAX_BODY_BYTES:
                return {"ok": False, "output": "verifier response too large"}
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
        return {"ok": False, "output": "Submission preparation timed out or could not start."}
    if not isinstance(decoded, dict) or "ok" not in decoded:
        return {"ok": False, "output": "verifier returned an unexpected shape"}
    return decoded


def _prepare_fallback(files: object) -> dict[str, object]:
    """CI/author fallback for `proxy_prepare` -- see `fetch_public`'s docstring for why
    this can never resolve inside a built participant image."""
    sources = _submission_sources(files)
    if sources is None:
        return {"ok": False, "output": "Both editable Python files are required."}
    try:
        from verifier.server import prepare_submissions
    except ImportError:
        return {"ok": False, "output": "Submission preparation unavailable."}
    return prepare_submissions(SEED, files)


def prepare_submissions(files: object) -> dict[str, object]:
    sources = _submission_sources(files)
    if sources is None:
        return {"ok": False, "output": "Both editable Python files are required."}
    return proxy_prepare(files)


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
