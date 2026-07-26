"""`make inspect` — your setting, your row, the triple you were dealt, and what the log records.

No witness value and no share value is printed: this is the same view the prover gets, which
is the point of running it before writing anything.

    make inspect            the dense coefficient vectors
    make inspect S=sparse   any of dense, sparse, signed, unit
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures.generate import (
    SHAPES,
    Runtime,
    health_token,
    linear_halves,
    relation,
    setting,
    witness,
)

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def main() -> None:
    shape = os.environ.get("S") or "dense"
    if shape not in SHAPES:
        print(f"unknown shape {shape!r}; try one of {', '.join(SHAPES)}")
        raise SystemExit(1)

    cfg = setting(SEED)
    runtime = Runtime(cfg)
    row = relation(SEED, "public", cfg, shape)
    shares = runtime.deal_witness(SEED, witness(SEED, "public", cfg), label="pw")
    halves = linear_halves(runtime, row, shares)
    triple = runtime.deal_triple(SEED, "public")

    print("== your setting ==")
    print(f"  field      p = {cfg['p']}   ({cfg['fieldId']})")
    print(f"  parties        {cfg['parties']}")
    print(f"  witness length {cfg['width']}")
    print(f"  settingId      {cfg['settingId']}")
    print()
    print(f"== the row, {shape} coefficients (public) ==")
    print(f"  a = {list(row['a'])}")
    print(f"  b = {list(row['b'])}")
    print(f"  relationId {row['relationId']}")
    print("  A = sum_j a_j w_j, B = sum_j b_j w_j, and what you build is C = A * B.")
    print()
    print("== the halves you are handed, by label ==")
    print("  Already built, one share per party. This is the previous problem's answer.")
    print(f"  [A]: {[share.id for share in halves['A']]}")
    print(f"  [B]: {[share.id for share in halves['B']]}")
    print()
    print("== the triple you are dealt ==")
    print(f"  id       {triple.id}")
    print(f"  fieldId  {triple.fieldId}   parties {triple.parties}")
    print(f"  [x]: {[share.id for share in triple.x]}")
    print(f"  [y]: {[share.id for share in triple.y]}")
    print(f"  [z]: {[share.id for share in triple.z]}")
    print("  z = x * y was fixed when the triple was drawn, before anyone knew what would")
    print("  be multiplied. The values are not yours to print.")
    print()

    print("== what an opening leaves in the record ==")
    print("  Two scratch sharings of public demo values, so you can see the shape of an")
    print("  opening record before you touch A or B.")
    scratch = runtime.deal(SEED, "demo", 5)
    reserved = runtime.reserve_triple(runtime.deal_triple(SEED, "demo"))
    masked = []
    for party in range(cfg["parties"]):
        with runtime.party_scope(party):
            masked.append(runtime.sub(scratch[party], reserved.x[party]))
    runtime.open("demo-round", tuple(masked))
    runtime.open("demo-round", scratch)
    for record in runtime.opened:
        print(f"  {record}")
    print()
    print("  Both went out under the same roundId, so the runtime counts them as one round:")
    print(f"    rounds   {runtime.rounds()}")
    print(f"    messages {runtime.messages()}   (every party sends its share, per opening)")
    print()
    print("  They are not the same kind of opening. The first names the triple share that was")
    print("  masking it; the second has an empty `maskedBy`, and the runtime recorded that:")
    for violation in runtime.violations:
        print(f"    {violation}")
    print("  It was not refused. A value published with nothing hiding it is still a value,")
    print("  and the arithmetic downstream of it can be perfectly correct.")
    print()
    print(f"health token: {health_token(SEED)}")


if __name__ == "__main__":
    main()
