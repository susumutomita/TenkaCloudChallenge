"""`make inspect` — your setting, your row, the triple you were dealt, and what the log records.

No witness value and no share value is printed: this is the same view the prover gets, which
is the point of running it before writing anything.

    make inspect            the dense coefficient vectors
    make inspect S=sparse   any of dense, sparse, signed, unit
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from participant.mpc import Runtime, linear_halves

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
    print(f"health token: {payload['healthToken']}")


if __name__ == "__main__":
    main()
