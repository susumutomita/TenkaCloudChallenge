"""POST /verify — the scoring seam. Loopback only, stdlib only.

Same security contract as the AC26 template. Five of the six checkpoints run the
learner's policy.py against seeded circuits; `root-cause` grades a structured answer,
because the issue asks for a diagnosis that is machine-checkable rather than prose.
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
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fixtures.generate import (
    DROPPABLE,
    clean_witness,
    health_token,
    honest_witness,
    params,
    vulnerable_circuit,
)

ROOT = Path(__file__).resolve().parents[1]
SEED = os.environ.get("FLAG_SEED", "local-dev-seed")

MAX_BODY_BYTES = 256 * 1024
RUN_TIMEOUT_SECONDS = 20
MAX_ADDRESS_SPACE_BYTES = 512 * 1024 * 1024
MAX_PROCESSES = 64
MAX_OUTPUT_BYTES = 64 * 1024
#: Wall clock for reading a request body, so a stalled client cannot pin the server.
REQUEST_TIMEOUT_SECONDS = 15

CODE_CHECKPOINTS = {
    "build": ("check_build",),
    "audit": ("check_audit",),
    "exploit": ("check_exploit",),
    "repair": ("check_repair",),
    "mutation-transfer": (),
}
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
# Darwin does not change what participants run. See the same note in
# ac26-bridge-experiment's verifier.
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

    Same facts as `show.py`. The id of the dropped constraint stays out of the
    payload: finding it is the audit checkpoint.
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
    """Run Portal-edited Python with the verifier's existing resource limits."""
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


def _missing_constraint_id(seed: str, label: str = "public") -> str:
    """Which half of the is-zero gadget this deployment lacks.

    Read off the deployed circuit's own ids, not computed a second time from the
    seed independently of `vulnerable_circuit` -- if the two ever disagreed,
    grading would silently drift from the circuit the participant is actually
    looking at. This is the root-cause checkpoint's own ground truth, so unlike
    `vulnerable_circuit` it is not exported from `fixtures/generate.py`.
    """
    present = {str(c["id"]) for c in vulnerable_circuit(seed, label)}
    missing = [cid for cid in DROPPABLE if cid not in present]
    if len(missing) != 1:
        raise AssertionError(f"vulnerable_circuit for {seed!r}/{label!r} did not drop exactly one constraint")
    return missing[0]


_ALL_SIGNALS = frozenset({"revoked", "inv", "ok", "issuer_ok", "granted"})


def _referenced_signals(circuit: list[dict[str, object]]) -> set[str]:
    keys = ("signal", "value", "inv", "out", "left", "right")
    return {str(c[key]) for c in circuit for key in keys if key in c}


def _unconstrained_signals(seed: str, label: str = "public") -> frozenset[str]:
    """Signals the deployed circuit's surviving constraints never reference at all.

    Computed from the circuit's own structure so it cannot drift from what
    `vulnerable_circuit` actually ships. When `c-iszero-a` is missing, only `B`
    (`revoked * ok = 0`) survives and it never reads `inv` -- so *any* value
    other than the honest one is an equally correct root-cause diagnosis for
    that signal, which is why `_check_root_cause` treats membership here as a
    wildcard rather than requiring one canonical number (#527).
    """
    return frozenset(_ALL_SIGNALS - _referenced_signals(vulnerable_circuit(seed, label)))


def _expected_root_cause(seed: str) -> dict[str, object]:
    """The verifier's own ground truth for the root-cause checkpoint.

    Unlike `vulnerable_circuit`, this function's entire purpose is to know the
    answer, so -- unlike the input generators -- it is not exported from
    `fixtures/generate.py` and nothing on the participant's reading path (the
    public tests, the hidden tests) imports it. Only this checkpoint's own
    grading does.
    """
    prm = params(seed)
    p = prm["p"]
    baseline = honest_witness(prm)
    missing = _missing_constraint_id(seed)
    if missing == "c-iszero-b":
        after = {"ok": 1, "granted": prm["issuer_ok"] % p, "inv": 0}
    else:
        # c-iszero-a missing: only B survives, and B never reads `inv`. The
        # decision (ok, granted) does not have to move at all -- the exploit is
        # that `inv` stops meaning "the inverse of revoked" and nothing checks
        # it any more. `0` here is only a canonical example; `_check_root_cause`
        # accepts any value other than the honest one (#527).
        after = {"inv": 0}
    changes = [
        {"signal": name, "before": baseline[name], "after": value}
        for name, value in after.items()
        if baseline[name] != value
    ]
    return {"missingConstraintId": missing, "manipulatedSignals": changes}


