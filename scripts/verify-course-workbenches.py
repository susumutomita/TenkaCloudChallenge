#!/usr/bin/env python3
"""Contract checks for the course containers consumed by Participant Portal.

The existing per-problem suites remain the source of truth for cryptographic grading.
This test guards the delivery layer added by the migration: every target must be
reachable from the Portal, expose only authored evidence, preserve raw code submission
compatibility, and bind direct answers to the current deployment.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SHARED_TARGETS = (
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
# Execute the heavier inspect/public-test adapter on representative problems from
# each family. The catalogue's existing sharded suite executes every problem's own
# public, reference, mutation, and verifier tests.
REPRESENTATIVES = {
    "ac26-w2-secret-sharing",
    "ac26-w3-schnorr",
    "ac26-w5-pbs-homnand",
    "ac26-w7-capstone-demo",
    "sha256-compress-digest",
}
FORBIDDEN_DOC_TERMS = (
    "Browser Workbench",
    "open the endpoint",
)

PROBE = r'''
import json
import sys
from pathlib import Path

sys.path.insert(0, ".")
from verifier.server import CHECKPOINTS, _WORKBENCH

config = _WORKBENCH.config_payload()
starter = _WORKBENCH.starter_payload()
metadata = json.loads(Path("..", "metadata.json").read_text(encoding="utf-8"))
checks = {item["id"]: item for item in metadata["scoring"]["checks"]}
assert tuple(config["submittedFiles"]) == tuple(starter)
assert tuple(item["id"] for item in config["checkpoints"]) == tuple(CHECKPOINTS)
assert all(isinstance(value, str) and value.strip() for value in starter.values())
for item in config["checkpoints"]:
    expected_input = "multiline" if item["kind"] == "code" else "text"
    assert checks[item["id"]].get("input", "text") == expected_input

# [#381] The Portal editor must carry the English the metadata already has.
en = metadata.get("i18n", {}).get("en", {})
served = config.get("i18n", {}).get("en", {})
assert served.get("name") == en.get("name"), "config i18n.en.name != metadata i18n.en.name"
assert served.get("description") == en.get("shortDescription"), "config i18n.en.description != metadata i18n.en.shortDescription"
expected_labels = {item["id"]: en["checks"][index]["label"] for index, item in enumerate(metadata["scoring"]["checks"])}
assert served.get("checkpointLabels") == expected_labels, "config i18n.en.checkpointLabels != metadata i18n.en.checks labels"

manual = {
    item["id"]: "0"
    for item in config["checkpoints"]
    if item["kind"] == "answer"
}
prepared = _WORKBENCH.prepare_submissions(starter, manual)
assert prepared["ok"] is True
assert set(prepared["submissions"]) == set(CHECKPOINTS)

for item in config["checkpoints"]:
    checkpoint = item["id"]
    submission = prepared["submissions"][checkpoint]
    if item["kind"] == "code":
        assert submission.startswith("tcw1.")
        assert "\n" not in submission and "\r" not in submission
        expected_source = starter[config["submittedFiles"][0]] if len(starter) == 1 else json.dumps(starter, separators=(",", ":"), ensure_ascii=False)
        assert _WORKBENCH.unwrap_submission(checkpoint, submission) == expected_source
        # Existing callers that still submit raw source remain compatible.
        assert _WORKBENCH.unwrap_submission(checkpoint, expected_source) == expected_source
    else:
        assert _WORKBENCH.unwrap_submission(checkpoint, "0") is None
        assert _WORKBENCH.unwrap_submission(checkpoint, submission) == 0
        other = type(_WORKBENCH)(
            root=_WORKBENCH.root,
            seed=_WORKBENCH.seed + ":other",
            problem_id=_WORKBENCH.problem_id,
            problem_name=_WORKBENCH.problem_name,
            description=_WORKBENCH.description,
            submitted_files=_WORKBENCH.submitted_files,
            code_checkpoints=_WORKBENCH.code_checkpoints,
            checkpoints=_WORKBENCH.checkpoints,
            checkpoint_labels=_WORKBENCH.checkpoint_labels,
            max_body_bytes=_WORKBENCH.max_body_bytes,
            run_timeout_seconds=_WORKBENCH.run_timeout_seconds,
            max_output_bytes=_WORKBENCH.max_output_bytes,
            limit_fn=_WORKBENCH.limit_fn,
        )
        assert other.unwrap_submission(checkpoint, submission) is None

result = {"config": config, "prepared": len(prepared["submissions"])}
if sys.argv[1] == "heavy":
    inspection = _WORKBENCH.inspect_payload()
    assert isinstance(inspection.get("output"), str) and inspection["output"].strip()
    public = _WORKBENCH.run_public_tests(starter)
    assert isinstance(public.get("passed"), bool)
    assert isinstance(public.get("output"), str) and public["output"].strip()
    result["publicPassed"] = public["passed"]
print(json.dumps(result, ensure_ascii=False))
'''

# The first four course problems predate the shared adapter above. Keep their code
# checkpoint declarations explicit while verifying the same Portal editor contract.
LEGACY_CODE_CHECKPOINTS = {
    "ac26-bridge-experiment": {"generalize"},
    "ac26-bridge-properties": {"transfer"},
    "ac26-w1-constraint-lab": {"residuals", "boolean", "membership", "transfer"},
    "ac26-w1-underconstraint": {"build", "audit", "exploit", "repair", "mutation-transfer"},
}
PASSKEY_TARGET = "ac26-w3-passkey-assertion"
ALL_TARGETS = (*LEGACY_CODE_CHECKPOINTS, *SHARED_TARGETS, PASSKEY_TARGET)

LEGACY_PROBE = r'''
import json
import sys
from pathlib import Path

sys.path.insert(0, ".")
from verifier.server import CHECKPOINTS, config_payload, starter_payload

config = config_payload()
starter = starter_payload()
metadata = json.loads(Path("..", "metadata.json").read_text(encoding="utf-8"))
checks = {item["id"]: item for item in metadata["scoring"]["checks"]}

assert config["id"] == metadata["id"]
assert tuple(config["submittedFiles"]) == tuple(starter)
assert tuple(item["id"] for item in config["checkpoints"]) == tuple(CHECKPOINTS)
assert all(isinstance(value, str) and value.strip() for value in starter.values())
for item in config["checkpoints"]:
    assert item["kind"] in ("code", "answer")
    assert isinstance(item["label"], str) and item["label"].strip()
    expected_input = "multiline" if item["kind"] == "code" else "text"
    assert checks[item["id"]].get("input", "text") == expected_input

# [#381] The Portal editor must carry the English the metadata already has.
en = metadata.get("i18n", {}).get("en", {})
served = config.get("i18n", {}).get("en", {})
assert served.get("name") == en.get("name"), "config i18n.en.name != metadata i18n.en.name"
assert served.get("description") == en.get("shortDescription"), "config i18n.en.description != metadata i18n.en.shortDescription"
expected_labels = {item["id"]: en["checks"][index]["label"] for index, item in enumerate(metadata["scoring"]["checks"])}
assert served.get("checkpointLabels") == expected_labels, "config i18n.en.checkpointLabels != metadata i18n.en.checks labels"

print(json.dumps(config, ensure_ascii=False))
'''

PASSKEY_PROBE = r'''
import json
import sys
from pathlib import Path

sys.path.insert(0, ".")
from verifier.server import CHECKPOINTS, config_payload, prepare_submissions, starter_payload

config = config_payload()
starter = starter_payload()
metadata = json.loads(Path("..", "metadata.json").read_text(encoding="utf-8"))
checks = {item["id"]: item for item in metadata["scoring"]["checks"]}

assert config["id"] == metadata["id"]
assert tuple(config["submittedFiles"]) == tuple(starter)
assert tuple(item["id"] for item in config["checkpoints"]) == tuple(CHECKPOINTS)
assert all(item["kind"] == "code" for item in config["checkpoints"])
assert all(checks[checkpoint].get("input") == "multiline" for checkpoint in CHECKPOINTS)
prepared = prepare_submissions("portal-contract-seed", starter)
assert prepared["ok"] is True
assert set(prepared["submissions"]) == set(CHECKPOINTS)
assert all(value == starter["assertion.py"] for value in prepared["submissions"].values())

# [#381] The Portal editor must carry the English the metadata already has.
en = metadata.get("i18n", {}).get("en", {})
served = config.get("i18n", {}).get("en", {})
assert served.get("name") == en.get("name"), "config i18n.en.name != metadata i18n.en.name"
assert served.get("description") == en.get("shortDescription"), "config i18n.en.description != metadata i18n.en.shortDescription"
expected_labels = {item["id"]: en["checks"][index]["label"] for index, item in enumerate(metadata["scoring"]["checks"])}
assert served.get("checkpointLabels") == expected_labels, "config i18n.en.checkpointLabels != metadata i18n.en.checks labels"

print(json.dumps(config, ensure_ascii=False))
'''


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def check_static(problem_id: str) -> None:
    problem = ROOT / "challenges" / problem_id
    local = problem / "local"
    metadata = json.loads((problem / "metadata.json").read_text(encoding="utf-8"))
    runtime = metadata.get("runtime")
    require(isinstance(runtime, dict), f"{problem_id}: runtime missing")
    verify_url = runtime.get("verifyUrl")
    require(
        isinstance(verify_url, str) and verify_url.endswith("/verify"),
        f"{problem_id}: bad verifyUrl",
    )
    require(
        "challengeEndpoints" not in runtime,
        f"{problem_id}: duplicate challenge endpoint remains",
    )

    for relative in ("verifier/server.py",):
        require((local / relative).is_file(), f"{problem_id}: missing local/{relative}")
    require(not (local / "workbench").exists(), f"{problem_id}: duplicate UI assets remain")
    if problem_id in SHARED_TARGETS:
        require(
            (local / "verifier" / "workbench.py").is_file(),
            f"{problem_id}: shared Portal API adapter missing",
        )

    dockerfile = (local / "Dockerfile").read_text(encoding="utf-8")
    require("COPY workbench/" not in dockerfile, f"{problem_id}: image still copies duplicate UI")
    require(
        " AS participant" in dockerfile and " AS author" in dockerfile,
        f"{problem_id}: stage split lost",
    )

    server = (local / "verifier" / "server.py").read_text(encoding="utf-8")
    support_path = local / "verifier" / "workbench.py"
    support = support_path.read_text(encoding="utf-8") if support_path.is_file() else ""
    require("/api/config" in server and "/api/inspect" in server, f"{problem_id}: GET APIs missing")
    require("/api/test" in server and "/api/prepare" in server, f"{problem_id}: POST APIs missing")
    require("content-security-policy" in server, f"{problem_id}: CSP missing")
    require("WORKBENCH_ASSETS" not in server, f"{problem_id}: asset map remains")
    require("_WORKBENCH.asset" not in server, f"{problem_id}: asset route remains")
    require("shell=True" not in server + support, f"{problem_id}: shell=True introduced")
    require("os.system" not in server + support, f"{problem_id}: os.system introduced")
    require(
        "from reference" not in support and "tests.hidden" not in support,
        f"{problem_id}: answers leaked into adapter",
    )

    instructions = str(metadata.get("instructions") or "")
    require(
        "Participant Portal" in instructions,
        f"{problem_id}: instructions do not start in Participant Portal",
    )
    documents = [json.dumps(metadata, ensure_ascii=False)]
    for readme in ("README.md", "README.ja.md"):
        text = (problem / readme).read_text(encoding="utf-8")
        require("Participant Portal" in text, f"{problem_id}: {readme} omits Portal path")
        documents.append(text)
    combined = "\n".join(documents).casefold()
    for term in FORBIDDEN_DOC_TERMS:
        require(
            term.casefold() not in combined,
            f"{problem_id}: obsolete host-only direction remains: {term}",
        )


def check_runtime(problem_id: str) -> None:
    mode = "heavy" if problem_id in REPRESENTATIVES else "light"
    completed = subprocess.run(
        [sys.executable, "-I", "-c", PROBE, mode],
        cwd=ROOT / "challenges" / problem_id / "local",
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        timeout=180,
        check=False,
    )
    require(
        completed.returncode == 0,
        f"{problem_id}: runtime probe failed\n{completed.stdout}",
    )
    payload = json.loads(completed.stdout.strip().splitlines()[-1])
    require(payload["prepared"] > 0, f"{problem_id}: no Portal submissions prepared")


def check_legacy_input_contract(problem_id: str, code_checkpoints: set[str]) -> None:
    metadata_path = ROOT / "challenges" / problem_id / "metadata.json"
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    checks = metadata["scoring"]["checks"]
    actual = {check["id"] for check in checks if check.get("input", "text") == "multiline"}
    require(
        actual == code_checkpoints,
        f"{problem_id}: multiline checkpoints {sorted(actual)} != {sorted(code_checkpoints)}",
    )
    server = (ROOT / "challenges" / problem_id / "local" / "verifier" / "server.py").read_text(
        encoding="utf-8"
    )
    require("/api/config" in server, f"{problem_id}: GET /api/config missing")

    completed = subprocess.run(
        [sys.executable, "-I", "-c", LEGACY_PROBE],
        cwd=ROOT / "challenges" / problem_id / "local",
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        timeout=30,
        check=False,
    )
    require(
        completed.returncode == 0,
        f"{problem_id}: generic Portal editor config probe failed\n{completed.stdout}",
    )


def check_passkey_contract() -> None:
    completed = subprocess.run(
        [sys.executable, "-I", "-c", PASSKEY_PROBE],
        cwd=ROOT / "challenges" / PASSKEY_TARGET / "local",
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        timeout=30,
        check=False,
    )
    require(
        completed.returncode == 0,
        f"{PASSKEY_TARGET}: Portal editor config probe failed\n{completed.stdout}",
    )


def main() -> int:
    for problem_id, code_checkpoints in LEGACY_CODE_CHECKPOINTS.items():
        check_static(problem_id)
        check_legacy_input_contract(problem_id, code_checkpoints)
        print(f"PASS {problem_id} input and config contract")
    for problem_id in SHARED_TARGETS:
        check_static(problem_id)
        check_runtime(problem_id)
        print(f"PASS {problem_id}")
    check_static(PASSKEY_TARGET)
    check_passkey_contract()
    print(f"PASS {PASSKEY_TARGET}")
    print(f"\n{len(ALL_TARGETS)} Portal editor API contracts passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
