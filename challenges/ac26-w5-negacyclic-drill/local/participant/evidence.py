"""Read this deployment's public assignments from the internal verifier.

Fixture generation and expected values never ship in the participant image.
Only the public payload travels. An author can inject the same public JSON
for a local test; a checkout-only fallback is unavailable in participant images.
"""

from __future__ import annotations

import json
import os

#: Injected by a caller that already has the payload (a checkout can drive show.py
#: without a running deployment this way).
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
            # cannot happen. When it does — a `docker compose run` against a torn-down
            # deployment — name the missing service instead of printing a urllib
            # traceback at somebody trying to read their own numbers.
            raise SystemExit(
                "cannot reach this deployment's verifier "
                f"({verifier_public_url}): {type(error).__name__}.\n"
                "The public evidence lives there since Issue 537/543. "
                "Start it with `make verifier-up` and try again."
            ) from error

    # Neither is set: this resolves only where `fixtures/` is actually on disk — a
    # checkout, or the verifier/author Docker stage — and never inside a built
    # `participant` image, so this branch does not reopen the leak above. Only the
    # public half is taken; the expected values `setting` also returns stay behind.
    from fixtures.generate import assignments, setting, submission_binding

    seed = os.environ.get("FLAG_SEED", "local-dev-seed")
    return {"assignments": assignments(seed), "public": setting(seed)["public"], "submissionBinding": submission_binding(seed)}
