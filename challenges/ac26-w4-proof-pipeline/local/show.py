"""`make inspect` — the two pipelines, one honest run, and one run with something wrong.

The faulted run printed at the end is a real fault from the hidden set, but which one
is not announced. Reading the record against the stage contracts is the exercise.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def _public_payload() -> dict:
    """This deployment's public half -- the same values `verifier/server.py`'s
    `GET /public` serves, and the same ones this file has always printed.

    Issue 537/538 (Issue 543 option B2): `fixtures/generate.py` does not ship in the
    `participant` Docker stage any more (see local/Dockerfile). It carries
    `UNSUPPORTED_CLAIMS`, which is the `cost` checkpoint's ground truth, and `FAULTS`,
    which maps every injected fault to the layer `first_fault` must report and to the
    single field `repair` may touch -- and it shipped beside
    `tests/hidden/check_pipeline.py`, whose `_reference_first_fault` is a complete,
    correct implementation of every layer contract this problem asks a learner to write.
    `make inspect` now runs through Compose (see the Makefile) so this process can reach
    the verifier over the network instead.
    """
    injected = os.environ.get("PUBLIC_EVIDENCE_JSON")
    if injected:
        return json.loads(injected)
    verifier_public_url = os.environ.get("VERIFIER_PUBLIC_URL")
    if verifier_public_url:
        from urllib.error import HTTPError, URLError
        from urllib.request import urlopen

        try:
            with urlopen(verifier_public_url, timeout=10) as response:  # noqa: S310
                return json.loads(response.read().decode("utf-8"))
        except (HTTPError, URLError, TimeoutError, OSError, ValueError) as error:
            # Compose health-gates the workbench on the verifier, so this normally
            # cannot happen. When it does -- a `docker compose run` against a torn-down
            # deployment -- say which service is missing instead of printing a urllib
            # traceback at somebody trying to read their fixtures.
            raise SystemExit(
                "cannot reach this deployment's verifier "
                f"({verifier_public_url}): {type(error).__name__}.\n"
                "The public evidence lives there since Issue 537/538. "
                "Start it with `make verifier-up` and try again."
            ) from error
    # Neither is set: this resolves only where `fixtures/` is actually on disk -- a
    # checkout, or the verifier/author Docker stage -- and never inside a built
    # `participant` image, so this branch does not reopen the leak above.
    from fixtures.generate import public_payload

    return public_payload(SEED)


def _show_pipeline(name: str, definition: dict) -> None:
    setup = definition["setup"]
    print(f"pipeline {name}  ({definition['family']})")
    print(f"  setup      : {setup['kind']}, produces {', '.join(setup['produces'])}")
    print(f"  rests on   : {', '.join(setup['assumptions'])}")
    print(f"  min queries: {definition['min_queries']}")
    print(f"  cost       : {definition['cost']}")
    print()
    print(f"  {'stage':<12} {'layer':<16} {'consumes':<58} produces")
    for stage in definition["stages"]:
        consumes = ", ".join(stage["consumes"]) or "-"
        produces = ", ".join(stage["produces"])
        print(f"  {stage['name']:<12} {stage['layer']:<16} {consumes:<58} {produces}")
    print()


def _show_run(title: str, run: dict) -> None:
    print(title)
    for key in (
        "public",
        "secret",
        "setup_material",
        "commitment_ok",
        "committed",
        "absorbed_before_challenge",
        "openings_required",
        "openings_checked",
        "queries",
        "low_degree_checked",
        "verdict",
    ):
        value = run[key]
        rendered = ", ".join(map(str, value)) if isinstance(value, list) else str(value)
        print(f"  {key:<26} {rendered}")
    unsatisfied = [entry["id"] for entry in run["constraints"] if not entry["satisfied"]]
    print(f"  {'constraints':<26} {len(run['constraints'])} total, unsatisfied: {unsatisfied or 'none'}")
    print()


def main() -> None:
    payload = _public_payload()
    print("health token :", payload["healthToken"])
    print()
    for name in ("A", "B"):
        _show_pipeline(name, payload["pipelines"][name])

    _show_run("an honest run of A:", payload["honestRun"])

    # Deterministic from the seed, so the same deployment always shows the same one.
    _show_run("a run of B with one thing wrong:", payload["faultedRun"])
    print("Which layer's contract broke first? Every later layer will look wrong too.")
    print()

    print("claims to sort into supported and unsupported:")
    for claim in payload["claims"]:
        print(f"  {claim['id']:<34} {claim['text']}")
    print()
    print("Two of these confuse a property of the setup with a property of the assumptions.")


if __name__ == "__main__":
    main()
