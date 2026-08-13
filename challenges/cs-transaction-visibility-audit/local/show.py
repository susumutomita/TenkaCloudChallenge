"""`make inspect` — seeded evidence for the two direct-answer checkpoints."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures.generate import audit_fixture, counterexample_fixture

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def main() -> None:
    audit = audit_fixture(SEED)
    counterexample = counterexample_fixture(SEED)

    print("== checkpoint: audit ==")
    print()
    print("Committed ledger states. Every transfer preserves the total:")
    print(json.dumps(audit["committed"], ensure_ascii=False, indent=2))
    print()
    print("Reports emitted by the old service. Each row read was committed when read:")
    print(json.dumps(audit["reports"], ensure_ascii=False, indent=2))
    print()
    print("Submit JSON with exactly this shape:")
    print('  {"reportId":"...","observedRevisions":[first,second]}')
    print("Name the one report whose rows cannot describe any committed state.")
    print()

    print("== checkpoint: counterexample ==")
    print()
    print("The old service always reads accounts in this order:")
    for index, account_id in enumerate(counterexample["readOrder"], start=1):
        print(f"  read {index}: {account_id}")
    print()
    print(f"Place one candidate commit after read {counterexample['commitAfterRead']}:")
    for candidate in counterexample["candidates"]:
        assert isinstance(candidate, dict)
        print(
            f"  {candidate['transferId']}: {candidate['source']} -> "
            f"{candidate['destination']} ({candidate['amount']} points)"
        )
    print()
    print("Submit the schedule as JSON with exactly this shape:")
    print('  {"beforeCommit":["...","..."],"commit":"tx-...",')
    print('   "afterCommit":["...","..."]}')
    print("Choose the commit that makes the mixed report total impossible.")


if __name__ == "__main__":
    main()
