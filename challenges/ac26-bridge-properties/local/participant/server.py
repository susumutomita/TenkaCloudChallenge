"""Public Participant Workbench: the Portal editor API, a fail-closed verifier proxy,
and nothing that can derive an answer.

This process never grades a checkpoint locally -- every `/verify` request is forwarded
to the Compose-internal verifier, and any missing or invalid verifier response becomes
a canonical `correct: false` verdict (see `proxy_verdict`). `POST /api/prepare` is
proxied the same way, to the verifier's own `/prepare`: preparing the five portal
fields means running the learner's own `classify.py` / `counterexamples.py` against
`boundary_instance`, which is deliberately never disclosed elsewhere, so that has to
happen wherever `fixtures/` lives -- not here (see `proxy_prepare`).

This process carries no seed-derived fixtures of its own: `GET /api/inspect` and the
public-test run both need this deployment's public evidence, fetched from the
verifier's `GET /public` at runtime (see `fetch_public`) rather than computed here.

Issue 543/537: `fixtures/generate.py` used to ship in this same Docker stage, because
`show.py` and the public tests need the statement, the verifiers and the leaky
transcript it derives. That alone was enough to leak `privacy-leak`'s answer even
after `instance(seed).witness` stayed the only place it was compared -- `instance` and
`boundary_instance` are plain, seed-keyed functions, and a learner already has the
seed (`FLAG_SEED`, their own container's environment), so keeping the generator
reachable here left both answers one `import` away regardless of where the comparison
itself lived. `fixtures/` is not copied into the `participant` Docker stage at all any
more (see ../Dockerfile); this file has no way to reconstruct that deployment's
evidence except by asking the verifier for it, which is the same thing the Portal and
`show.py` ask for.
"""

from __future__ import annotations

import json
import os
import resource
import subprocess
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

ROOT = Path(__file__).resolve().parents[1]
SEED = os.environ.get("FLAG_SEED", "local-dev-seed")
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

CHECKPOINTS = ("incompleteness", "unsoundness", "privacy-leak", "property-matrix", "transfer")
SUBMISSION_FILES = ("classify.py", "counterexamples.py")
CODE_CHECKPOINTS = frozenset(("transfer",))
CHECKPOINT_LABELS = {
    "incompleteness": "正しい入力が弾かれる場面を作る",
    "unsoundness": "主張の範囲外を通してしまう例を作る",
    "privacy-leak": "transcript から秘密を取り出す",
    "property-matrix": "3 つの verifier を性質で分類する",
    "transfer": "見たことのない instance でも成立させる",
}


