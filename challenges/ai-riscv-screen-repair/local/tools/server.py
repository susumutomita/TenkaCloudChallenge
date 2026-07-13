#!/usr/bin/env python3
"""Loopback lab UI and bounded state-based verifier for the screen repair."""

from __future__ import annotations

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
MAX_FRAME_BYTES = 2 * 1024 * 1024
SIMULATION_LOCK = Lock()


def verification_verdict(
    submission: str, simulation_passed: bool, artifact_verified: bool
) -> dict[str, object]:
    """Grade observable simulation state, never a source-text signature."""
    correct = (
        submission.strip() == "VERIFY" and simulation_passed and artifact_verified
    )
    return {
        "correct": correct,
        "message": (
            "CDC, raster timing, framebuffer writes, and frame digest all passed."
            if correct
            else "The mounted RTL did not satisfy every state and artifact assertion."
        ),
    }


def run_make(target: str) -> tuple[int, str]:
    solution = ROOT / "solution" / "video_controller.sv"
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
                process.wait(timeout=60)
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
            output = output_file.read(MAX_OUTPUT_CHARS).decode(
                "utf-8", errors="replace"
            )
        if timed_out:
            return 124, f"Simulation timed out after 60 seconds.\n{output}"
        return process.returncode, output
    finally:
        SIMULATION_LOCK.release()


def run_simulation() -> tuple[bool, bool, str]:
    return_code, output = run_make("test")
    simulation_passed = return_code == 0 and "SIM_PASS" in output
    artifact_verified = simulation_passed and "FRAME_SHA256" in output
    return simulation_passed, artifact_verified, output


def capture_frame() -> tuple[bool, bytes | str]:
    simulation_passed, artifact_verified, output = run_simulation()
    frame = ROOT / "build" / "frame.ppm"
    try:
        size = frame.stat().st_size
        if (
            not simulation_passed
            or not artifact_verified
            or size <= 0
            or size > MAX_FRAME_BYTES
        ):
            return False, output or "Frame generation failed."
        return True, frame.read_bytes()
    except OSError:
        return False, output or "Frame generation failed."


def json_bytes(payload: object) -> bytes:
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


class LabHandler(BaseHTTPRequestHandler):
    server_version = "TenkaCloudRiscVScreenLab/1"

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
        self.send_payload(
            status, "application/json; charset=utf-8", json_bytes(payload)
        )

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        if self.path == "/healthz":
            self.send_json(200, {"status": "ok"})
            return
        if self.path != "/":
            self.send_json(404, {"error": "not_found"})
            return
        body = b"""<!doctype html><html lang=\"en\"><meta charset=\"utf-8\">
<title>AI RISC-V Screen Repair Lab</title>
<style>body{font-family:system-ui;max-width:56rem;margin:3rem auto;line-height:1.55}pre{background:#111;color:#eee;padding:1rem;white-space:pre-wrap}button{padding:.7rem 1rem}</style>
<h1>AI RISC-V Screen Repair Lab</h1>
<p>The video RTL compiles, but CDC, raster timing, and framebuffer writes violate the prior specification.</p>
<p>Edit <code>local/solution/video_controller.sv</code>, recreate the problem, and run the state-based regression.</p>
<button id=\"run\">Run simulation</button> <button id=\"frame\">Capture deterministic frame</button><pre id=\"output\">No run yet.</pre>
<script>const o=document.querySelector('#output');document.querySelector('#run').onclick=async()=>{o.textContent='Running...';const r=await fetch('/run',{method:'POST'});const j=await r.json();o.textContent=j.output;};document.querySelector('#frame').onclick=async()=>{o.textContent='Capturing...';const r=await fetch('/frame',{method:'POST'});if(!r.ok){const j=await r.json();o.textContent=j.error;return;}const a=document.createElement('a');a.href=URL.createObjectURL(await r.blob());a.download='ai-riscv-screen.ppm';a.click();URL.revokeObjectURL(a.href);o.textContent='Deterministic PPM downloaded.';};</script>
</html>"""
        self.send_payload(200, "text/html; charset=utf-8", body)

    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        if self.path == "/run":
            passed, artifact_verified, output = run_simulation()
            self.send_json(
                200,
                {
                    "passed": passed,
                    "artifactVerified": artifact_verified,
                    "output": output,
                },
            )
            return
        if self.path == "/frame":
            captured, result = capture_frame()
            if not captured or isinstance(result, str):
                self.send_json(422, {"error": str(result)})
                return
            self.send_payload(200, "image/x-portable-pixmap", result)
            return
        self.send_json(404, {"error": "not_found"})


class VerifyHandler(BaseHTTPRequestHandler):
    server_version = "TenkaCloudRiscVScreenVerify/1"

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
        submission = str(request.get("submission", ""))
        passed, artifact_verified, _ = run_simulation()
        self.send_json(
            200, verification_verdict(submission, passed, artifact_verified)
        )


class BoundedThreadingHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 8


def serve(port: int, handler: type[BaseHTTPRequestHandler]) -> None:
    BoundedThreadingHTTPServer(("0.0.0.0", port), handler).serve_forever()


if __name__ == "__main__":
    Thread(target=serve, args=(8081, VerifyHandler), daemon=True).start()
    serve(8080, LabHandler)
