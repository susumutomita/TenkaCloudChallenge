"""Challenge surface (:8080) and the loopback /verify endpoint (:8081).

/verify contract (multi-verify):
    POST {"checkpointId": "...", "submission": "..."}
    ->   {"checkpointId": "...", "correct": bool, "message": "..."}

The response echoes `checkpointId` so a mismatch is visible, and never contains a
hidden case, an expected value, or a reference result — a failure message that
narrows the answer turns the checkpoint into a guessing game.
"""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread

import fixtures
from participant import ParticipantError, run_advance

MAX_BODY_BYTES = 64 * 1024

CHECKPOINTS = ("environment", "predict", "first-divergence", "general-counter")


def _as_int(text: str) -> int | None:
    try:
        return int(text.strip())
    except (TypeError, ValueError):
        return None


def _check_environment(submission: str) -> tuple[bool, str]:
    if submission.strip() == fixtures.environment_marker():
        return True, "Environment marker accepted."
    return False, "That is not the marker this deployment printed. Run `make test`."


def _check_predict(submission: str) -> tuple[bool, str]:
    value = _as_int(submission)
    if value is None:
        return False, "Submit the final recorded value as a plain integer."
    case = fixtures.predict_case()
    if value == fixtures.expected(case)[-1]:
        return True, "Prediction matches the counter."
    return False, "That is not the value the last round records for this case."


def _check_first_divergence(submission: str) -> tuple[bool, str]:
    value = _as_int(submission)
    if value is None:
        return False, "Submit the 1-based round number as a plain integer."
    if value == fixtures.broken_round():
        return True, "That is where the published trace first breaks."
    return False, "That round is consistent with the round before it. Keep tracing."


def _check_general_counter(_submission: str) -> tuple[bool, str]:
    """Run the participant's own code against unseen cases.

    The submission field is ignored on purpose: this checkpoint is closed by the
    code in `counter.py`, not by a value that could be copied from someone else.
    """
    cases = fixtures.hidden_cases()
    for index, case in enumerate(cases, start=1):
        try:
            actual = run_advance(case.start, case.step, case.rounds, case.modulus)
        except ParticipantError as error:
            return False, f"counter.py failed on hidden case {index}/{len(cases)}: {error}"
        if actual != fixtures.expected(case):
            # Name the shape that broke, never the parameters or the expected list.
            shape = []
            if case.start < 0:
                shape.append("a negative start")
            if case.step < 0:
                shape.append("a negative step")
            if case.step == 0:
                shape.append("a zero step")
            hint = f" (this case has {' and '.join(shape)})" if shape else ""
            return (
                False,
                f"counter.py disagrees with the counter on hidden case "
                f"{index}/{len(cases)}{hint}.",
            )
    return True, f"counter.py matches on all {len(cases)} hidden cases."


_HANDLERS = {
    "environment": _check_environment,
    "predict": _check_predict,
    "first-divergence": _check_first_divergence,
    "general-counter": _check_general_counter,
}


def evaluate(checkpoint_id: str, submission: str) -> tuple[bool, str]:
    handler = _HANDLERS.get(checkpoint_id)
    if handler is None:
        return False, f"Unknown checkpointId. Expected one of: {', '.join(CHECKPOINTS)}."
    return handler(submission)


class _Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_args) -> None:  # noqa: D102 - quiet the default stderr spam
        return

    def _send(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY_BYTES:
            return {}
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return {}

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler's naming
        if self.path == "/healthz":
            return self._send(200, {"status": "ok"})
        if self.path == "/case":
            case = fixtures.public_case()
            return self._send(
                200,
                {
                    "start": case.start,
                    "step": case.step,
                    "rounds": case.rounds,
                    "modulus": case.modulus,
                },
            )
        return self._send(404, {"error": "not_found"})

    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler's naming
        if self.path != "/verify":
            return self._send(404, {"error": "not_found"})
        payload = self._read_json()
        checkpoint_id = str(payload.get("checkpointId") or "")
        submission = str(payload.get("submission") or "")
        try:
            correct, message = evaluate(checkpoint_id, submission)
        except Exception:  # noqa: BLE001 - a bad submission must never take the verifier down
            correct, message = False, "Verification could not complete for that submission."
        return self._send(200, {"checkpointId": checkpoint_id, "correct": correct, "message": message})


def _serve(port: int) -> None:
    ThreadingHTTPServer(("0.0.0.0", port), _Handler).serve_forever()


def main() -> None:
    Thread(target=_serve, args=(8080,), daemon=True).start()
    print("challenge on :8080, verify on :8081", flush=True)
    _serve(8081)


if __name__ == "__main__":
    main()
