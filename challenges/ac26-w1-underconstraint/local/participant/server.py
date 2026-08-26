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

`fixtures/` deliberately stays in the participant stage, unlike the constraint-lab
split: after #533 it hands back INPUTS only -- the deployed circuit, the policy
parameters and the two honest witnesses, all of which `make inspect` prints for the
learner anyway. Removing it would hide the problem statement, not an answer.
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

from fixtures.generate import (
    clean_witness,
    health_token,
    honest_witness,
    params,
    vulnerable_circuit,
)

ROOT = Path(__file__).resolve().parents[1]
SEED = os.environ.get("FLAG_SEED", "local-dev-seed")
PORT = int(os.environ.get("WORKBENCH_PORT", "18094"))
VERIFIER_URL = os.environ.get("VERIFIER_URL", "")

MAX_BODY_BYTES = 256 * 1024
RUN_TIMEOUT_SECONDS = 20
MAX_ADDRESS_SPACE_BYTES = 512 * 1024 * 1024
MAX_PROCESSES = 64
MAX_OUTPUT_BYTES = 64 * 1024
#: Wall clock for reading a request body, so a stalled client cannot pin the server.
REQUEST_TIMEOUT_SECONDS = 15

CHECKPOINTS = ("build", "audit", "exploit", "root-cause", "repair", "mutation-transfer")
SUBMISSION_FILES = ("policy.py",)
#: The five checkpoints whose portal submission is the learner's policy.py source.
CODE_CHECKPOINT_IDS = ("build", "audit", "exploit", "repair", "mutation-transfer")
CODE_CHECKPOINTS_FOR_PORTAL = frozenset(CODE_CHECKPOINT_IDS)
CHECKPOINT_LABELS = {
    "build": "ポリシーどおりの回路を組む",
    "audit": "足りない制約を特定する",
    "exploit": "偽の主張を通す witness を作る",
    "root-cause": "原因を構造化して提出する",
    "repair": "正常系を壊さずに塞ぐ",
    "mutation-transfer": "別の欠落でも成立させる",
}

# Darwin aliases RLIMIT_AS onto RLIMIT_RSS and refuses to set it, while still
# reporting RLIM_INFINITY for it. Setting it anyway raises inside `preexec_fn` and
# aborts the exec, so on a macOS checkout every submission run failed — including
# the reference. The lab runs on Linux, where the cap does apply, so skipping it on
# Darwin does not change what participants run.
_ADDRESS_SPACE_CAPPABLE = sys.platform.startswith("linux")


def _limits() -> None:
    if _ADDRESS_SPACE_CAPPABLE:
        resource.setrlimit(resource.RLIMIT_AS, (MAX_ADDRESS_SPACE_BYTES, MAX_ADDRESS_SPACE_BYTES))
    resource.setrlimit(resource.RLIMIT_NPROC, (MAX_PROCESSES, MAX_PROCESSES))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_OUTPUT_BYTES, MAX_OUTPUT_BYTES))


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
        "description": "不足した constraint を監査・悪用し、正常系を保ったまま修復する。",
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
                "description": 'A credential circuit was stopped by audit just before production. Ordinary holders are judged correctly. But a forged witness may be able to walk around the condition. Build it, break it, fix it.',
                "checkpointLabels": {'build': 'Build the circuit the policy intends', 'audit': 'Identify the missing constraint', 'exploit': 'Forge a witness that carries a false claim', 'root-cause': 'Submit the root cause in structured form', 'repair': 'Close the gap without breaking the honest cases', 'mutation-transfer': 'Hold up when a different constraint is missing'},
            }
        },
    }


def inspect_payload(seed: str) -> dict[str, object]:
    """Build the seeded evidence shown by the browser's inspect command.

    Same facts as `show.py`, from the same input generators. The id of the dropped
    constraint stays out of the payload: finding it is the audit checkpoint. The
    root-cause diagnosis is not derivable here at all -- the function that knows it
    lives in the verifier image, which this process only ever talks to over HTTP.
    """
    prm = params(seed)
    return {
        "policy": "grant access iff the revocation counter is zero AND the issuer is recognised",
        "parameters": prm,
        "deployedCircuit": vulnerable_circuit(seed),
        "honestWitnesses": {
            "revokedCredential": honest_witness(prm),
            "cleanCredential": clean_witness(prm),
        },
        "iszeroGadget": {
            "iszero_a": "value * inv + out - 1 = 0",
            "iszero_b": "value * out = 0",
        },
        "healthToken": health_token(seed),
    }


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
    sources: dict[str, str], script: str, seed: str, **extra: object
) -> tuple[int, str] | None:
    """Run Portal-edited Python with the Workbench's resource limits.

    Same shape as the verifier's runner of the same name, deliberately: this one only
    ever runs the *public* suite, which the learner can run themselves with
    `make test`, so it never sees a hidden check or an expected value.
    """
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
                        script.format(root=str(ROOT), workspace=workspace, seed=seed, **extra),
                    ],
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


PUBLIC_TEST_SCRIPT = """
import os, runpy
os.environ["FLAG_SEED"] = {seed!r}
os.environ["SUBMISSION_DIR"] = {workspace!r}
os.environ["BROWSER_PUBLIC_TESTS"] = "1"
runpy.run_path({root!r} + "/tests/public/test_policy.py", run_name="__main__")
"""


def run_public_tests(seed: str, files: object) -> dict[str, object]:
    """Run the same checks as `make test` against the Portal-edited source."""
    sources = _submission_sources(files)
    if sources is None:
        return {"passed": False, "output": "policy.py must be a non-empty Python file."}
    result = _run_submission_script(sources, PUBLIC_TEST_SCRIPT, seed)
    if result is None:
        return {"passed": False, "output": "Public tests timed out or could not start."}
    return {"passed": result[0] == 0, "output": result[1]}


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
    return {"checkpointId": checkpoint_id, "correct": decoded["correct"]}


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
    # Bind every interface *inside the container*, not the container's loopback: a
    # published port is forwarded to the container's bridge address. The loopback
    # restriction that matters is on the host, and it lives in docker-compose.yml.
    HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()  # noqa: S104 - see above


if __name__ == "__main__":
    main()
