#!/usr/bin/env python3
"""[#381] Generate the Portal editor language material from metadata, and prove it stayed generated.

The text a participant reads in the Portal editor (problem name, description,
checkpoint labels) is embedded in each course problem's Portal server, normally
``local/verifier/server.py``, inside the ``BEGIN/END GENERATED PORTAL EDITOR API``
block. Split-boundary problems keep that public server under ``local/participant``.
The source of truth for that text — Japanese and English both — is the problem's
``metadata.json``: ``name`` / ``shortDescription`` / ``scoring.checks[].label`` and
their ``i18n.en`` counterparts.

Keeping the text in the block by hand is how the English got lost in the first place:
34 verifiers shipped Japanese-only strings while the finished translations sat in
metadata. This script closes that gap in both directions.

    python3 scripts/generate-course-workbenches.py --check    # the gate: drift fails
    python3 scripts/generate-course-workbenches.py --write    # regenerate in place

What it owns:

- **Generated blocks** (problems whose ``server.py`` carries the marker): the six
  language arguments — ``problem_name`` / ``description`` / ``checkpoint_labels`` and
  their ``_en`` twins — are regenerated from metadata. ``--check`` compares parsed
  values, so quoting style never matters; ``--write`` rewrites the lines.
- **The vendored adapter** (normally ``local/verifier/workbench.py``; split-boundary
  problems use ``local/participant/workbench.py``): every copy must be
  byte-identical to the canonical source in ``scripts/course-workbench/workbench.py``.
  Vendoring is the spec — each problem must deploy self-contained — so ``--write``
  re-distributes the canonical file rather than collapsing the copies into an import.
- **Hand-written payloads** (course problems with ``server.py`` but no marker):
  their ``config_payload()`` is authored per problem, so generation cannot reach it.
  ``--check`` still fails if the English strings from metadata do not appear verbatim
  in the source — the same drift, caught at the same gate, fixed by hand.

Nothing here runs at problem runtime. The verifier reads no file outside its own
directory; this script embeds the material at authoring time (#381's constraint).
"""

from __future__ import annotations

import argparse
import ast
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CANONICAL_ADAPTER = ROOT / "scripts" / "course-workbench" / "workbench.py"
BLOCK_BEGIN = "# BEGIN GENERATED PORTAL EDITOR API"
BLOCK_END = "# END GENERATED PORTAL EDITOR API"
# Which package holds the *participant-facing* Portal for a problem. The default
# ("verifier") is the single-stage shape. Getting an entry wrong is not cosmetic: the
# language checks below then inspect the hidden verifier instead of the page a
# participant actually reads, and pass while the Portal shows the wrong text. That is
# exactly how cs-atomic-file-publish and cs-numeric-aggregation-order came to display
# cs-http-retry-idempotency's title and description to participants (Issue 449) with
# every gate green -- their Portal is `workbench/`, which was not listed here.
PORTAL_PACKAGES = {
    "cs-transaction-visibility-audit": "participant",
    "ac26-w4-sumcheck-drill": "participant",
    "ac26-w3-schnorr-drill": "participant",
    "ac26-w4-plonk-drill": "participant",
    "ac26-w4-fri-drill": "participant",
    "acm-validation-migration": "workbench",
    "asm-worst-case-latency": "workbench",
    "cs-atomic-file-publish": "workbench",
    "cs-dst-daily-rollup": "workbench",
    "cs-http-retry-idempotency": "workbench",
    "cs-numeric-aggregation-order": "workbench",
    "cs-pagination-drift": "workbench",
    "cs-protocol-state-guard": "workbench",
}

# The language arguments the generator owns, in the order they are emitted after
# the anchor. Everything else in the block (root, seed, submitted_files, limits,
# per-problem callables) is authored and never touched.
LANGUAGE_ARGS = (
    "problem_name",
    "problem_name_en",
    "description",
    "description_en",
    "checkpoint_labels",
    "checkpoint_labels_en",
)


def problems_with_verifier() -> list[Path]:
    return sorted(
        path.parents[2]
        for path in (ROOT / "challenges").glob("*/local/verifier/server.py")
    )


def portal_package(problem: Path) -> str:
    return PORTAL_PACKAGES.get(problem.name, "verifier")


def portal_server_path(problem: Path) -> Path:
    return problem / "local" / portal_package(problem) / "server.py"


def portal_adapter_path(problem: Path) -> Path:
    return problem / "local" / portal_package(problem) / "workbench.py"


def language_material(problem: Path) -> dict[str, object]:
    meta = json.loads((problem / "metadata.json").read_text(encoding="utf-8"))
    en = meta.get("i18n", {}).get("en", {})
    checks = meta.get("scoring", {}).get("checks", [])
    en_checks = en.get("checks", [])
    en_labels = {}
    for index, check in enumerate(checks):
        counterpart = en_checks[index] if index < len(en_checks) else {}
        label = counterpart.get("label") if isinstance(counterpart, dict) else None
        if isinstance(label, str) and label:
            en_labels[check["id"]] = label
    return {
        "problem_name": meta.get("name"),
        "problem_name_en": en.get("name"),
        "description": meta.get("shortDescription"),
        "description_en": en.get("shortDescription"),
        "checkpoint_labels": {check["id"]: check["label"] for check in checks},
        "checkpoint_labels_en": en_labels,
    }


def split_block(server_source: str, problem_id: str) -> tuple[str, str, str]:
    before, _, rest = server_source.partition(BLOCK_BEGIN)
    block, _, after = rest.partition(BLOCK_END)
    if not block:
        raise SystemExit(f"{problem_id}: the generated block markers are damaged")
    return before, block, after


