#!/usr/bin/env python3
"""Exercise the shipped Workbench -> verifier HTTP path for the latency lab."""

from __future__ import annotations

import argparse
import json
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOCAL = ROOT / "challenges" / "asm-worst-case-latency" / "local"
CODE_CHECKPOINTS = ("measure", "dependency", "miss", "generalize")
HOST_FIELDS = (
    "architecture",
    "cpuModel",
    "microcode",
    "kernel",
    "hypervisor",
    "governor",
    "cpuFlags",
    "cpuCount",
)
REQUIRED_FLAGS = ("rdtscp", "constant_tsc", "nonstop_tsc", "clflush")


def request_json(base_url: str, path: str, payload: object | None = None) -> dict:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        base_url.rstrip("/") + path,
        data=data,
        headers={"content-type": "application/json"} if data is not None else {},
        method="POST" if data is not None else "GET",
    )
    with urllib.request.urlopen(request, timeout=300) as response:
        decoded = json.loads(response.read().decode("utf-8"))
    if not isinstance(decoded, dict):
        raise AssertionError(f"{path} returned no JSON object")
    return decoded


def wait_until_ready(base_url: str) -> None:
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        try:
            config = request_json(base_url, "/api/config")
            if config.get("id") == "asm-worst-case-latency":
                return
        except (OSError, urllib.error.URLError, json.JSONDecodeError):
            pass
        time.sleep(1)
    raise AssertionError("Workbench did not become ready within 90 seconds")


def verify(base_url: str, checkpoint: str, submission: str) -> bool:
    result = request_json(
        base_url,
        "/verify",
        {"checkpointId": checkpoint, "submission": submission},
    )
    if result.get("checkpointId") != checkpoint or not isinstance(result.get("correct"), bool):
        raise AssertionError(f"malformed verifier response for {checkpoint}: {result!r}")
    return result["correct"]


def assert_host_report(report: object) -> None:
    if not isinstance(report, dict):
        raise AssertionError("result has no host metadata")
    missing = [field for field in HOST_FIELDS if field not in report]
    if missing:
        raise AssertionError(f"host metadata is missing {missing}")
    flags = report.get("cpuFlags")
    if not isinstance(flags, dict) or any(flags.get(flag) is not True for flag in REQUIRED_FLAGS):
        raise AssertionError(f"host metadata does not prove required flags: {flags!r}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:18570")
    args = parser.parse_args()

    wait_until_ready(args.url)
    starter = request_json(args.url, "/api/starter")["candidate.S"]
    reference = (LOCAL / "reference" / "candidate.S").read_text(encoding="utf-8")

    evidence = request_json(args.url, "/api/inspect")
    assert_host_report(evidence["environment"]["host"])
    token = evidence["environment"]["healthToken"]
    if not verify(args.url, "environment", token):
        raise AssertionError("the real environment token was rejected")
    if verify(args.url, "environment", token + "-wrong"):
        raise AssertionError("an incorrect environment token was accepted")

    public = request_json(args.url, "/api/test", {"files": {"candidate.S": starter}})
    if public.get("passed") is not True:
        raise AssertionError(f"the shipped starter failed public test: {public!r}")
    public_result = json.loads(public["output"])
    assert_host_report(public_result.get("host"))

    prepared = request_json(args.url, "/api/prepare", {"files": {"candidate.S": starter}})
    if prepared.get("ok") is not True:
        raise AssertionError(f"the shipped starter could not be prepared: {prepared!r}")

    reference_verdicts = {
        checkpoint: verify(args.url, checkpoint, reference) for checkpoint in CODE_CHECKPOINTS
    }
    if not all(reference_verdicts.values()):
        raise AssertionError(f"reference did not clear every real checkpoint: {reference_verdicts}")

    starter_verdicts = {
        checkpoint: verify(args.url, checkpoint, starter) for checkpoint in CODE_CHECKPOINTS
    }
    if starter_verdicts != {
        "measure": True,
        "dependency": False,
        "miss": False,
        "generalize": False,
    }:
        raise AssertionError(f"starter threshold ladder drifted: {starter_verdicts}")

    # This was the concrete scoring bypass: a participant-owned 6400-iteration
    # outer loop. As one ordinary instruction it is harmless and cannot reach 3x.
    if verify(args.url, "dependency", "movl $6400, %ecx"):
        raise AssertionError("the former loop-count payload still inflates the score")

    old_wrapper = """.text
.globl tc_candidate
tc_candidate:
    movl $6400, %ecx
tc_measured_begin:
    addq $1, %rax
tc_measured_end:
    loop tc_measured_begin
    ret
"""
    rejected = request_json(
        args.url,
        "/api/prepare",
        {"files": {"candidate.S": old_wrapper}},
    )
    if rejected.get("ok") is not False:
        raise AssertionError("Workbench prepared a participant-owned wrapper")
    if verify(args.url, "measure", old_wrapper):
        raise AssertionError("verifier accepted a participant-owned wrapper")

    prefix = request_json(
        args.url,
        "/api/prepare",
        {"files": {"candidate.S": "cs pause"}},
    )
    if prefix.get("ok") is not False:
        raise AssertionError("Workbench accepted a prefix-smuggled stall instruction")

    print("real Compose Workbench -> verifier HTTP path passed")
    print(f"reference={reference_verdicts} starter={starter_verdicts}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