def _limits() -> None:
    if sys.platform.startswith("linux"):
        resource.setrlimit(resource.RLIMIT_AS, (MAX_ADDRESS_SPACE_BYTES, MAX_ADDRESS_SPACE_BYTES))
    resource.setrlimit(resource.RLIMIT_NPROC, (MAX_PROCESSES, MAX_PROCESSES))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_OUTPUT_BYTES, MAX_OUTPUT_BYTES))


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
    # Falls through when VERIFIER_URL is unset or the verifier could not be reached --
    # which `docker-compose.yml`'s `depends_on: verifier: condition: service_healthy`
    # means never happens for a real deployment. The one place this fallback resolves
    # is a checkout with `fixtures/` still on disk (the repository itself, or someone
    # running this file straight from the verifier or author Docker stage): it can
    # never resolve inside a built `participant` image, where `fixtures/` is not copied
    # in at all (see ../Dockerfile) -- so this branch existing does not reopen Issue
    # 543/537's leak. `scripts/ac26-bridge-properties.test.ts` exercises this file
    # without a live verifier and relies on exactly this fallback.
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
        "description": "反例を作り、completeness・soundness・privacy を区別する。",
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
        # 文言の正本は metadata.json — scripts/generate-course-workbenches.py --check が
        # 乖離を落とす (#381)。 この payload は手書きなので、 直すときはここを編集する。
        "i18n": {
            "en": {
                "name": 'What it holds, what it breaks',
                "description": 'Three toy verifiers arrive for audit. All of them pass the happy-path tests. They are broken in different ways. Build counterexamples and classify what each one holds and what it breaks.',
                "checkpointLabels": {'incompleteness': 'Make a valid input get rejected', 'unsoundness': 'Get something outside the claim accepted', 'privacy-leak': 'Pull the secret out of a transcript', 'property-matrix': 'Classify the three verifiers by property', 'transfer': 'Hold up on instances you have not seen'},
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


def _run_script(script: str) -> tuple[int, str] | None:
    """Run a fully-built Python script (no learner file needed on disk) with the
    process's resource limits, in a throwaway workspace."""
    with tempfile.TemporaryDirectory() as workspace:
        transcript = Path(workspace) / "stdout"
        try:
            with transcript.open("w", encoding="utf-8") as sink:
                completed = subprocess.run(  # noqa: S603 - argument list, shell=False
                    [sys.executable, "-I", "-c", script],
                    stdout=sink,
                    stderr=subprocess.STDOUT,
                    text=True,
                    timeout=RUN_TIMEOUT_SECONDS,
                    preexec_fn=_limits,
                    cwd=workspace,
                    env={"PATH": "/usr/local/bin:/usr/bin:/bin"},
                    check=False,
                )
            captured = transcript.read_text(encoding="utf-8", errors="replace")
        except (subprocess.TimeoutExpired, OSError, ValueError):
            return None
    return completed.returncode, captured[-MAX_OUTPUT_BYTES:]


def _public_test_script(sources: dict[str, str], public: dict[str, object]) -> str:
    """Build the sandboxed script that runs the public suite against `sources`.

    The learner's files and this deployment's already-fetched public evidence are both
    embedded as literals (`repr`/`json.dumps`, never interpolated into anything that
    runs as a shell command) rather than written where the submission's own imports
    could reach them: the child process never touches the network or the verifier
    itself, only the values this process already fetched on its behalf.
    """
    writes = "\n".join(
        f"open(workspace + '/{name}', 'w', encoding='utf-8').write({text!r})"
        for name, text in sources.items()
    )
    return "\n".join(
        [
            "import os, runpy, tempfile",
            f"os.environ['FLAG_SEED'] = {SEED!r}",
            f"os.environ['PUBLIC_EVIDENCE_JSON'] = {json.dumps(public)!r}",
            "os.environ['BROWSER_PUBLIC_TESTS'] = '1'",
            "workspace = tempfile.mkdtemp()",
            writes,
            "os.environ['SUBMISSION_DIR'] = workspace",
            f"runpy.run_path({str(ROOT)!r} + '/tests/public/test_properties.py', run_name='__main__')",
        ]
    )


def run_public_tests(files: object) -> dict[str, object]:
    """Run the same shape checks as `make test` against Portal-edited sources."""
    sources = _submission_sources(files)
    if sources is None:
        return {"passed": False, "output": "Both editable Python files are required."}
    public = fetch_public()
    if public is None:
        return {"passed": False, "output": "Public evidence unavailable; is the verifier running?"}
    result = _run_script(_public_test_script(sources, public))
    if result is None:
        return {"passed": False, "output": "Public tests timed out or could not start."}
    return {"passed": result[0] == 0, "output": result[1]}


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


def proxy_prepare(
    files: object,
    prepare_url: str = VERIFIER_PREPARE_URL,
) -> dict[str, object]:
    """Ask the verifier to run the submitted files against the real instances.

    `prepare_submissions` used to run this in-process, because `fixtures/` was right
    there. It is not any more (Issue 543/537): the only place `boundary_instance` --
    the input `incompleteness` is checked against, never shown on the wire -- can be
    reached from is the verifier, so the whole computation moves there and this
    process only relays the request and validates the shape of what comes back.
    """
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
        with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:  # noqa: S310
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
    # Host reachability is restricted by docker-compose.yml to the loopback publish.
    HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()  # noqa: S104


if __name__ == "__main__":
    main()
