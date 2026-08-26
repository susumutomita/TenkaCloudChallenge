"""Public Participant Workbench and fail-closed verifier proxy.

This process carries the starter, the public tests and `show.py` -- and nothing that
grades. Every `/verify` request is forwarded to the Compose-internal verifier, and any
missing or invalid verifier response becomes a canonical `correct: false` verdict.

Issue 537/538 (Issue 543 option B2): the Portal editor API below used to live in
`verifier/server.py`, in the single Docker stage a learner's own `make build` produced --
the same image that carried `tests/hidden/check_assertion.py` and the process that runs
it. All three checkpoints are graded by running that suite against the submitted file, so
the person being graded could read the assertions, including the exact one-reason verdict
strings `starter/assertion.py` only describes. `fixtures/` left that stage too: it
implements `signed_message` under the exact name the starter's own stub asks the learner
to write, and `fixture()` labels every assertion by kind for any seed -- and a learner
knows their own `FLAG_SEED`, so the hidden suite's derived seeds are enumerable from it.
The two together answered all three checkpoints from a lookup table, with no WebAuthn
reasoning at all.

`show.py` and the public tests read this deployment's public half from the verifier's
`GET /public` instead (see show.py, tests/public/test_assertion.py, and the
VERIFIER_PUBLIC_URL wiring in ../docker-compose.yml).

The Portal editor payloads below are authored per problem rather than generated from the
shared adapter, exactly as they were in `verifier/server.py`; only the file they live in
changed. `scripts/generate-course-workbenches.py --check` is what keeps their English in
step with `metadata.json`.
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

ROOT = Path(__file__).resolve().parents[1]
PROBLEM_ID = "ac26-w3-passkey-assertion"
SEED = os.environ.get("FLAG_SEED", "local-dev-seed")
PORT = int(os.environ.get("WORKBENCH_PORT", "18121"))
VERIFIER_URL = os.environ.get("VERIFIER_URL", "")
VERIFIER_PUBLIC_URL = os.environ.get("VERIFIER_PUBLIC_URL", "")

MAX_BODY_BYTES = 256 * 1024
RUN_TIMEOUT_SECONDS = 10
MAX_ADDRESS_SPACE_BYTES = 512 * 1024 * 1024
MAX_PROCESSES = 64
MAX_OUTPUT_BYTES = 64 * 1024
#: Wall clock for reading a request body, so a stalled client cannot pin the server.
REQUEST_TIMEOUT_SECONDS = 15

CHECKPOINTS = ("signature", "find-uv-gap", "enforce-uv")
CODE_CHECKPOINTS = CHECKPOINTS
SUBMISSION_FILES = ("assertion.py",)

# Darwin aliases RLIMIT_AS onto RLIMIT_RSS and refuses to set it, while still
# reporting RLIM_INFINITY for it. Setting it anyway raises inside `preexec_fn`,
# which aborts the exec -- so on a macOS checkout the address-space cap turned
# every public-test run into "could not run at all", including the reference.
#
# The lab itself is python:3.13-slim on Linux, where this cap does apply.
_ADDRESS_SPACE_CAPPABLE = sys.platform.startswith("linux")


def _limits() -> None:
    """Applied inside the child, before exec. Caps memory, processes, and file size."""
    if _ADDRESS_SPACE_CAPPABLE:
        resource.setrlimit(resource.RLIMIT_AS, (MAX_ADDRESS_SPACE_BYTES, MAX_ADDRESS_SPACE_BYTES))
    resource.setrlimit(resource.RLIMIT_NPROC, (MAX_PROCESSES, MAX_PROCESSES))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_OUTPUT_BYTES, MAX_OUTPUT_BYTES))


def config_payload() -> dict[str, object]:
    """Declare the generic Participant Portal editor contract."""
    return {
        "id": "ac26-w3-passkey-assertion",
        "name": "署名は正しい。それでも拒否する。",
        "description": "パスキー assertion の署名検証と UV 必須ポリシーを分けて実装する。",
        "submittedFiles": list(SUBMISSION_FILES),
        "checkpoints": [
            {"id": checkpoint, "label": checkpoint, "kind": "code"}
            for checkpoint in CHECKPOINTS
        ],
        # 英語は Portal 側の locale が選ぶ (共有 workbench.py の config_payload と同じ契約)。
        # 文言の正本は metadata.json — scripts/generate-course-workbenches.py --check が
        # 乖離を落とす (#381)。 この payload は手書きなので、 直すときはここを編集する。
        "i18n": {
            "en": {
                "name": 'The signature is valid. Reject it anyway.',
                "description": 'Verify a passkey assertion on the server with only the public key. Then find a cryptographically valid assertion whose user-verification bit is zero and reject it under a UV-required policy. Keep cryptographic validity separate from authentication policy.',
                "checkpointLabels": {'signature': 'Verify the assertion signature with the public key', 'find-uv-gap': 'Select the valid signature made without user verification', 'enforce-uv': 'Complete a server verdict that requires user verification'},
            }
        },
    }


def starter_payload() -> dict[str, str]:
    """Return the editable file shipped to the Portal editor."""
    return {
        name: (ROOT / "starter" / name).read_text(encoding="utf-8") for name in SUBMISSION_FILES
    }


def public_evidence(verifier_public_url: str = "") -> dict[str, object]:
    """This deployment's public half, fetched from the verifier's `GET /public`.

    `fixtures/` is not in this image (Issue 543 option B2), so there is nothing local to
    derive it from. A deployment always sets VERIFIER_PUBLIC_URL; when it is unset this
    raises, and every caller turns that into a message naming the missing service rather
    than a traceback.
    """
    url = verifier_public_url or VERIFIER_PUBLIC_URL
    if not url:
        raise RuntimeError("VERIFIER_PUBLIC_URL is not set")
    # VERIFIER_PUBLIC_URL is a trusted Compose-only environment value.
    with urlopen(url, timeout=REQUEST_TIMEOUT_SECONDS) as response:  # noqa: S310
        return json.loads(response.read(MAX_BODY_BYTES).decode("utf-8"))


def inspect_payload(seed: str = SEED) -> dict[str, object]:
    """Return only the relying-party record and received assertions.

    The credential private key is not in this payload. Nor are the fixture kind labels:
    the learner's code has to determine which assertion has a valid signature and UV=0.
    The shape is what it has always been -- `{"serverRecord": ..., "assertions": [...]}`
    -- it is now read from the verifier rather than derived here.
    """
    del seed  # the verifier serves its own deployment's evidence; this process has none
    try:
        payload = public_evidence()
    except (HTTPError, URLError, TimeoutError, OSError, ValueError, RuntimeError) as error:
        return {
            "error": (
                "this deployment's verifier is unreachable "
                f"({type(error).__name__}); start it with `make verifier-up`"
            )
        }
    deployment = payload.get("deployment")
    return deployment if isinstance(deployment, dict) else {"error": "malformed public evidence"}


def _child_env(**extra: str) -> dict[str, str]:
    """The fixed environment `show.py` and the public tests run under.

    Built from nothing rather than inherited, so a Portal run cannot pick up whatever
    this process happens to carry. The one value forwarded is VERIFIER_PUBLIC_URL: since
    Issue 543 option B2 those two scripts have no local way to derive this deployment's
    public evidence and fetch it from the Compose-internal verifier instead.
    """
    env = {
        "PATH": "/usr/local/bin:/usr/bin:/bin",
        "PYTHONDONTWRITEBYTECODE": "1",
        **extra,
    }
    if VERIFIER_PUBLIC_URL:
        env["VERIFIER_PUBLIC_URL"] = VERIFIER_PUBLIC_URL
    return env


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


def _run_submission_script(
    sources: dict[str, str], script: str, seed: str
) -> tuple[int, str] | None:
    """Run Portal-edited Python with the same resource limits the verifier applies."""
    with tempfile.TemporaryDirectory() as workspace:
        for name, text in sources.items():
            (Path(workspace) / name).write_text(text, encoding="utf-8")
        transcript = Path(workspace) / "stdout"
        try:
            # stdout goes to a real file, not a pipe. RLIMIT_FSIZE only bounds writes to
            # files, so with `capture_output=True` a submission that printed gigabytes
            # would have them buffered in THIS process before the tail slice threw them
            # away. Writing to a file inside the workspace makes the cap actually bind:
            # the child is killed by SIGXFSZ at the limit instead.
            with transcript.open("w", encoding="utf-8") as sink:
                completed = subprocess.run(  # noqa: S603 - argument list, shell=False
                    [
                        sys.executable,
                        "-I",
                        "-c",
                        script.format(root=str(ROOT), workspace=workspace, seed=seed),
                    ],
                    stdout=sink,
                    stderr=subprocess.STDOUT,
                    text=True,
                    timeout=RUN_TIMEOUT_SECONDS,
                    preexec_fn=_limits,
                    cwd=workspace,
                    env=_child_env(),
                    check=False,
                )
            captured = transcript.read_text(encoding="utf-8", errors="replace")
        except (subprocess.TimeoutExpired, OSError, ValueError):
            return None
    return completed.returncode, captured[-MAX_OUTPUT_BYTES:]


PUBLIC_TEST_SCRIPT = """
import os, runpy
os.environ["FLAG_SEED"] = {seed!r}
os.environ["SUBMISSION_DIR"] = {workspace!r}
os.environ["BROWSER_PUBLIC_TESTS"] = "1"
runpy.run_path({root!r} + "/tests/public/test_assertion.py", run_name="__main__")
"""


def run_public_tests(seed: str, files: object) -> dict[str, object]:
    """Run the same checks as `make test` against the Portal-edited source."""
    sources = _submission_sources(files)
    if sources is None:
        return {"passed": False, "output": "assertion.py must be a non-empty Python file."}
    result = _run_submission_script(sources, PUBLIC_TEST_SCRIPT, seed)
    if result is None:
        return {"passed": False, "output": "Public tests timed out or could not start."}
    return {"passed": result[0] == 0, "output": result[1]}


def prepare_submissions(seed: str, files: object) -> dict[str, object]:
    """The same source is evaluated independently by all three checkpoints."""
    del seed  # every checkpoint here is graded on the file itself; nothing is sealed
    sources = _submission_sources(files)
    if sources is None:
        return {"ok": False, "output": "assertion.py must be a non-empty Python file."}
    source = sources["assertion.py"]
    return {
        "ok": True,
        "submissions": {checkpoint: source for checkpoint in CHECKPOINTS},
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
    """Forward one verdict request inward. Anything unexpected fails closed."""
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
            self._respond(200, inspect_payload(SEED))
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
        """Silence the default stderr access log; it would echo submissions."""

    def _respond(self, status: int, payload: dict[str, object]) -> None:
        self._respond_bytes(
            status,
            json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            "application/json; charset=utf-8",
        )

    def _respond_bytes(self, status: int, encoded: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("content-type", content_type)
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
    # Bind every interface *inside the container*, not the container's loopback. A
    # published port is forwarded to the container's bridge address, so a server
    # listening only on 127.0.0.1 inside the container accepts nothing from outside it.
    # The loopback restriction that matters is on the host, and it lives in
    # docker-compose.yml, which publishes `127.0.0.1:<port>:<port>`.
    HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()  # noqa: S104 - see above


if __name__ == "__main__":
    main()
