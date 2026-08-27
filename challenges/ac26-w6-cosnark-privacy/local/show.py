"""`make inspect` — your setting, your row, the policy, and what one clean run leaves behind.

No witness value and no share value is printed, and no specimen is run unless you name one.
The clean prover below is written out here rather than taken from the specimens: it is
`beaver_product` plus a `clean_artifact`, both of which were supplied to you, so seeing it
gives away nothing about which of the eight are honest.

    make inspect            the dense coefficient vectors
    make inspect S=sparse   any of dense, sparse, signed, unit
    make inspect P=S3       also run one specimen and print everything it left behind

Issue 537/538 (Issue 543 option B2): the setting, the row, the witness and the catalog below
come from the verifier's `GET /public` over the Compose-internal network, not from
`fixtures/generate.py`, which does not ship in the participant image any more (see
local/Dockerfile and participant/lab.py). `make inspect` therefore runs through Compose --
see the Makefile.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from participant.mpc import (
    ALLOWED_NAMES,
    CHANNELS,
    CLASSES,
    PROTOCOL_CAPABILITIES,
    SHARING_ONLY_NAMES,
    beaver_product,
    clean_artifact,
    round_id_for,
)
from participant.lab import (
    Scenario,
    health_token,
    run_on,
    serialized,
    shapes,
    value_catalog,
)
from participant.specimens import SPECIMEN_IDS

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def _clean_run(scenario: Scenario) -> None:
    """One prover that gives nothing away, built out of the two pieces you were handed."""
    proof = beaver_product(scenario.audit, scenario.row, scenario.halves, scenario.triple)
    scenario.sink.emit(
        "multiplication", tripleId=proof["tripleId"], roundId=proof["roundId"]
    )
    scenario.sink.emit("opened", d=proof["d"], e=proof["e"])
    scenario.sink.metric("openings", len(scenario.audit.openings()))
    scenario.sink.publish(clean_artifact(scenario.row, proof))


def main() -> None:
    available = shapes(SEED)
    shape = os.environ.get("S") or "dense"
    if shape not in available:
        print(f"unknown shape {shape!r}; try one of {', '.join(available)}")
        raise SystemExit(1)

    scenario = Scenario(SEED, "public", shape)
    cfg, row = scenario.cfg, scenario.row

    print("== your setting ==")
    print(f"  field      p = {cfg['p']}   ({cfg['fieldId']})")
    print(f"  parties        {cfg['parties']}")
    print(f"  witness length {cfg['width']}")
    print(f"  settingId      {cfg['settingId']}")
    print()
    print(f"== the row, {shape} coefficients (public) ==")
    print(f"  a = {list(row['a'])}")
    print(f"  b = {list(row['b'])}")
    print(f"  relationId    {row['relationId']}")
    print(f"  declared round {round_id_for(row)}   <- the one round a multiplication may open in")
    print()

    print("== the eight provers you are auditing ==")
    print(f"  {', '.join(SPECIMEN_IDS)}")
    print("  Every one of them reconstructs C to A * B. That is the premise, not a hint.")
    print("  Their source is not the evidence. Run them and read what they leave behind.")
    print()

    print("== the policy ==")
    print(f"  channels            {', '.join(CHANNELS)}")
    print(f"  allowed names       {', '.join(ALLOWED_NAMES)}")
    print(f"  sharing-only names  {', '.join(SHARING_ONLY_NAMES)}")
    print(f"  the protocol's own  {', '.join(PROTOCOL_CAPABILITIES)}")
    print(f"  classes             {', '.join(CLASSES)}")
    print()

    print("== two entries from the catalog `classify` is graded on ==")
    for entry in value_catalog(SEED, "public", row)[:2]:
        print(f"  {entry}")
    print("  Descriptors, not names. Two of the sixteen were opened and are still secret.")
    print()

    _clean_run(scenario)
    disclosure = scenario.sink.disclosure()
    print("== what one clean run leaves behind ==")
    print("  reached (capability, party, operands -- never a value):")
    for record in scenario.audit.reached():
        print(f"    {record}")
    print("  openings:")
    for record in scenario.audit.openings():
        print(f"    {record}")
    print("  disclosure:")
    print(f"    artifact keys {sorted(disclosure.artifact)}")
    print(f"    log           {[record['event'] for record in disclosure.log]}")
    print(f"    metrics       {sorted(disclosure.metrics)}")
    print(f"    error         {disclosure.error}")
    print()
    print("  The artifact's A, B and C are sharings, and the same artifact serialized for a")
    print("  next stage carries their ids rather than the objects:")
    print(f"    {serialized(disclosure).artifact['C']}")
    print()

    named = os.environ.get("P") or ""
    if named:
        if named not in SPECIMEN_IDS:
            print(f"unknown specimen {named!r}; try one of {', '.join(SPECIMEN_IDS)}")
            raise SystemExit(1)
        probed = Scenario(SEED, "public", shape)
        evidence = run_on(probed, named)
        print(f"== {named}, run once on an honest row ==")
        print(f"  raised   {evidence.raised}")
        print(f"  reached  {[record['capability'] for record in evidence.runtime.reached()]}")
        print("  openings:")
        for record in evidence.runtime.openings():
            print(f"    {record}")
        print("  disclosure:")
        print(f"    artifact  {serialized(evidence.disclosure).artifact}")
        print(f"    log       {list(serialized(evidence.disclosure).log)}")
        print(f"    metrics   {serialized(evidence.disclosure).metrics}")
        print(f"    error     {serialized(evidence.disclosure).error}")
        print()
        print("  One run is one input. Some defects need a different one.")
        print()

    print(f"health token: {health_token(SEED)}")


if __name__ == "__main__":
    main()
