"""Print the seeded evidence without revealing the direct answer."""

from __future__ import annotations

import json
import os

from fixtures.generate import audit_evidence, health_token

seed = os.environ.get("FLAG_SEED", "local-dev-seed")
print(json.dumps({"healthToken": health_token(seed), "audit": audit_evidence(seed)}, indent=2))
