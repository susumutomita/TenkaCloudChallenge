"""This deployment's public half, however this process can reach it.

Issue 537/543 (option B2): `fixtures/generate.py` does not ship in the `participant`
Docker stage any more. It carries `_ISZERO_HALVES` -- both halves of the is-zero
gadget as dicts, under the exact `c-iszero-a` / `c-iszero-b` ids the checkpoints
require -- so `intended_circuit()` was a copy out of that file, and `audit` and
`repair` fell out of it as a set difference against the deployed circuit. The public
half it also held (the parameters, the deployed circuit, the two honest witnesses)
is genuinely the problem statement, so it moved to the verifier's `GET /public`
rather than disappearing: see verifier/server.py and ../Dockerfile.

Everything on the participant side that used to import `fixtures.generate` -- show.py,
participant/server.py and tests/public/test_policy.py -- goes through `public_evidence`
below, so there is one resolution order rather than three.
"""

from __future__ import annotations

import json
import os

#: Injected by a caller that already has the payload (the public tests exercise both
#: branches this way, and a checkout can drive show.py without a running deployment).
PUBLIC_EVIDENCE_JSON = "PUBLIC_EVIDENCE_JSON"
#: Set by docker-compose.yml on the workbench service, pointing at the verifier's
#: `GET /public` over the internal `lab` network.
VERIFIER_PUBLIC_URL = "VERIFIER_PUBLIC_URL"


def public_evidence() -> dict:
    """The same values `verifier/server.py`'s `GET /public` serves."""
    injected = os.environ.get(PUBLIC_EVIDENCE_JSON)
    if injected:
        return json.loads(injected)

    verifier_public_url = os.environ.get(VERIFIER_PUBLIC_URL)
    if verifier_public_url:
        from urllib.error import HTTPError, URLError
        from urllib.request import urlopen

        try:
            with urlopen(verifier_public_url, timeout=10) as response:  # noqa: S310
                return json.loads(response.read().decode("utf-8"))
        except (HTTPError, URLError, TimeoutError, OSError, ValueError) as error:
            # Compose health-gates the workbench on the verifier, so this normally
            # cannot happen. When it does -- a `docker compose run` against a torn-down
            # deployment -- name the missing service instead of printing a urllib
            # traceback at somebody trying to read their own circuit.
            raise SystemExit(
                "cannot reach this deployment's verifier "
                f"({verifier_public_url}): {type(error).__name__}.\n"
                "The public evidence lives there since Issue 537/543. "
                "Start it with `make verifier-up` and try again."
            ) from error

    # Neither is set: this resolves only where `fixtures/` is actually on disk -- a
    # checkout, or the verifier/author Docker stage -- and never inside a built
    # `participant` image, so this branch does not reopen the leak above.
    from fixtures.generate import public_payload

    return public_payload(os.environ.get("FLAG_SEED", "local-dev-seed"))
