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
    # The lenient checkpoint: the four schemes are fixed in the fixtures, so what can go
    # wrong is the answer -- declining everywhere, forging where the scheme is sound, or
    # a forgery built on the wrong tree.
    (
        "returns None for every lenient scheme",
        [('FORGEABLE_SCHEMES = ("A", "B")', "FORGEABLE_SCHEMES = ()")],
    ),
    (
        "claims a forgery against scheme C, whose leaf binds its index",
        [('FORGEABLE_SCHEMES = ("A", "B")', 'FORGEABLE_SCHEMES = ("A", "B", "C")')],
    ),
    (
        "claims a forgery against scheme D, whose verifier derives the sides from the index",
        [('FORGEABLE_SCHEMES = ("A", "B")', 'FORGEABLE_SCHEMES = ("A", "B", "D")')],
    ),
    (
        "returns the honest opening as the forgery",
        [
            (
                "            claims = ((index, value) for index in range(length) if index != position)",
                "            claims = ((position, value),)",
            )
        ],
    ),
    (
        "builds the forged path with the honest leaf instead of the scheme's",
        [
            (
                "    level = [_scheme_leaf(scheme, position, value) for position, value in enumerate(values)]",
                "    level = [leaf_hash(position, value) for position, value in enumerate(values)]",
            )
        ],
    ),
    (
        "flips the side of every sibling in the forged path",
        [
            (
                '        path.append({"hash": level[sibling], "sibling_is_left": sibling < position})\n'
                "        level = [node_hash(level[i], level[i + 1]) for i in range(0, len(level), 2)]\n"
                "        position //= 2\n"
                "    return path\n"
                "\n"
                "\n"
                "def _split_claims",
                '        path.append({"hash": level[sibling], "sibling_is_left": sibling > position})\n'
                "        level = [node_hash(level[i], level[i + 1]) for i in range(0, len(level), 2)]\n"
                "        position //= 2\n"
                "    return path\n"
                "\n"
                "\n"
                "def _split_claims",
            )
        ],
    ),
    (
        "accepts a split with a leading zero for scheme B",
        [
            (
                "        if str(other_index) != head or str(other_value) != tail:\n"
                "            continue  # a leading zero: this split does not render back to the same text\n",
                "",
            )
        ],
    ),
)


def _load(source: str):
    import types

    module = types.ModuleType("mutant")
    exec(compile(source, "<mutant>", "exec"), module.__dict__)  # noqa: S102 - author tool
    return module


def _fixture_checks() -> list[str]:
    """The four lenient verifiers themselves, before any mutant is judged by them.

    Every scheme accepts every honest opening of its own tree; the reference forges
    exactly the schemes `FORGEABLE_SCHEMES` names; and the relabelling that gets
    through A and B is rejected by C and D, whichever position it is moved to. A
    flipped side flag is rejected by A, B and C, and ignored by D, which does not read
    it.
    """
    from fixtures import generate as fixtures  # noqa: PLC0415 - imported late, after sys.path

    reference = _load(REFERENCE)
    problems: list[str] = []
    for label in ("fixture-a", "fixture-b", "fixture-c", "fixture-d", "fixture-e"):
        cfg = fixtures.lenient_setting(f"{SEED}:{label}", "h0")
        values, length = list(cfg["values"]), cfg["length"]
        roots = {scheme: fixtures.scheme_root(scheme, values) for scheme in fixtures.SCHEMES}
        for scheme in fixtures.SCHEMES:
            for index in range(length):
                honest = fixtures.scheme_opening(scheme, values, index)
                if not fixtures.lenient_verify(scheme, roots[scheme], index, values[index], honest, length):
                    problems.append(f"scheme {scheme} rejects an honest opening ({label}, {index})")
                flipped = [
                    {"hash": step["hash"], "sibling_is_left": not step["sibling_is_left"]}
                    for step in honest
                ]
                accepted = fixtures.lenient_verify(scheme, roots[scheme], index, values[index], flipped, length)
                if accepted != (scheme == "D"):
                    problems.append(f"scheme {scheme} {'accepts' if accepted else 'rejects'} flipped sides ({label}, {index})")
            answer = reference.lenient_opening({"scheme": scheme, "length": length, "values": list(values)})
            if (answer is None) == (scheme in fixtures.FORGEABLE_SCHEMES):
                problems.append(f"the reference's answer for scheme {scheme} disagrees with FORGEABLE_SCHEMES ({label})")
        for target in ("C", "D"):
            for position in range(length):
                path = fixtures.scheme_opening(target, values, position)
                for index in range(length):
                    if index == position or values[index] == values[position]:
                        continue
                    if fixtures.lenient_verify(target, roots[target], index, values[position], path, length):
                        problems.append(f"scheme {target} accepts a relabelled leaf ({label}, {position} as {index})")
    return sorted(set(problems))


def main() -> int:
    fixture_problems = _fixture_checks()
    if fixture_problems:
        print("FAIL the lenient schemes do not behave as documented:")
        for problem in fixture_problems[:20]:
            print(f"  {problem}")
        return 1
    print("PASS the four lenient schemes accept every honest opening, and C and D reject relabelling")

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
