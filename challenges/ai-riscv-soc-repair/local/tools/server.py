#!/usr/bin/env python3
"""Loopback lab UI and bounded delegated verifier for the RTL repair problem."""

from __future__ import annotations

import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import signal
import subprocess
from threading import Lock, Thread
import tempfile


ROOT = Path("/workspace")
MAX_BODY_BYTES = 64 * 1024
MAX_OUTPUT_CHARS = 64 * 1024
MAX_RTL_BYTES = 256 * 1024
MAX_WAVE_BYTES = 16 * 1024 * 1024
SIMULATION_LOCK = Lock()


def derive_flag() -> str:
    seed = os.environ.get("FLAG_SEED", "local-dev-seed")
    digest = hashlib.sha256(f"riscv-soc:{seed}".encode()).hexdigest()[:16]
    return f"TENKACLOUD{{rv32i_soc_booted_{digest}}}"


def verification_verdict(
    submission: str, simulation_passed: bool, expected_flag: str | None = None
) -> dict[str, object]:
    """Require both executable RTL evidence and the flag from that seeded run."""
    correct = simulation_passed and submission.strip() == (expected_flag or derive_flag())
    return {
        "correct": correct,
        "message": (
            "UART flag accepted; the complete RV32I regression suite passed."
            if correct
            else "The submitted flag and repaired RTL did not both pass verification."
        ),
    }


def run_make(target: str) -> tuple[int, str]:
    solution = ROOT / "solution" / "rv32i_cpu.sv"
    try:
        if solution.stat().st_size > MAX_RTL_BYTES:
            return 1, f"Participant RTL exceeds the {MAX_RTL_BYTES}-byte limit."
    except OSError:
        return 1, "Participant RTL is missing or unreadable."

    if not SIMULATION_LOCK.acquire(timeout=1):
        return 1, "Another simulation is already running."
    try:
        with tempfile.TemporaryFile(mode="w+b") as output_file:
            process = subprocess.Popen(
                ["make", "clean", target],
                cwd=ROOT,
                stdout=output_file,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
            timed_out = False
            try:
                process.wait(timeout=40)
            except subprocess.TimeoutExpired:
                timed_out = True
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.wait()
            output_file.seek(0, os.SEEK_END)
            size = output_file.tell()
            output_file.seek(max(0, size - MAX_OUTPUT_CHARS))
            output = output_file.read(MAX_OUTPUT_CHARS).decode("utf-8", errors="replace")
        if timed_out:
            return 124, f"Simulation timed out after 40 seconds.\n{output}"
        return process.returncode, output
    finally:
        SIMULATION_LOCK.release()


def run_simulation() -> tuple[bool, str]:
    return_code, output = run_make("test")
    return return_code == 0 and "SIM_PASS" in output, output


def capture_waveform() -> tuple[bool, bytes | str]:
    return_code, output = run_make("wave")
    wave = ROOT / "build" / "wave.vcd"
    try:
        size = wave.stat().st_size
        if return_code != 0 or size <= 0 or size > MAX_WAVE_BYTES:
            return False, output or "Waveform generation failed."
        return True, wave.read_bytes()
    except OSError:
        return False, output or "Waveform generation failed."


def json_bytes(payload: object) -> bytes:
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


class LabHandler(BaseHTTPRequestHandler):
    server_version = "TenkaCloudRiscVLab/1"

    def log_message(self, message: str, *args: object) -> None:
        print(f"[lab] {self.address_string()} {message % args}")

    def send_payload(self, status: int, content_type: str, body: bytes) -> None:
        self.send_response(status)
        self.send_header("content-type", content_type)
        self.send_header("content-length", str(len(body)))
        self.send_header("cache-control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, status: int, payload: object) -> None:
        self.send_payload(status, "application/json; charset=utf-8", json_bytes(payload))

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        if self.path == "/healthz":
            self.send_json(200, {"status": "ok"})
            return
        if self.path != "/":
            self.send_json(404, {"error": "not_found"})
            return
        body = b"""<!doctype html><html lang=\"en\"><meta charset=\"utf-8\">
<title>AI RISC-V SoC Repair Lab</title>
<style>body{font-family:system-ui;max-width:52rem;margin:3rem auto;line-height:1.55}pre{background:#111;color:#eee;padding:1rem;white-space:pre-wrap}button{padding:.7rem 1rem}</style>
<h1>AI RISC-V SoC Repair Lab</h1>
<p>The inherited RV32I RTL compiles, but its boot firmware never reaches UART.</p>
<p>Edit <code>local/solution/rv32i_cpu.sv</code>, recreate this problem, and run the regression suite.</p>
<button id=\"run\">Run simulation</button> <button id=\"wave\">Capture waveform</button><pre id=\"output\">No run yet.</pre>
<script>const o=document.querySelector('#output');document.querySelector('#run').onclick=async()=>{o.textContent='Running...';const r=await fetch('/run',{method:'POST'});const j=await r.json();o.textContent=j.output;};document.querySelector('#wave').onclick=async()=>{o.textContent='Capturing...';const r=await fetch('/wave',{method:'POST'});if(!r.ok){const j=await r.json();o.textContent=j.error;return;}const a=document.createElement('a');a.href=URL.createObjectURL(await r.blob());a.download='ai-riscv-soc-repair.vcd';a.click();URL.revokeObjectURL(a.href);o.textContent='Waveform downloaded.';};</script>
</html>"""
        self.send_payload(200, "text/html; charset=utf-8", body)

    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        if self.path == "/run":
            passed, output = run_simulation()
            self.send_json(200, {"passed": passed, "output": output})
            return
        if self.path == "/wave":
            captured, result = capture_waveform()
            if not captured or isinstance(result, str):
                self.send_json(422, {"error": str(result)})
                return
            self.send_payload(200, "text/x-vcd", result)
            return
        self.send_json(404, {"error": "not_found"})


class VerifyHandler(BaseHTTPRequestHandler):
    server_version = "TenkaCloudRiscVVerify/1"

    def log_message(self, message: str, *args: object) -> None:
        print(f"[verify] {self.address_string()} {message % args}")

    def send_json(self, status: int, payload: object) -> None:
        body = json_bytes(payload)
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.send_header("cache-control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        if self.path != "/verify":
            self.send_json(404, {"error": "not_found"})
            return
        try:
            length = int(self.headers.get("content-length", "0"))
        except ValueError:
            length = 0
        if length < 0 or length > MAX_BODY_BYTES:
            self.send_json(413, {"error": "request_too_large"})
            return
        try:
            request = json.loads(self.rfile.read(length) or b"{}")
        except (json.JSONDecodeError, UnicodeDecodeError):
            request = {}
        submission = str(request.get("submission", "")).strip()
        passed, _ = run_simulation()
        self.send_json(200, verification_verdict(submission, passed))


class BoundedThreadingHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 8


def serve(port: int, handler: type[BaseHTTPRequestHandler]) -> None:
    BoundedThreadingHTTPServer(("0.0.0.0", port), handler).serve_forever()


if __name__ == "__main__":
    Thread(target=serve, args=(8081, VerifyHandler), daemon=True).start()
    serve(8080, LabHandler)
