"""Public tests. They show the shape of an answer; they do not prove one correct.

They run pipeline A only, on honest runs only, and they never ask what a contract does
when something is actually broken. An implementation where every contract returns `[]`
unconditionally passes this file completely -- and scores zero on the checkpoints,
because a contract that never fires is not a contract.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "starter"))

import pipeline as submission  # noqa: E402

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def _load_public_evidence() -> dict:
    """This deployment's two pipeline definitions and its one honest run of A -- what
    `show.py` prints, and what this file has always handed to the submission.

    Issue 537/538 (Issue 543 option B2): this file used to import `fixtures.generate`
    directly. That module carries `UNSUPPORTED_CLAIMS` -- the `cost` checkpoint's ground
    truth -- and `FAULTS`, which maps every injected fault to the layer `first_fault`
    must report and to the single field `repair` may touch, and it shipped in the same
    image as `tests/hidden/check_pipeline.py`, whose `_reference_first_fault` implements
    every layer contract this problem asks a learner to write. So it does not ship in
    the `participant` Docker stage at all any more (see ../../Dockerfile). This
    deployment's own verifier is the only source for the public half now:
    `PUBLIC_EVIDENCE_JSON` when the Portal has already fetched it, or
    `VERIFIER_PUBLIC_URL` fetched directly when it has not.
    """
    injected = os.environ.get("PUBLIC_EVIDENCE_JSON")
    if injected:
        return json.loads(injected)
    verifier_public_url = os.environ.get("VERIFIER_PUBLIC_URL")
    if verifier_public_url:
        from urllib.request import urlopen

        with urlopen(verifier_public_url, timeout=10) as response:  # noqa: S310
            return json.loads(response.read().decode("utf-8"))
    # Neither is set: this only resolves when `fixtures/` is actually on disk, which is
    # true for a checkout (this file run directly, e.g. by
    # scripts/ac26-w4-proof-pipeline.test.ts) and the verifier/author Docker stages, and
    # never inside a built `participant` image -- so this branch does not reopen the
    # leak above.
    from fixtures.generate import public_payload

    return public_payload(SEED)


PUBLIC = _load_public_evidence()


def definition_for(name: str) -> dict:
    """A copy, so a check mutating one cannot poison the next."""
    return json.loads(json.dumps(PUBLIC["pipelines"][name]))


def check_graph_has_a_node_per_artifact() -> str:
    definition = definition_for("A")
    graph = submission.artifact_graph(definition)
    if not isinstance(graph, dict) or "commitment" not in graph:
        return "the artifact graph has no node for the commitment"
    if graph["commitment"].get("produced_by") != "commit":
        return "the commitment is not attributed to the stage that produces it"
    return ""


def check_layer_order_starts_at_the_boundary() -> str:
    order = submission.layer_order(definition_for("A"))
    if list(order)[:1] != ["input-boundary"]:
        return "the layer order does not start at the input boundary"
    return ""


def check_an_honest_run_is_clean() -> str:
    definition = definition_for("A")
    run = json.loads(json.dumps(PUBLIC["honestRun"]))
    if submission.first_fault(definition, run) is not None:
        return "an honest run was diagnosed with a fault"
    return ""


CHECKS = (
    ("graph-has-a-node-per-artifact", check_graph_has_a_node_per_artifact),
    ("layer-order-starts-at-the-boundary", check_layer_order_starts_at_the_boundary),
    ("an-honest-run-is-clean", check_an_honest_run_is_clean),
)


def main(argv: list[str]) -> int:
    only = argv[argv.index("--only") + 1] if "--only" in argv else ""
    failed = 0
    for name, check in CHECKS:
        if only and only not in name:
            continue
        try:
            message = check()
        except Exception as error:  # noqa: BLE001 - a crash is a failure, reported as one
            message = f"raised {type(error).__name__}"
        if message:
            print(f"FAIL {name}: {message}")
            failed += 1
        else:
            print(f"ok   {name}")
    print(f"\npublic tests: {failed} failed" if failed else "\npublic tests: all passed")
    if not failed:
        print("\nNothing here was broken, and broken runs are what the checkpoints grade.")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
