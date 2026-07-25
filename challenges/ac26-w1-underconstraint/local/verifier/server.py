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

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fixtures.generate import (
    clean_witness,
    dropped_constraint,
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

CODE_CHECKPOINTS = {
    "build": ("check_build",),
    "audit": ("check_audit",),
    "exploit": ("check_exploit",),
    "repair": ("check_repair",),
    "mutation-transfer": (),
}
CHECKPOINTS = ("build", "audit", "exploit", "root-cause", "repair", "mutation-transfer")


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


def _manipulated_signals() -> list[str]:
    """Signals whose forged value differs from the honest one, for this seed's drop."""
    prm = params(SEED)
    dropped = dropped_constraint(SEED)
    if dropped == "c-iszero-b":
        baseline = honest_witness(prm)
        forged = {"revoked": prm["revoked"] % prm["p"], "inv": 0, "ok": 1,
                  "issuer_ok": prm["issuer_ok"], "granted": prm["issuer_ok"]}
    else:
        baseline = clean_witness(prm)
        forged = {"revoked": 0, "inv": 0, "ok": 0,
                  "issuer_ok": prm["issuer_ok"], "granted": 0}
    return sorted(k for k in baseline if baseline[k] != forged.get(k))


def _check_root_cause(submission: object) -> bool:
    answer = submission
    if isinstance(answer, str):
        try:
            answer = json.loads(answer)
        except json.JSONDecodeError:
            return False
    if not isinstance(answer, dict):
        return False
    if str(answer.get("missingConstraintId", "")).strip() != dropped_constraint(SEED):
        return False
    signals = answer.get("manipulatedSignals")
    if not isinstance(signals, list):
        return False
    return sorted(str(s).strip() for s in signals) == _manipulated_signals()


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
    if len(source) > MAX_BODY_BYTES:
        return False
    with tempfile.TemporaryDirectory() as workspace:
        (Path(workspace) / "policy.py").write_text(source, encoding="utf-8")
        script = RUNNER.format(
            root=str(ROOT), workspace=workspace, phases=list(phases), seed=seed
        )
        try:
            completed = subprocess.run(  # noqa: S603 - argument list, shell=False
                [sys.executable, "-I", "-c", script],
                capture_output=True,
                text=True,
                timeout=RUN_TIMEOUT_SECONDS,
                preexec_fn=_limits,
                cwd=workspace,
                env={"PATH": "/usr/local/bin:/usr/bin:/bin"},
                check=False,
            )
        except (subprocess.TimeoutExpired, OSError):
            return False
    if completed.returncode != 0:
        return False
    for line in reversed(completed.stdout[-MAX_OUTPUT_BYTES:].splitlines()):
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
    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler's name
        if self.path.rstrip("/") != "/verify":
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
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


def main() -> None:
    port = int(os.environ.get("VERIFY_PORT", "18094"))
    HTTPServer(("127.0.0.1", port), Handler).serve_forever()


if __name__ == "__main__":
    main()