def _check_root_cause(submission: object) -> bool:
    answer = submission
    if isinstance(answer, str):
        try:
            answer = json.loads(answer)
        except json.JSONDecodeError:
            return False
    if not isinstance(answer, dict):
        return False
    expected = _expected_root_cause(SEED)
    if answer.get("missingConstraintId") != expected["missingConstraintId"]:
        return False
    expected_by_signal = {c["signal"]: c for c in expected["manipulatedSignals"]}
    submitted = answer.get("manipulatedSignals")
    if not isinstance(submitted, list) or len(submitted) != len(expected_by_signal):
        return False
    wildcard = _unconstrained_signals(SEED)
    seen: set[str] = set()
    for entry in submitted:
        if not isinstance(entry, dict):
            return False
        name = entry.get("signal")
        if name not in expected_by_signal or name in seen:
            return False
        seen.add(name)
        exp = expected_by_signal[name]
        if entry.get("before") != exp["before"]:
            return False
        if name in wildcard:
            # Unconstrained by the deployed circuit: any value actually
            # different from the honest one is an equally valid diagnosis.
            if entry.get("after") == exp["before"]:
                return False
        elif entry.get("after") != exp["after"]:
            return False
    return True


RUNNER = """
import json, os, sys
sys.path.insert(0, {root!r})
sys.path.insert(0, {workspace!r})
from tests.hidden import check_policy
try:
    import policy
except Exception as error:
    print(json.dumps({{"failures": ["submission could not be imported: " + type(error).__name__]}}))
    sys.stdout.flush()
    os._exit(0)
phases = {phases!r}
if phases:
    failures = []
    for name in phases:
        failures.extend(getattr(check_policy, name)(policy, {seed!r}))
else:
    failures = check_policy.run(policy, {seed!r})
print(json.dumps({{"failures": failures}}))
sys.stdout.flush()
os._exit(0)
"""


def _run_submission(submission: object, phases: tuple[str, ...], seed: str) -> bool:
    source = submission
    if isinstance(source, dict):
        source = source.get("policy.py")
    if not isinstance(source, str) or not source.strip():
        return False
    sources = _submission_sources({"policy.py": source})
    if sources is None:
        return False
    result = _run_submission_script(sources, RUNNER, seed, phases=list(phases))
    if result is None or result[0] != 0:
        return False
    for line in reversed(result[1].splitlines()):
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        failures = payload.get("failures")
        return isinstance(failures, list) and len(failures) == 0
    return False


def evaluate(checkpoint_id: str, submission: object) -> bool:
    if checkpoint_id == "root-cause":
        return _check_root_cause(submission)
    if checkpoint_id in CODE_CHECKPOINTS:
        seed = f"{SEED}:transfer" if checkpoint_id == "mutation-transfer" else SEED
        return _run_submission(submission, CODE_CHECKPOINTS[checkpoint_id], seed)
    return False


class Handler(BaseHTTPRequestHandler):
    #: `StreamRequestHandler.setup` applies this to the socket before `rfile` is created,
    #: so it bounds `rfile.read` inside `do_POST` -- which a client that sends a
    #: content-length and then stops sending would otherwise block on forever, pinning
    #: this single-threaded server. Setting it here rather than in an overridden `setup`
    #: is deliberate: `self.connection` does not exist until the base `setup` has run.
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
        self._respond(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler's name
        path = urlsplit(self.path).path.rstrip("/") or "/"
        if path not in ("/verify", "/api/test", "/api/prepare"):
            self._respond(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("content-length", "0"))
        except ValueError:
            self._respond(400, {"error": "bad content-length"})
            return
        if length <= 0 or length > MAX_BODY_BYTES:
            self._respond(400, {"error": "bad content-length"})
            return
        try:
            body = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._respond(400, {"error": "bad json"})
            return
        except (TimeoutError, OSError):
            # A stalled body read, not a malformed one. Same fail-closed outcome.
            self._respond(400, {"error": "incomplete body"})
            return
        if not isinstance(body, dict):
            self._respond(400, {"error": "bad json"})
            return

        if path == "/api/test":
            self._respond(200, run_public_tests(SEED, body.get("files")))
            return
        if path == "/api/prepare":
            self._respond(200, prepare_submissions(SEED, body.get("files")))
            return

        checkpoint_id = body.get("checkpointId")
        if not isinstance(checkpoint_id, str) or checkpoint_id not in CHECKPOINTS:
            self._respond(200, {
                "checkpointId": checkpoint_id if isinstance(checkpoint_id, str) else "",
                "correct": False,
            })
            return
        try:
            correct = evaluate(checkpoint_id, body.get("submission"))
        except Exception:  # noqa: BLE001 - a broken checkpoint must not kill the verifier
            correct = False
        self._respond(200, {"checkpointId": checkpoint_id, "correct": correct})

    def log_message(self, *_args: object) -> None:
        """Silence the default access log; it would echo submissions."""

    def _respond(self, status: int, payload: dict[str, object]) -> None:
        encoded = json.dumps(payload).encode("utf-8")
        self._respond_bytes(status, encoded, "application/json")

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
    port = int(os.environ.get("VERIFY_PORT", "18094"))
    # Bind every interface *inside the container*, not the container's loopback. A published
    # port is forwarded to the container's bridge address, so a server listening only on
    # 127.0.0.1 inside the container accepts nothing from outside it — the connection is
    # opened and closed without a response, and the platform can never score the problem.
    #
    # The loopback restriction that matters is on the host, and it lives in
    # docker-compose.yml, which publishes `127.0.0.1:<port>:<port>`. Nothing outside this
    # machine can reach the verifier either way.
    HTTPServer(("0.0.0.0", port), Handler).serve_forever()  # noqa: S104 - see above


if __name__ == "__main__":
    main()
