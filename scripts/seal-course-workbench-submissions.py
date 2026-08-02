#!/usr/bin/env python3
"""Seal Browser Workbench code submissions into one-line deployment-bound tokens."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGETS = (
    "ac26-w2-secret-sharing", "ac26-w2-linear-shares", "ac26-w2-beaver-mul",
    "ac26-w2-privacy-audit", "ac26-w2-private-aggregate", "ac26-w3-field-inverse",
    "ac26-w3-ec-group", "ac26-w3-nonce-reuse", "ac26-w3-schnorr",
    "ac26-w4-arithmetization", "ac26-w4-commit-open", "ac26-w4-proof-pipeline",
    "ac26-w5-encoding-noise", "ac26-w5-lwe-rlwe", "ac26-w5-rgsw-external",
    "ac26-w5-cmux-blind-rotation", "ac26-w5-extract-key-switch",
    "ac26-w5-pbs-homnand", "ac26-w6-cosnark-linear", "ac26-w6-cosnark-beaver",
    "ac26-w6-cosnark-privacy", "ac26-w6-zkvm-exploit-predicate",
    "ac26-w6-zkvm-witness-binding", "ac26-w6-stack-design",
    "ac26-w7-capstone-design", "ac26-w7-capstone-demo", "sha256-bytes-padding",
    "sha256-schedule-logic", "sha256-compress-digest",
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
OLD_PROBE = """    if item[\"kind\"] == \"code\":
        assert _WORKBENCH.unwrap_submission(checkpoint, submission) == submission
    else:
"""
NEW_PROBE = """    if item[\"kind\"] == \"code\":
        assert submission.startswith(\"tcw1.\")
        assert \"\\n\" not in submission and \"\\r\" not in submission
        expected_source = starter[config[\"submittedFiles\"][0]] if len(starter) == 1 else json.dumps(starter, separators=(\",\", \":\"), ensure_ascii=False)
        assert _WORKBENCH.unwrap_submission(checkpoint, submission) == expected_source
        # Existing callers that still submit raw source remain compatible.
        assert _WORKBENCH.unwrap_submission(checkpoint, expected_source) == expected_source
    else:
"""


def patch_workbenches() -> int:
    changed = 0
    for problem_id in TARGETS:
        path = ROOT / "challenges" / problem_id / "local" / "verifier" / "workbench.py"
        source = path.read_text(encoding="utf-8")
        if SEALED not in source:
            if RAW not in source:
                raise RuntimeError(f"{problem_id}: expected submission block not found")
            path.write_text(source.replace(RAW, SEALED, 1), encoding="utf-8")
            changed += 1
            print(f"sealed {problem_id}")
    return changed


def patch_contract_test() -> bool:
    path = ROOT / "scripts" / "verify-course-workbenches.py"
    source = path.read_text(encoding="utf-8")
    if NEW_PROBE in source:
        return False
    if OLD_PROBE not in source:
        raise RuntimeError("verify-course-workbenches.py: expected code probe not found")
    path.write_text(source.replace(OLD_PROBE, NEW_PROBE, 1), encoding="utf-8")
    return True


def main() -> int:
    changed = patch_workbenches()
    test_changed = patch_contract_test()
    print(f"sealed code submissions in {changed} Workbenches; contract updated={test_changed}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
