#!/usr/bin/env python3
"""Print a compact inventory for the AC26/SHA workbench migration targets."""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGETS = [
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
]


def relative_files(path: Path) -> list[str]:
    if not path.exists():
        return []
    return sorted(str(item.relative_to(path)) for item in path.rglob("*") if item.is_file())


def checkpoint_ids(metadata: dict[str, object]) -> list[str]:
    scoring = metadata.get("scoring")
    if not isinstance(scoring, dict):
        return []
    checkpoints = scoring.get("checkpoints")
    if not isinstance(checkpoints, list):
        return []
    result: list[str] = []
    for checkpoint in checkpoints:
        if isinstance(checkpoint, dict) and isinstance(checkpoint.get("id"), str):
            result.append(checkpoint["id"])
    return result


def main() -> None:
    inventory: list[dict[str, object]] = []
    for challenge_id in TARGETS:
        problem = ROOT / "challenges" / challenge_id
        metadata_path = problem / "metadata.json"
        if not metadata_path.exists():
            inventory.append({"id": challenge_id, "missing": True})
            continue
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        local = problem / "local"
        verifier = local / "verifier" / "server.py"
        verifier_text = verifier.read_text(encoding="utf-8") if verifier.exists() else ""
        dockerfile = local / "Dockerfile"
        docker_text = dockerfile.read_text(encoding="utf-8") if dockerfile.exists() else ""
        docs = "\n".join(
            path.read_text(encoding="utf-8")
            for path in (problem / "README.md", problem / "README.ja.md", metadata_path)
            if path.exists()
        )
        exposed_ports = metadata.get("exposedPorts")
        ports = []
        if isinstance(exposed_ports, list):
            for entry in exposed_ports:
                if isinstance(entry, dict):
                    ports.append(entry.get("port"))
        inventory.append(
            {
                "id": challenge_id,
                "starter": relative_files(local / "starter"),
                "publicTests": relative_files(local / "tests" / "public"),
                "localTopLevel": sorted(
                    item.name for item in local.iterdir() if item.is_file()
                ) if local.exists() else [],
                "checkpoints": checkpoint_ids(metadata),
                "ports": ports,
                "runtime": metadata.get("runtime"),
                "hasWorkbench": (local / "workbench").exists(),
                "hasShow": (local / "show.py").exists(),
                "verifierImportsUrlsplit": "urlsplit" in verifier_text,
                "verifierHasGet": "def do_GET" in verifier_text,
                "verifierHasTestApi": "/api/test" in verifier_text,
                "dockerStages": re.findall(r"^FROM .* AS (\\w+)", docker_text, re.MULTILINE),
                "dockerCopies": re.findall(r"^COPY ([^\\n]+)", docker_text, re.MULTILINE),
                "legacyTerms": {
                    term: docs.count(term)
                    for term in ("make inspect", "local/starter/", "host terminal", "ホスト側", "ファイル操作")
                    if term in docs
                },
            }
        )
    print(json.dumps(inventory, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
