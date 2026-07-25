"""Author-side check: break the reference on purpose and confirm the hidden tests notice.

Every mutation here produces a protocol that runs. Commit, challenge, open, verify: green
on each one. They differ only in what an adversary can do afterwards, which is why the
checkpoints attack rather than round-trip.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from tests.hidden import check_commit  # noqa: E402

REFERENCE = (ROOT / "reference" / "commit.py").read_text(encoding="utf-8")
SEED = "mutation-suite-seed"

MUTATIONS: tuple[tuple[str, list[tuple[str, str]]], ...] = (
    (
        "does not bind the leaf's index",
        [
            (
                '    return LEAF_TAG + index.to_bytes(4, "big") + value.to_bytes(8, "big")',
                '    return LEAF_TAG + value.to_bytes(8, "big")',
            )
        ],
    ),
    (
        "encodes the fields with no separator, so they can run together",
        [
            (
                '    return LEAF_TAG + index.to_bytes(4, "big") + value.to_bytes(8, "big")',
                '    return LEAF_TAG + f"{index}{value}".encode()',
            )
        ],
    ),
    (
        "ignores which side each sibling is on",
        [
            (
                "        node = node_hash(sibling, node) if step[\"sibling_is_left\"] else node_hash(node, sibling)",
                "        node = node_hash(node, sibling)",
            )
        ],
    ),
    (
        # The range check in `verify_opening` is NOT here: the domain tags already make
        # an out-of-tree leaf unmatchable, so removing it is an equivalent mutant. The
        # one in `receive_challenge` is different -- a negative index wraps silently and
        # the prover opens a row nobody asked about.
        "accepts a query index outside the vector, so a negative one wraps",
        [
            (
                '        if not 0 <= index < len(self.values):\n            raise ProtocolError("the query index is outside the vector")\n        self.query = index',
                "        self.query = index",
            )
        ],
    ),
    (
        "combines two children without regard to order",
        [
            (
                "    return hashlib.sha256(NODE_TAG + left + right).digest()",
                "    return hashlib.sha256(NODE_TAG + bytes(sorted(left + right))).digest()",
            )
        ],
    ),
    (
        "leaves the commitment out of the challenge transcript",
        [
            (
                '            len(statement).to_bytes(4, "big"),\n            statement,\n            root,',
                '            len(statement).to_bytes(4, "big"),\n            statement,',
            )
        ],
    ),
    (
        "concatenates the transcript's variable-length fields without lengths",
        [
            (
                '            len(domain_bytes).to_bytes(4, "big"),\n            domain_bytes,\n            len(statement).to_bytes(4, "big"),\n            statement,',
                "            domain_bytes,\n            statement,",
            )
        ],
    ),
    (
        "accepts a challenge before anything has been committed",
        [
            (
                '        if self.phase != "committed":\n            raise ProtocolError("a challenge before a commitment is not a challenge")',
                "        pass",
            )
        ],
    ),
    (
        "returns the honest vector as the adaptive witness",
        [
            (
                "    forged = [(value + 1) % 10_000 for value in honest]\n    forged[query] = honest[query]",
                "    forged = list(honest)",
            )
        ],
    ),
)


def _load(source: str):
    import types

    module = types.ModuleType("mutant")
    exec(compile(source, "<mutant>", "exec"), module.__dict__)  # noqa: S102 - author tool
    return module


def main() -> int:
    baseline = check_commit.run(_load(REFERENCE), SEED)
    if baseline:
        print(f"FAIL reference implementation does not pass the hidden tests: {baseline}")
        return 1
    print("PASS reference implementation passes the hidden tests")

    survivors = 0
    for name, substitutions in MUTATIONS:
        missing = [needle for needle, _ in substitutions if needle not in REFERENCE]
        if missing:
            print(f"SURVIVED {name} (the mutation no longer applies to the reference)")
            survivors += 1
            continue
        mutated = REFERENCE
        for needle, replacement in substitutions:
            mutated = mutated.replace(needle, replacement)
        try:
            failures = check_commit.run(_load(mutated), SEED)
        except Exception as error:  # noqa: BLE001 - a mutation that crashes is caught
            failures = [f"raised {type(error).__name__}"]
        if failures:
            print(f"KILLED {name} ({failures[0]})")
        else:
            print(f"SURVIVED {name}")
            survivors += 1

    if survivors:
        print(f"\n{survivors} mutation(s) survived. The hidden tests have a hole.")
        return 1
    print(f"\nAll {len(MUTATIONS)} mutations killed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
