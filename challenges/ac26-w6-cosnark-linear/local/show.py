"""`make inspect` — your setting, your row, the share labels, and what an event looks like.

The witness is not printed. Neither is any share's value: this is the same view the prover
gets, which is the point of running it before writing anything.

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

    print("== your setting ==")
    print(f"  field      p = {cfg['p']}   ({cfg['fieldId']})")
    print(f"  parties        {cfg['parties']}")
    print(f"  witness length {cfg['width']}")
    print(f"  settingId      {cfg['settingId']}")
    print()
    print(f"== the row, {shape} coefficients (public) ==")
    print(f"  a = {list(row['a'])}")
    print(f"  b = {list(row['b'])}")
    if shape == "signed":
        print("  Note the negative entries. They name field elements; they are not the")
        print("  canonical names for them.")
    if shape == "sparse":
        print("  Note the zeros. a_j still multiplies w_j, not the j-th surviving term.")
    print()
    print("== the shared witness, by label ==")
    print("  shares[j][party] — ids only. The values are not yours to print, and the")
    print("  witness they add up to is not printed anywhere.")
    for index, sharing in enumerate(shares):
        print(f"  w{index}: {[share.id for share in sharing]}")
    print()

    print("== what an operation leaves in the log ==")
    print("  A scratch sharing of a public demo value, so you can see the shape of an event")
    print("  before you touch the witness.")
    demo = runtime.deal(SEED, "demo", 1)
    with runtime.party_scope(0):
        accumulator = runtime.zero()
        scaled = runtime.mul_public(demo[0], 3)
        total = runtime.add(accumulator, scaled)
    for event in runtime.events:
        print(f"  {event}")
    print()
    print(f"  result share: party={total.party} field={total.field!r} id={total.id!r}")
    print(f"  ancestry:     {sorted(runtime.ancestry(total))}")
    print(f"  issued here:  {runtime.issued(total)}")
    print()
    print("  No value appears in any of those rows, and `communication` is False on all of")
    print("  them. There is nothing in the runtime that could set it — which is what makes")
    print("  checkpoint 6 a measurement rather than a recital.")
    print()
    print(f"health token: {health_token(SEED)}")


if __name__ == "__main__":
    main()
