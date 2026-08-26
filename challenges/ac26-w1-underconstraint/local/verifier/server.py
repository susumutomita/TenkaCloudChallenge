"""POST /verify — the scoring seam. Compose-internal only, stdlib only.

Same security contract as the AC26 template. Five of the six checkpoints run the
learner's policy.py against seeded circuits; `root-cause` grades a structured answer,
because the issue asks for a diagnosis that is machine-checkable rather than prose.

Issue 525/543/537: this file used to ship in the participant Docker stage, alongside
the Portal editor API it also hosted. `_expected_root_cause` below returns exactly the
JSON the `root-cause` checkpoint accepts, keyed by a seed the learner already holds in
their own container's `FLAG_SEED` — so a learner who opened this file could copy that
checkpoint's answer out of the image their own `make build` produced. It now runs in a
separate image that is never published to the host: the participant-facing Workbench
(`participant/server.py`) owns the Portal editor routes and forwards `/verify` here
over the internal Compose network. Nothing participant-facing is served from this
process any more.
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
        # Compose's healthcheck, and nothing else. The Portal editor routes moved to
        # participant/server.py with the split: serving any of them from here would put
        # this image back on the participant's reading path, which is the whole thing
        # Issue 525/543 is about.
        if path == "/healthz":
            self._respond(200, {"ok": True})
            return
        self._respond(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler's name
        path = urlsplit(self.path).path.rstrip("/") or "/"
        if path != "/verify":
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
