"""`make inspect` — the audit log you were handed, and what is not in it."""

from __future__ import annotations

import os
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures.generate import NONCE_SPACE, audit_log, health_token, toy_group

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def main() -> None:
    group = toy_group(SEED)
    log = audit_log(SEED, "public", group)
    records = log["records"]

    print("health token :", health_token(SEED))
    print(f"group        : y^2 = x^3 + {group.a}x + {group.b} (mod {group.p}), order n = {group.n}")
    print(f"records      : {len(records)}")
    print()
    print("the log holds, per signature: message, public key, commitment R, response z.")
    print("it does not hold any secret key. that was the point of keeping a log.")
    print()
    print("  #   public key        commitment        response")
    for index, record in enumerate(records):
        public = record.get("public_key")
        commitment = record.get("commitment")
        response = record.get("response")
        print(f"  {index:<3} {str(public):<17} {str(commitment):<17} {response}")
    print()
    counts = Counter(str(record.get("commitment")) for record in records)
    repeated = [value for value, count in counts.items() if count > 1]
    print(f"commitments appearing more than once: {repeated or 'none'}")
    print()
    print("Some rows are malformed. At least one parses cleanly and does not verify.")
    print("Not every duplicate is an opportunity — work out which ones are.")
    print()
    print(f"The weak generator in fixtures.generate draws from {NONCE_SPACE} values.")
    print("Predict how many collisions 40 draws produce before you measure it.")


if __name__ == "__main__":
    main()
