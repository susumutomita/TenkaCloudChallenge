"""`make inspect` — your setting, your row, the share labels, and what an event looks like.

The witness is not printed. Neither is any share's value: this is the same view the prover
gets, which is the point of running it before writing anything.

    make inspect            the dense coefficient vectors
    make inspect S=sparse   any of dense, sparse, signed, unit
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from participant.mpc import Runtime

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def _public_payload() -> dict:
    """This deployment's public half -- the same values `verifier/server.py`'s `GET /public`
    serves, and the same ones this file has always printed.

    Issue 537/538 (Issue 543 option B2): `fixtures/generate.py` does not ship in the
    `participant` Docker stage any more (see local/Dockerfile). It carries `setting`,
    `coefficients`, `witness` and `relation` -- the four derivations the hidden labels
    `h0`..`h3` are drawn from -- and it shipped beside `tests/hidden/check_prover.py`, which
    states what every one of this problem's eight checkpoints is graded on. `make inspect`
    now runs through Compose (see the Makefile) so this process can reach the verifier over
    the network instead.
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
            # Compose health-gates the workbench on the verifier, so this normally cannot
            # happen. When it does -- a `docker compose run` against a torn-down deployment
            # -- say which service is missing instead of printing a urllib traceback at
            # somebody trying to read their fixtures.
            raise SystemExit(
                "cannot reach this deployment's verifier "
                f"({verifier_public_url}): {type(error).__name__}.\n"
                "The public evidence lives there since Issue 537/538. "
                "Start it with `make verifier-up` and try again."
            ) from error
    # Neither is set: this resolves only where `fixtures/` is actually on disk -- a checkout,
    # or the verifier/author Docker stage -- and never inside a built `participant` image, so
    # this branch does not reopen the leak above.
    from fixtures.generate import public_payload

    return public_payload(SEED)


def main() -> None:
    payload = _public_payload()
    shapes = tuple(payload["shapes"])
    shape = os.environ.get("S") or "dense"
    if shape not in shapes:
        print(f"unknown shape {shape!r}; try one of {', '.join(shapes)}")
        raise SystemExit(1)

    cfg = payload["setting"]
    runtime = Runtime(cfg)
    row = payload["rows"][shape]
    shares = runtime.deal_witness(SEED, payload["witness"], label="pw")

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
    print(f"health token: {payload['healthToken']}")


if __name__ == "__main__":
    main()
