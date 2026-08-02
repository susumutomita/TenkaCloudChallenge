#!/usr/bin/env python3
"""Seal Browser Workbench code submissions into one-line deployment-bound tokens.

The Participant Portal uses single-line inputs for multi-verify checkpoints. Raw
multi-line source cannot be pasted there without losing newlines/indentation.
This migration keeps verifier backward compatibility for existing raw source,
while making Workbench `prepare` emit the existing tcw1 HMAC envelope for both
code and direct-answer checkpoints.
"""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGETS = (
    "ac26-w2-secret-sharing",
    "ac26-w2-linear-shares",
    "ac26-w2-beaver-mul",
    "ac26-w2-privacy-audit",
    "ac26-w2-private-aggregate",
    "ac26-w3-field-inverse",
    "ac26-w3-ec-group",
    "ac26-w3-nonce-reuse",
    "ac26-w3-schnorr",
    "ac26-w4-arithmetization",
    "ac26-w4-commit-open",
    "ac26-w4-proof-pipeline",
    "ac26-w5-encoding-noise",
    "ac26-w5-lwe-rlwe",
    "ac26-w5-rgsw-external",
    "ac26-w5-cmux-blind-rotation",
    "ac26-w5-extract-key-switch",
    "ac26-w5-pbs-homnand",
    "ac26-w6-cosnark-linear",
    "ac26-w6-cosnark-beaver",
    "ac26-w6-cosnark-privacy",
    "ac26-w6-zkvm-exploit-predicate",
    "ac26-w6-zkvm-witness-binding",
    "ac26-w6-stack-design",
    "ac26-w7-capstone-design",
    "ac26-w7-capstone-demo",
    "sha256-bytes-padding",
    "sha256-schedule-logic",
    "sha256-compress-digest",
)

RAW = """        submissions: dict[str, str] = {
            checkpoint: code_value for checkpoint in self.code_checkpoints
        }
"""
SEALED = """        submissions: dict[str, str] = {
            checkpoint: self._seal_manual(checkpoint, code_value)
            for checkpoint in self.code_checkpoints
        }
"""


def main() -> int:
    changed = 0
    for problem_id in TARGETS:
        path = ROOT / "challenges" / problem_id / "local" / "verifier" / "workbench.py"
        source = path.read_text(encoding="utf-8")
        if SEALED in source:
            continue
        if RAW not in source:
            raise RuntimeError(f"{problem_id}: expected WorkbenchSupport submission block not found")
        path.write_text(source.replace(RAW, SEALED, 1), encoding="utf-8")
        changed += 1
        print(f"sealed {problem_id}")
    print(f"sealed code submissions in {changed} Workbenches")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
