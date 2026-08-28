"""Public Participant Workbench: the Portal editor API, a fail-closed verifier proxy,
and nothing that can derive an answer.

This process never grades a checkpoint locally -- every `/verify` request is forwarded
to the Compose-internal verifier, and any missing or invalid verifier response becomes
a canonical `correct: false` verdict (see `proxy_verdict`). It also carries no seed-
derived fixtures of its own: `GET /api/inspect`, the public-test run, and the
`environment` checkpoint's pass phrase all need this deployment's public evidence, and
that evidence is fetched from the verifier's `GET /public` at runtime (see
`fetch_public`) rather than computed here.

Issue 543/537: `fixtures/generate.py` used to ship in this same Docker stage, because
`show.py` and the public tests need the token, claims, keys and decision log it derives.
That alone was enough to leak `window`'s and `audit`'s answers even after their
derivation moved into `verifier/expected.py` (verifier-only) -- `validity_window` and
the row-level generation logic behind `decision_log` are plain, seed-keyed functions,
and a learner already has the seed (`FLAG_SEED`, their own container's environment), so
keeping the generator reachable here left the answer one `import` away regardless of
where the comparison itself lived. `fixtures/` is not copied into the `participant`
Docker stage at all any more (see ../Dockerfile); this file has no way to reconstruct
that deployment's evidence except by asking the verifier for it, which is the same
thing the Portal and `show.py` ask for.
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
PORT = int(os.environ.get("WORKBENCH_PORT", "18300"))
VERIFIER_URL = os.environ.get("VERIFIER_URL", "")
#: Derived from VERIFIER_URL (which points at /verify) rather than a second required
#: env var: the two routes always name the same host and port in every deployment this
#: problem ships, and a second knob that can drift from the first is one more way to
#: misconfigure the split.
VERIFIER_PUBLIC_URL = VERIFIER_URL.rsplit("/", 1)[0] + "/public" if VERIFIER_URL else ""

MAX_BODY_BYTES = 256 * 1024
RUN_TIMEOUT_SECONDS = 10
MAX_ADDRESS_SPACE_BYTES = 512 * 1024 * 1024
MAX_PROCESSES = 64
MAX_OUTPUT_BYTES = 64 * 1024
REQUEST_TIMEOUT_SECONDS = 15

CHECKPOINTS = ("environment", "window", "audit", "verify", "isolate", "generalize")
SUBMISSION_FILES = ("authorize.py",)
CODE_CHECKPOINTS = frozenset(("verify", "isolate", "generalize"))
CHECKPOINT_LABELS = {
    "environment": "environment — Portal editor が出す合言葉を、そのまま貼る",
    "window": "window — この token が通る最初と最後の now を [最初, 最後] で",
    "audit": "audit — gateway が allow したうち、通してはいけなかった行の番号を昇順で",
    "verify": "verify — この gateway が発行した token かどうかを判定できる authorize.py",
    "isolate": "isolate — token は本物として、この要求を通してよいかを判定できる authorize.py",
    "generalize": "generalize — 書き上げた authorize.py の中身を、全部",
}


def _limits() -> None:
    if sys.platform.startswith("linux"):
        resource.setrlimit(resource.RLIMIT_AS, (MAX_ADDRESS_SPACE_BYTES, MAX_ADDRESS_SPACE_BYTES))
    resource.setrlimit(resource.RLIMIT_NPROC, (MAX_PROCESSES, MAX_PROCESSES))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_OUTPUT_BYTES, MAX_OUTPUT_BYTES))


def fetch_public(
    seed: str = SEED, verifier_public_url: str = VERIFIER_PUBLIC_URL
) -> dict[str, object] | None:
    """This deployment's public evidence, fetched from the verifier over the network.

    Never returns anything `verifier/server.py`'s own `/public` route would not: this
    is a plain relay, not a second implementation. `None` means the network path could
    not be used -- most callers turn that into a fail-closed response rather than
    guessing.

    `seed` only ever matters for the fallback branch below: the network path always
    answers for whatever seed the live verifier was started with, which for a real
    deployment is always this same `SEED`. It exists so `inspect_payload` can accept a
    seed argument at all -- `scripts/cs-foundations-evidence.test.ts` calls every
    problem's `inspect_payload` the same way, and some of this catalog's problems
    compute it locally, seed and all, with no verifier involved.
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
    # 543/537's leak. `scripts/cs-auth-claim-audit.test.ts` exercises this file without
    # a live verifier and relies on exactly this fallback.
    try:
        from fixtures.generate import public_payload
    except ImportError:
        return None
    return public_payload(seed)


def starter_payload() -> dict[str, str]:
    """Return the editable file shipped to the Portal editor."""
    return {
        name: (ROOT / "starter" / name).read_text(encoding="utf-8") for name in SUBMISSION_FILES
    }


