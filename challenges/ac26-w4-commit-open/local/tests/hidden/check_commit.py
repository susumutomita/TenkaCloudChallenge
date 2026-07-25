"""Hidden tests. Run by /verify against a copy of the learner's commit.py.

Every checkpoint that matters here attacks something an honest run never exercises: a
leaf presented from the wrong index, a path with a flipped sibling, a path one step too
short, a challenge that does not depend on the commitment. All of those verify fine
until somebody is trying.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fixtures.generate import (  # noqa: E402
    DOMAIN,
    root_of,
    setting,
    weak_leaf,
)

LABELS = ("h0", "h1", "h2")


def check_encoding(module, seed: str) -> list[str]:
    """The two properties a leaf encoding needs, checked directly."""
    failures: list[str] = []
    for label in LABELS:
        cfg = setting(seed, label)
        try:
            encoded = module.encode_leaf(0, cfg["values"][0])
        except Exception as error:  # noqa: BLE001
            return [f"encoding a leaf raised {type(error).__name__}"]
        if not isinstance(encoded, bytes) or not encoded:
            failures.append("a leaf does not encode to bytes")
            continue
        # The index has to be in there: same value, different position, different bytes.
        if module.encode_leaf(0, 7) == module.encode_leaf(1, 7):
            failures.append("the encoding does not bind the leaf's index")
            continue
        if module.encode_leaf(0, 7) == module.encode_leaf(0, 8):
            failures.append("the encoding does not bind the leaf's value")
            continue
        # And the fields must not run together. These two pairs are the classic case.
        if module.encode_leaf(1, 23) == module.encode_leaf(12, 3):
            failures.append("two different index/value pairs encode to the same bytes")
            continue
        if module.node_hash(b"a" * 32, b"b" * 32) == module.node_hash(b"b" * 32, b"a" * 32):
            failures.append("combining two children does not depend on their order")
    return failures


def check_root(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        cfg = setting(seed, label)
        try:
            root = module.merkle_root(list(cfg["values"]))
        except Exception as error:  # noqa: BLE001
            return [f"building the root raised {type(error).__name__}"]
        if not isinstance(root, bytes) or len(root) != 32:
            failures.append("the root is not a 32-byte hash")
            continue
        if root != root_of(cfg["values"]):
            failures.append("the root does not match the committed vector")
            continue
        moved = list(cfg["values"])
        moved[0], moved[1] = moved[1], moved[0]
        if moved != cfg["values"] and module.merkle_root(moved) == root:
            failures.append("swapping two entries did not change the root")
    return failures


def check_opening(module, seed: str) -> list[str]:
    """The honest opening, and the four ways a dishonest one differs."""
    failures: list[str] = []
    for label in LABELS:
        cfg = setting(seed, label)
        values, length, index = list(cfg["values"]), cfg["length"], cfg["query"]
        root = module.merkle_root(values)
        try:
            path = module.open_at(values, index)
        except Exception as error:  # noqa: BLE001
            return [f"producing an opening raised {type(error).__name__}"]
        if not isinstance(path, list) or len(path) != max(length - 1, 1).bit_length():
            failures.append("the authentication path is not one step per tree level")
            continue
        if not module.verify_opening(root, index, values[index], path, length):
            failures.append("an honest opening was rejected")
            continue
        other = (index + 1) % length
        flipped = [
            {"hash": step["hash"], "sibling_is_left": not step["sibling_is_left"]}
            for step in path
        ]
        accepted = {
            "a changed value": module.verify_opening(
                root, index, values[index] + 1, path, length
            ),
            "a changed index": module.verify_opening(root, other, values[index], path, length),
            "a flipped sibling direction": module.verify_opening(
                root, index, values[index], flipped, length
            ),
            "a truncated path": module.verify_opening(
                root, index, values[index], path[:-1], length
            ),
            "an out-of-range index": module.verify_opening(
                root, length, values[index], path, length
            ),
        }
        for name, was_accepted in accepted.items():
            if was_accepted:
                failures.append(f"an opening with {name} was accepted")
                break
    return failures


def check_order(module, seed: str) -> list[str]:
    """The state machine. Out of order has to raise, not quietly work."""
    failures: list[str] = []
    for label in LABELS:
        cfg = setting(seed, label)
        session = module.Session(list(cfg["values"]))
        try:
            session.receive_challenge(cfg["query"])
            failures.append("a challenge was accepted before anything was committed")
        except module.ProtocolError:
            pass
        except Exception as error:  # noqa: BLE001
            failures.append(f"an early challenge raised {type(error).__name__}")

        session = module.Session(list(cfg["values"]))
        try:
            session.open()
            failures.append("an opening was produced before anything was asked")
        except module.ProtocolError:
            pass
        except Exception as error:  # noqa: BLE001
            failures.append(f"an early opening raised {type(error).__name__}")

        # A negative index would silently wrap to a different row, so the range check
        # here is the one that actually matters -- in `verify_opening` the domain tags
        # already make an out-of-tree leaf unmatchable.
        session = module.Session(list(cfg["values"]))
        session.commit()
        for bad in (-1, cfg["length"]):
            try:
                session.receive_challenge(bad)
                failures.append("a query index outside the vector was accepted")
                break
            except module.ProtocolError:
                pass
            except Exception as error:  # noqa: BLE001
                failures.append(f"an out-of-range query raised {type(error).__name__}")
                break

        session = module.Session(list(cfg["values"]))
        root = session.commit()
        if root != root_of(cfg["values"]):
            failures.append("the session committed to something other than its vector")
            continue
        try:
            session.open()
            failures.append("an opening was produced before a challenge arrived")
        except module.ProtocolError:
            pass
        except Exception as error:  # noqa: BLE001
            failures.append(f"an unasked opening raised {type(error).__name__}")
        session.receive_challenge(cfg["query"])
        opened = session.open()
        if not isinstance(opened, dict) or opened.get("index") != cfg["query"]:
            failures.append("the opening is not for the index that was asked about")
            continue
        if not module.verify_opening(
            root, opened["index"], opened["value"], opened["path"], cfg["length"]
        ):
            failures.append("the session's own opening does not verify against its root")
    return failures


def check_adaptive(module, seed: str) -> list[str]:
    """The counterexample: knowing the query first makes the commitment meaningless."""
    failures: list[str] = []
    for label in LABELS:
        cfg = setting(seed, label)
        try:
            witness = module.adaptive_witness(dict(cfg))
        except Exception as error:  # noqa: BLE001
            return [f"building the witness raised {type(error).__name__}"]
        if not isinstance(witness, dict) or "values" not in witness or "query" not in witness:
            failures.append("no witness was produced")
            continue
        forged, query = list(witness["values"]), witness["query"]
        if query != cfg["query"]:
            failures.append("the witness does not use the query it was told in advance")
            continue
        if len(forged) != cfg["length"]:
            failures.append("the witness vector is the wrong length")
            continue
        differing = sum(1 for a, b in zip(forged, cfg["values"]) if a != b)
        if differing < cfg["length"] - 1:
            failures.append("the witness barely differs from the honest vector")
            continue
        if forged[query] != cfg["values"][query]:
            failures.append("the witness does not agree with the honest vector where it is asked")
            continue
        root = module.merkle_root(forged)
        if not module.verify_opening(
            root, query, forged[query], module.open_at(forged, query), cfg["length"]
        ):
            failures.append("the witness opening does not verify, so it demonstrates nothing")
    return failures


def check_ambiguity(module, _seed: str) -> list[str]:
    """The encoding counterexample, against a weakness fixed in the fixtures."""
    failures: list[str] = []
    try:
        witness = module.ambiguity_witness()
    except Exception as error:  # noqa: BLE001
        return [f"building the witness raised {type(error).__name__}"]
    if not isinstance(witness, dict) or "first" not in witness or "second" not in witness:
        return ["no witness was produced"]
    first, second = tuple(witness["first"]), tuple(witness["second"])
    if first == second:
        return ["the two pairs in the witness are the same pair"]
    if weak_leaf(*first) != weak_leaf(*second):
        failures.append("the two pairs do not collide under the separator-free encoding")
    if module.encode_leaf(*first) == module.encode_leaf(*second):
        failures.append("the two pairs also collide under the submission's own encoding")
    return failures


def check_transcript(module, seed: str) -> list[str]:
    """Fiat-Shamir here means the challenge depends on the commitment. That is the point."""
    failures: list[str] = []
    for label in LABELS:
        cfg = setting(seed, label)
        root = module.merkle_root(list(cfg["values"]))
        statement = b"trace-commitment"
        base = module.challenge(DOMAIN, root, statement, cfg["length"])
        if not isinstance(base, int) or not 0 <= base < cfg["length"]:
            failures.append("the challenge is not an index into the vector")
            continue
        if module.challenge(DOMAIN, root, statement, cfg["length"]) != base:
            failures.append("the challenge is not deterministic")
            continue
        # Asserted on the transcript rather than the derived index: the index is one of
        # at most sixteen values, so two different transcripts collide often by chance.
        base_bytes = module.transcript(DOMAIN, root, statement)
        variants = {
            "the commitment": module.transcript(DOMAIN, bytes(32), statement),
            "the domain": module.transcript(DOMAIN + "-other", root, statement),
            "the statement": module.transcript(DOMAIN, root, statement + b"!"),
        }
        for name, value in variants.items():
            if value == base_bytes:
                failures.append(f"the transcript does not depend on {name}")
                break
        else:
            if module.transcript(DOMAIN, root, b"ab") == module.transcript(
                DOMAIN + "a", root, b"b"
            ):
                failures.append("two different transcripts produce the same bytes")
    return failures


def run(module, seed: str) -> list[str]:
    return [
        *check_encoding(module, seed),
        *check_root(module, seed),
        *check_opening(module, seed),
        *check_order(module, seed),
        *check_adaptive(module, seed),
        *check_ambiguity(module, seed),
        *check_transcript(module, seed),
    ]
