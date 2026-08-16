"""Seed-derived orientation for the latency lab.

What the participant is shown: which host they are measuring on, what the
baseline instruction costs there, and the ladder of what the machine is capable
of hating. What they are not shown is which instruction closes the gap — that is
the problem.
"""

from __future__ import annotations

import hashlib
import os
import platform
import re


def health_token(seed: str) -> str:
    return f"latency-lab-{hashlib.sha256(seed.encode()).hexdigest()[:12]}"


def _cpuinfo() -> dict[str, str]:
    try:
        text = open("/proc/cpuinfo", encoding="utf-8").read()
    except OSError:
        return {}
    fields: dict[str, str] = {}
    for line in text.splitlines():
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        key, value = key.strip(), value.strip()
        if key and key not in fields:
            fields[key] = value
    return fields


def host_report() -> dict[str, object]:
    """What the result is only meaningful against.

    A cycle count means nothing without the machine it was taken on, so the
    machine is recorded next to it rather than assumed.
    """
    fields = _cpuinfo()
    flags = set(fields.get("flags", "").split())
    return {
        "architecture": platform.machine(),
        "cpuModel": fields.get("model name", "unknown"),
        "microcode": fields.get("microcode", "unknown"),
        "kernel": platform.release(),
        "cpuFlags": {
            "rdtscp": "rdtscp" in flags,
            "constant_tsc": "constant_tsc" in flags,
            "nonstop_tsc": "nonstop_tsc" in flags,
        },
        "cpuCount": os.cpu_count(),
    }


#: The ladder, as costs rather than answers. Every row is a fact about hardware
#: the participant can look up; none of them names the instruction that gets
#: there, and the arena is what makes the bottom row reachable at all.
LATENCY_LADDER = [
    {"level": "register arithmetic", "typicalCycles": "1-3", "reachedBy": "the starter"},
    {"level": "L1 cache hit", "typicalCycles": "4-5", "reachedBy": None},
    {"level": "L2 cache hit", "typicalCycles": "12-20", "reachedBy": None},
    {"level": "integer divide", "typicalCycles": "20-100", "reachedBy": None},
    {"level": "L3 cache hit", "typicalCycles": "40-80", "reachedBy": None},
    {"level": "DRAM, prefetchable", "typicalCycles": "60-100", "reachedBy": None},
    {"level": "DRAM, dependent and unpredictable", "typicalCycles": "200-400", "reachedBy": None},
]

QUESTIONS = {
    "measure": {
        "question": (
            "starter のスコアは 1.00 です。 baseline と同じ命令を測っているからです。 "
            "この deployment の合言葉を貼って、測定環境が立ち上がったことを示してください。"
        ),
        "answerFormat": "<environment.healthToken の値をそのまま>",
        "i18n": {
            "en": {
                "question": (
                    "The starter scores 1.00, because it measures the same instruction the "
                    "baseline does. Paste this deployment's pass phrase to show the "
                    "measurement environment came up."
                ),
                "answerFormat": "<the environment.healthToken value, verbatim>",
            }
        },
    },
}


def evidence_blocks(seed: str) -> dict[str, object]:
    """The one payload both the CLI and the Portal serve."""
    return {
        "environment": {"healthToken": health_token(seed), "host": host_report()},
        "measure": {
            **QUESTIONS["measure"],
            "contract": {
                "measuredRegion": "between tc_measured_begin and tc_measured_end",
                "instructionsAllowed": 1,
                "repeatsPerSample": 64,
                "samples": 101,
                "statistic": "median of samples that stayed on one CPU",
                "score": "candidate robust cycles / baseline robust cycles",
            },
            "arena": {
                "bytes": 64 * 1024 * 1024,
                "shape": "a single seed-shuffled pointer ring, one link per 64-byte line",
                "headRegister": "%rdi",
                "note": "each sample starts somewhere new in the ring",
            },
            "latencyLadder": LATENCY_LADDER,
        },
    }
