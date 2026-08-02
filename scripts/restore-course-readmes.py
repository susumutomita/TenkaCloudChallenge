#!/usr/bin/env python3
"""Restore authored README prose and replace only the participant execution section."""

from __future__ import annotations

import re
import subprocess
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

FORBIDDEN = (
    "make inspect",
    "local/starter/",
    "host-side",
    "host terminal",
    "ホスト側",
    "ファイル操作",
)

ENGLISH_WORKFLOW = """## Browser workflow

1. Start the problem in Participant Portal and open **Browser Workbench**.
2. Run `inspect` to read this deployment's fixture and published evidence.
3. Edit the starter source in the in-browser editor.
4. Run `test` for the published checks and fill any direct-answer fields from the evidence.
5. Run `prepare`, then paste every prepared checkpoint value into Participant Portal.

No checkout, terminal, or local editor is required. Code checkpoints submit the edited source.
Direct answers are wrapped by `prepare` and bound to the current deployment seed, so a value copied
from another deployment is rejected.

"""

JAPANESE_WORKFLOW = """## ブラウザでの進め方

1. Participant Portal で問題を起動し、**Browser Workbench** を開く。
2. `inspect` でこの deploy 固有の fixture と公開された証拠を読む。
3. 画面内のエディタで starter のソースを編集する。
4. `test` で公開テストを実行し、直接回答欄があれば証拠から埋める。
5. `prepare` で全 checkpoint の提出値を作り、Participant Portal へ貼る。

checkout、ターミナル、ローカルエディタは不要です。code checkpoint は編集したソースを提出します。
直接回答は `prepare` が現在の deploy seed へ結び付けるため、別 deploy からコピーした値は拒否されます。

"""


def main_version(path: str) -> str:
    completed = subprocess.run(
        ["git", "show", f"origin/main:{path}"],
        cwd=ROOT,
        check=False,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if completed.returncode != 0:
        raise RuntimeError(f"cannot read origin/main:{path}: {completed.stderr}")
    return completed.stdout


def second_level_sections(text: str) -> list[tuple[int, int, str]]:
    headings = list(re.finditer(r"(?m)^## .+$", text))
    return [
        (
            match.start(),
            headings[index + 1].start() if index + 1 < len(headings) else len(text),
            text[match.start() : headings[index + 1].start() if index + 1 < len(headings) else len(text)],
        )
        for index, match in enumerate(headings)
    ]


def replace_execution_section(text: str, *, japanese: bool) -> str:
    workflow = JAPANESE_WORKFLOW if japanese else ENGLISH_WORKFLOW
    sections = second_level_sections(text)
    participant_markers = ("make inspect", "local/starter/", "make reset")
    for start, end, section in sections:
        if any(marker in section for marker in participant_markers):
            return text[:start] + workflow + text[end:]

    insertion_headings = (
        ("## 採点", "## Checkpoint", "## 解説")
        if japanese
        else ("## Scoring", "## Checkpoints", "## Explanation")
    )
    for heading in insertion_headings:
        position = text.find(heading)
        if position >= 0:
            return text[:position] + workflow + text[position:]
    return text.rstrip() + "\n\n" + workflow


def remove_obsolete_vocabulary(text: str, *, japanese: bool) -> str:
    editor = "Workbench のエディタ" if japanese else "the Workbench editor"
    text = re.sub(
        r"`local/starter/([^`]+)`",
        lambda match: f"{editor} (`{match.group(1)}`)",
        text,
    )
    text = re.sub(
        r"local/starter/([A-Za-z0-9_./*-]+)",
        lambda match: f"{editor} (`{match.group(1)}`)",
        text,
    )
    if japanese:
        replacements = (
            ("`make inspect`", "Workbench の `inspect`"),
            ("make inspect", "Workbench の `inspect`"),
            ("ホスト側のターミナル", "Browser Workbench"),
            ("ホスト側で", "Browser Workbench で"),
            ("ホスト側", "Workbench"),
            ("ファイル操作", "Workbench 内の編集"),
        )
    else:
        replacements = (
            ("`make inspect`", "Workbench `inspect`"),
            ("make inspect", "Workbench `inspect`"),
            ("host-side file operations", "Workbench editing"),
            ("host-side terminal", "Browser Workbench"),
            ("host terminal", "Browser Workbench"),
            ("host-side", "Workbench"),
        )
    for old, new in replacements:
        text = text.replace(old, new)
    return text


def verify_preservation(problem_id: str, name: str, original: str, restored: str) -> None:
    if restored.splitlines()[0] != original.splitlines()[0]:
        raise AssertionError(f"{problem_id}/{name}: title changed")
    if len(restored) < int(len(original) * 0.85):
        raise AssertionError(f"{problem_id}/{name}: authored prose was truncated")
    if restored.count("\n## ") < original.count("\n## ") - 1:
        raise AssertionError(f"{problem_id}/{name}: too many authored sections disappeared")
    for marker in ("independent, unofficial companion", "非公式・独立した companion"):
        if marker in original and marker not in restored:
            raise AssertionError(f"{problem_id}/{name}: course disclaimer disappeared")
    if "Browser Workbench" not in restored:
        raise AssertionError(f"{problem_id}/{name}: browser workflow missing")
    folded = restored.casefold()
    for term in FORBIDDEN:
        if term.casefold() in folded:
            raise AssertionError(f"{problem_id}/{name}: obsolete term remains: {term}")


def main() -> None:
    for problem_id in TARGETS:
        for name in ("README.md", "README.ja.md"):
            relative = f"challenges/{problem_id}/{name}"
            original = main_version(relative)
            japanese = name.endswith(".ja.md")
            restored = replace_execution_section(original, japanese=japanese)
            restored = remove_obsolete_vocabulary(restored, japanese=japanese)
            verify_preservation(problem_id, name, original, restored)
            (ROOT / relative).write_text(restored, encoding="utf-8")
        print(f"restored authored READMEs for {problem_id}")


if __name__ == "__main__":
    main()
