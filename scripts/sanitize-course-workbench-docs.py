#!/usr/bin/env python3
"""Remove obsolete checkout-only directions after the one-time Workbench migration."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

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

FORBIDDEN = (
    "make inspect",
    "local/starter/",
    "host terminal",
    "host-side terminal",
    "host-side file",
    "ホスト側のターミナル",
    "ホスト側で",
    "ファイル操作",
)


def portalize_text(text: str) -> str:
    replacements = (
        ("`make inspect`", "`inspect`"),
        ("make inspect", "Browser Workbench の `inspect`"),
        ("`make test-one ID=...`", "対象 checkpoint の `test`"),
        ("`make test-one`", "対象 checkpoint の `test`"),
        ("make test-one", "checkpoint ごとの `test`"),
        ("`make test`", "`test`"),
        ("make test", "Browser Workbench の `test`"),
        ("`make reset`", "starter の再読み込み"),
        ("make reset", "starter の再読み込み"),
        ("`local/starter/", "`Workbench editor: "),
        ("local/starter/", "Workbench editor: "),
        ("ホスト側のターミナル", "Browser Workbench"),
        ("ホスト側で", "Browser Workbench で"),
        ("ファイル操作", "Workbench 内の編集"),
        ("host-side terminal", "Browser Workbench"),
        ("host terminal", "Browser Workbench"),
        ("host-side file operations", "Workbench editing"),
        ("host-side file", "Workbench source"),
    )
    for old, new in replacements:
        text = text.replace(old, new)

    # Preserve filenames when useful, but make the location unambiguously browser-owned.
    text = re.sub(
        r"Workbench editor: ([A-Za-z0-9_./*-]+)",
        r"Workbench editor (`\1`)",
        text,
    )
    return text


def portalize_value(value: Any) -> Any:
    if isinstance(value, str):
        return portalize_text(value)
    if isinstance(value, list):
        return [portalize_value(item) for item in value]
    if isinstance(value, dict):
        return {key: portalize_value(item) for key, item in value.items()}
    return value


def assert_clean(problem_id: str, text: str, source: str) -> None:
    folded = text.casefold()
    for term in FORBIDDEN:
        if term.casefold() in folded:
            raise AssertionError(f"{problem_id}: {term!r} remains in {source}")


def main() -> None:
    for problem_id in TARGETS:
        problem = ROOT / "challenges" / problem_id
        metadata_path = problem / "metadata.json"
        metadata = portalize_value(json.loads(metadata_path.read_text(encoding="utf-8")))
        encoded = json.dumps(metadata, ensure_ascii=False, indent=2) + "\n"
        assert_clean(problem_id, encoded, "metadata.json")
        metadata_path.write_text(encoded, encoding="utf-8")

        for name in ("README.md", "README.ja.md"):
            path = problem / name
            text = portalize_text(path.read_text(encoding="utf-8"))
            assert_clean(problem_id, text, name)
            path.write_text(text, encoding="utf-8")
        print(f"sanitized {problem_id}")


if __name__ == "__main__":
    main()