def parsed_args(block: str) -> dict[str, object]:
    found: dict[str, object] = {}
    for name in LANGUAGE_ARGS:
        match = re.search(rf"^(\s+){name}=(.+),\s*$", block, re.M)
        if match is not None:
            found[name] = ast.literal_eval(match.group(2))
    return found


def regenerate_block(block: str, material: dict[str, object], problem_id: str) -> str:
    """Rewrite the six language argument lines, leaving every other line alone."""
    lines = block.split("\n")
    anchor = None
    indent = "    "
    kept: list[str] = []
    for line in lines:
        match = re.match(r"^(\s+)(problem_name|problem_name_en|description|description_en|checkpoint_labels|checkpoint_labels_en)=(.+),\s*$", line)
        if match is None:
            kept.append(line)
            continue
        indent = match.group(1)
        if anchor is None:
            anchor = len(kept)
    if anchor is None:
        raise SystemExit(f"{problem_id}: no language argument lines found in the generated block")
    emitted = [f"{indent}{name}={material[name]!r}," for name in LANGUAGE_ARGS]
    return "\n".join(kept[:anchor] + emitted + kept[anchor:])


def check_generated(problem: Path, failures: list[str]) -> None:
    problem_id = problem.name
    server_path = portal_server_path(problem)
    source = server_path.read_text(encoding="utf-8")
    _, block, _ = split_block(source, problem_id)
    material = language_material(problem)
    for name in LANGUAGE_ARGS:
        if material[name] in (None, {}, ""):
            failures.append(f"{problem_id}: metadata is missing the material for {name} (#381 requires ja and en)")
            return
    found = parsed_args(block)
    for name in LANGUAGE_ARGS:
        if name not in found:
            failures.append(
                f"{problem_id}: the generated block has no {name}= line — run scripts/generate-course-workbenches.py --write"
            )
        elif found[name] != material[name]:
            failures.append(
                f"{problem_id}: {name} in the generated block does not match metadata — run scripts/generate-course-workbenches.py --write"
            )


def write_generated(problem: Path) -> bool:
    server_path = portal_server_path(problem)
    source = server_path.read_text(encoding="utf-8")
    before, block, after = split_block(source, problem.name)
    material = language_material(problem)
    rebuilt = before + BLOCK_BEGIN + regenerate_block(block, material, problem.name) + BLOCK_END + after
    if rebuilt != source:
        server_path.write_text(rebuilt, encoding="utf-8")
        return True
    return False


def check_handwritten(problem: Path, failures: list[str]) -> None:
    """The five authored payloads: the English from metadata must appear verbatim."""
    problem_id = problem.name
    server_path = portal_server_path(problem)
    source = server_path.read_text(encoding="utf-8")
    material = language_material(problem)
    missing = []
    for label, value in (
        ("i18n.en.name", material["problem_name_en"]),
        ("i18n.en.shortDescription", material["description_en"]),
    ):
        if not isinstance(value, str) or not value:
            missing.append(f"metadata has no {label}")
        elif value not in source:
            missing.append(f"{label} is not in the payload")
    labels_en = material["checkpoint_labels_en"]
    if not isinstance(labels_en, dict) or set(labels_en) != set(material["checkpoint_labels"]):
        missing.append("metadata i18n.en.checks does not cover every checkpoint")
    else:
        for checkpoint, label in labels_en.items():
            if label not in source:
                missing.append(f"the en label for {checkpoint} is not in the payload")
    if missing:
        failures.append(
            f"{problem_id}: hand-written config_payload() drifted from metadata english — {'; '.join(missing)}. "
            f"This payload is authored, not generated: edit {server_path.relative_to(problem)} so the Portal editor "
            "carries the same english the metadata does."
        )


def check_adapter_copies(failures: list[str], write: bool) -> int:
    canonical = CANONICAL_ADAPTER.read_bytes()
    rewritten = 0
    for problem in problems_with_verifier():
        copy = portal_adapter_path(problem)
        if not copy.is_file():
            continue
        if copy.read_bytes() != canonical:
            if write:
                copy.write_bytes(canonical)
                rewritten += 1
            else:
                failures.append(
                    f"{problem.name}: {copy.relative_to(problem)} drifted from "
                    "scripts/course-workbench/workbench.py — "
                    "run scripts/generate-course-workbenches.py --write. The copies are the spec (each problem deploys "
                    "self-contained); the canonical source is where the adapter is edited."
                )
    return rewritten


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true", help="fail on any drift, change nothing")
    mode.add_argument("--write", action="store_true", help="regenerate blocks and re-distribute the adapter")
    args = parser.parse_args()

    failures: list[str] = []
    generated = 0
    handwritten = 0
    rewritten_blocks = 0

    for problem in problems_with_verifier():
        source = portal_server_path(problem).read_text(encoding="utf-8")
        if BLOCK_BEGIN in source:
            generated += 1
            if args.write:
                if write_generated(problem):
                    rewritten_blocks += 1
                check_generated(problem, failures)
            else:
                check_generated(problem, failures)
        else:
            handwritten += 1
            check_handwritten(problem, failures)

    rewritten_adapters = check_adapter_copies(failures, write=args.write)

    if args.write:
        print(
            f"regenerated {rewritten_blocks} block(s), re-distributed {rewritten_adapters} adapter copy(ies) "
            f"across {generated} generated + {handwritten} hand-written problems"
        )
    else:
        print(f"checked {generated} generated blocks, {handwritten} hand-written payloads, and the vendored adapter copies")

    for failure in failures:
        print(f"FAIL {failure}", file=sys.stderr)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
