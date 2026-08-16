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
from pathlib import Path


def health_token(seed: str) -> str:
    return f"latency-lab-{hashlib.sha256(seed.encode()).hexdigest()[:12]}"


def stable_seed(label: str) -> int:
    """Derive the same bounded measurement seed in every Python process."""
    digest = hashlib.sha256(label.encode()).digest()
    return int.from_bytes(digest[:8], "big") % (2**31)


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


def _read_host_value(*paths: str) -> str | None:
    for path in paths:
        try:
            value = Path(path).read_text(encoding="utf-8").strip()
        except OSError:
            continue
        if value:
            return value
    return None


def host_report() -> dict[str, object]:
    """What the result is only meaningful against.

    A cycle count means nothing without the machine it was taken on, so the
    machine is recorded next to it rather than assumed.
    """
    fields = _cpuinfo()
    flags = set(fields.get("flags", "").split())
    if "hypervisor" in flags:
        hypervisor = _read_host_value(
            "/sys/hypervisor/type",
            "/sys/devices/virtual/dmi/id/product_name",
        ) or "present (vendor unavailable)"
    else:
        hypervisor = "none detected"
    governor = _read_host_value(
        "/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor",
    ) or "unavailable"
    return {
        "architecture": platform.machine(),
        "cpuModel": fields.get("model name", "unknown"),
        "microcode": fields.get("microcode", "unknown"),
        "kernel": platform.release(),
        "hypervisor": hypervisor,
        "governor": governor,
        "cpuFlags": {
            "rdtscp": "rdtscp" in flags,
            "constant_tsc": "constant_tsc" in flags,
            "nonstop_tsc": "nonstop_tsc" in flags,
            "clflush": "clflush" in flags,
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
            "starter のスコアは 1.00 前後です。 baseline と同じ命令を測っているからです。 "
            "この deployment の合言葉を貼って、測定環境が立ち上がったことを示してください。"
        ),
        "answerFormat": "<environment.healthToken の値をそのまま>",
        "i18n": {
            "en": {
                "question": (
                    "The starter scores around 1.00, because it measures the same instruction the "
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
                "measuredRegion": "author-owned wrapper: 64 copies of the submitted instruction",
                "instructionsAllowed": 1,
                "instructionPolicy": (
                    "reviewed scalar-integer mnemonic; GPR operands only; "
                    "memory reads use only (%r8) and require an explicit GPR result"
                ),
                "repeatsPerSample": 64,
                "samples": 101,
                "statistic": "median after migration and predeclared high-outlier rejection",
                "score": "candidate robust cycles / baseline robust cycles",
            },
            "arena": {
                "bytes": 64 * 1024 * 1024,
                "shape": "a single seed-shuffled pointer ring, one link per 64-byte line",
                "headRegister": "%r8",
                "access": "read-only during measurement",
                "note": "each sample starts elsewhere; its fixed path is flushed before timing",
            },
            "latencyLadder": LATENCY_LADDER,
        },
    }