def config_payload() -> dict[str, object]:
    """Declare the generic editor contract consumed by the Participant Portal."""
    return {
        "id": "cs-auth-claim-audit",
        "name": "署名は通った。それは、その要求を通してよいという意味ではない",
        "description": "壊れた API gateway の決定ログを監査し、署名検証を通り抜けた要求を特定して、gateway を書き直す。",
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
                "name": 'The signature checked out. That is not the same as the request being allowed',
                "description": "A gateway refuses expired tokens, refuses forged ones, refuses actions outside a token's scope -- and has been letting one tenant read another tenant's documents for months. Audit its decision log, find the requests that got through, and write the gateway that would have stopped them.",
                "checkpointLabels": {'environment': 'environment - the pass phrase the Portal editor prints, pasted exactly', 'window': 'window - the first and last `now` this token is accepted at, as [first, last]', 'audit': 'audit - the indices the gateway allowed that it should have refused, ascending', 'verify': 'verify - an authorize.py that can tell whether this gateway issued the token', 'isolate': 'isolate - an authorize.py that decides, given a genuine token, whether the request may proceed', 'generalize': 'generalize - your finished authorize.py, all of it'},
            }
        },
    }


def inspect_payload(seed: str = SEED) -> dict[str, object]:
    """This deployment's public evidence, as fetched from the verifier.

    Same fields `show.py` prints. `window` and `audit`'s answers stay out of it -- and
    this process has no way to produce them anyway: only `verifier/expected.py` and
    `fixtures.generate.validity_window`, neither of which ships here, hold them.

    Accepts a `seed` for the same reason `fetch_public` does -- see its docstring. The
    Portal and `do_GET` below never pass one, so a real deployment always gets its own.

    Adds the interpreter version to `environment`, which `show.py`'s CLI output does
    not carry (it has no reason to print its own Python version back at whoever is
    already running it) but the Portal always has -- `scripts/cs-foundations-evidence
    .test.ts` strips this one field back off before asserting the two surfaces match.
    """
    payload = fetch_public(seed)
    if payload is None:
        return {"error": "public evidence unavailable"}
    environment = payload.get("environment")
    if isinstance(environment, dict):
        payload["environment"] = {"python": sys.version.split()[0], **environment}
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


def _public_test_script(source: str, public: dict[str, object]) -> str:
    """Build the sandboxed script that runs the public suite against `source`.

    The learner's file and this deployment's already-fetched public evidence are both
    embedded as literals (`repr`/`json.dumps`, never interpolated into anything that
    runs as a shell command) rather than written where the submission's own imports
    could reach them: the child process never touches the network or the verifier
    itself, only the values this process already fetched on its behalf.
    """
    return "\n".join(
        [
            "import os, runpy, tempfile",
            f"os.environ['FLAG_SEED'] = {SEED!r}",
            f"os.environ['PUBLIC_EVIDENCE_JSON'] = {json.dumps(public)!r}",
            "os.environ['BROWSER_PUBLIC_TESTS'] = '1'",
            "workspace = tempfile.mkdtemp()",
            f"open(workspace + '/authorize.py', 'w', encoding='utf-8').write({source!r})",
            "os.environ['SUBMISSION_DIR'] = workspace",
            f"runpy.run_path({str(ROOT)!r} + '/tests/public/test_authorize.py', run_name='__main__')",
        ]
    )


def run_public_tests(files: object) -> dict[str, object]:
    """Run the same checks as `make test` against the Portal-edited source."""
    sources = _submission_sources(files)
    if sources is None:
        return {"passed": False, "output": "authorize.py must be a non-empty Python file."}
    public = fetch_public()
    if public is None:
        return {"passed": False, "output": "Public evidence unavailable; is the verifier running?"}
    result = _run_script(_public_test_script(sources["authorize.py"], public))
    if result is None:
        return {"passed": False, "output": "Public tests timed out or could not start."}
    return {"passed": result[0] == 0, "output": result[1]}


def prepare_submissions(files: object) -> dict[str, object]:
    """Format the portal values the workbench can produce from the editor.

    `window` and `audit` are deliberately absent. The first is read off the claims and
    turned into a half-open interval by hand; the second is the audit itself. Producing
    either here would erase exactly what those two checkpoints measure, and they are
    the two that carry the point of the problem.

    The three code checkpoints all submit the same file. They are separate checkpoints
    because they are scored against different hidden phases, not because they take
    different input.
    """
    sources = _submission_sources(files)
    if sources is None:
        return {"ok": False, "output": "authorize.py must be a non-empty Python file."}
    public = fetch_public()
    if public is None:
        return {"ok": False, "output": "Public evidence unavailable; is the verifier running?"}
    source = sources["authorize.py"]
    return {
        "ok": True,
        "submissions": {
            "environment": public["environment"]["healthToken"],
            "verify": source,
            "isolate": source,
            "generalize": source,
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
    # Host reachability is restricted by docker-compose.yml to the loopback publish.
    HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()  # noqa: S104


if __name__ == "__main__":
    main()
