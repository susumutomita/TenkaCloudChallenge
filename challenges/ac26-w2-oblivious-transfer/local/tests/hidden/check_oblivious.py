"""Hidden tests. Run by /verify against a copy of the learner's oblivious.py.

Two of these checks are not about getting an answer out, and they are the ones worth
reading before changing anything.

`check_receiver_privacy` does not run the protocol. It enumerates every blind in the
declared range under both choices and compares the two *sets* of requests. Perfect
receiver privacy is exactly the statement that those sets coincide; an implementation
that excludes 0 from the range produces sets differing in one element each, and those
two elements name the choice bit. Nothing about a single successful transfer would
notice.

`check_gate_privacy` is the same shape one level up. Mask reuse across the two
transfers of an AND gate is *correct* -- the masks still cancel, and every
reconstruction test passes -- while making each party's output share a deterministic
function of the other party's secret bits. So correctness is checked separately from
the property, and the property is checked by varying the other party's inputs and
watching whether this party's view moves with them.
"""

from __future__ import annotations

import sys
from itertools import product
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fixtures.generate import (  # noqa: E402
    GATES,
    derive_key,
    group,
    keypair,
    session,
    wires,
)

LABELS = ("h0", "h1", "h2", "h3")


def _int(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _bit(value: object) -> bool:
    return _int(value) and value in (0, 1)


def check_request(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        grp = group(seed, label)
        key = keypair(seed, label)
        ses = session(seed, label)
        try:
            req = module.request(grp, key["public"], ses["choice"], ses["blind"])
        except Exception as error:  # noqa: BLE001
            return [f"request raised {type(error).__name__}"]
        if not _int(req) or not 0 <= req < grp["p"]:
            failures.append("request did not return an element of the group's field")
            continue
        if pow(req, grp["q"], grp["p"]) != 1:
            failures.append("request produced an element outside the order-q subgroup")
            continue
        expected_zero = pow(grp["g"], ses["blind"], grp["p"])
        expected_one = (key["public"] * expected_zero) % grp["p"]
        if req != (expected_one if ses["choice"] else expected_zero):
            failures.append("request does not encode the choice as a shift by the public key")
    return failures


def check_receiver_privacy(module, seed: str) -> list[str]:
    """The sender must not be able to tell the choices apart. A set comparison."""
    failures: list[str] = []
    for label in LABELS:
        grp = group(seed, label)
        key = keypair(seed, label)
        try:
            bounds = module.blind_range(grp)
        except Exception as error:  # noqa: BLE001
            return [f"blind_range raised {type(error).__name__}"]
        if (
            not isinstance(bounds, (tuple, list))
            or len(bounds) != 2
            or not all(_int(v) for v in bounds)
        ):
            failures.append("blind_range did not return two integer bounds")
            continue
        low, high = bounds
        if high - low + 1 != grp["q"]:
            failures.append(
                "the blind's range does not cover the whole subgroup, so the two "
                "choices do not produce the same distribution of requests"
            )
            continue
        try:
            reachable = [
                {module.request(grp, key["public"], choice, t) % grp["p"] for t in range(low, high + 1)}
                for choice in (0, 1)
            ]
        except Exception as error:  # noqa: BLE001
            return [f"request raised {type(error).__name__} while sweeping the blind"]
        # Stated positively, and not only as "the two sets agree". A `request` that
        # ignores its arguments makes both sets `{1}`, which agrees perfectly and hides
        # nothing because it transfers nothing. The property is that the request ranges
        # over the whole subgroup under each choice, which a constant cannot fake.
        if any(len(side) != grp["q"] for side in reachable):
            failures.append(
                "the request does not range over the whole subgroup, so it is not "
                "uniform under either choice"
            )
            continue
        if reachable[0] != reachable[1]:
            only_one = sorted(reachable[1] - reachable[0])[:2]
            only_zero = sorted(reachable[0] - reachable[1])[:2]
            failures.append(
                "the choice is readable from the request: "
                f"{only_zero} can only mean choice 0 and {only_one} only choice 1"
            )
    return failures


def check_transfer(module, seed: str) -> list[str]:
    """End to end: the chosen message arrives, and the other one stays unreadable."""
    failures: list[str] = []
    for label in LABELS:
        grp = group(seed, label)
        key = keypair(seed, label)
        ses = session(seed, label)
        for choice in (0, 1):
            try:
                req = module.request(grp, key["public"], choice, ses["blind"])
                cts = module.encrypt(
                    grp,
                    key["secret"],
                    key["public"],
                    req,
                    ses["message_0"],
                    ses["message_1"],
                )
            except Exception as error:  # noqa: BLE001
                return [f"the transfer raised {type(error).__name__}"]
            if (
                not isinstance(cts, (tuple, list))
                or len(cts) != 2
                or not all(_int(v) for v in cts)
            ):
                failures.append("encrypt did not return two integer ciphertexts")
                continue
            # Sender privacy is not proved by checking only that one key fails to
            # XOR-open the other branch. A reversible encoding can keep the plaintext
            # in high bits and make that one attempted XOR look harmless. Require the
            # declared two-key construction itself before crediting the transfer.
            p = grp["p"]
            key_0 = derive_key(grp, pow(req, key["secret"], p))
            unshifted = (req * pow(key["public"], p - 2, p)) % p
            key_1 = derive_key(grp, pow(unshifted, key["secret"], p))
            expected = (
                ses["message_0"] ^ key_0,
                ses["message_1"] ^ key_1,
            )
            if tuple(cts) != expected:
                failures.append(
                    "the ciphertexts do not use the declared independent sender keys"
                )
                continue
            try:
                got = module.unwrap(grp, key["public"], choice, ses["blind"], tuple(cts))
            except Exception as error:  # noqa: BLE001
                return [f"unwrap raised {type(error).__name__}"]
            wanted = ses["message_0"] if choice == 0 else ses["message_1"]
            if got != wanted:
                failures.append(f"the receiver did not recover message {choice}")
                continue
            # The other branch must not fall out of the same key. A ciphertext pair
            # that decrypts both ways is a transfer that transferred everything.
            other = 1 - choice
            other_wanted = ses["message_0"] if other == 0 else ses["message_1"]
            same_key = derive_key(grp, pow(key["public"], ses["blind"], grp["p"]))
            if cts[other] ^ same_key == other_wanted and ses["message_0"] != ses["message_1"]:
                failures.append(
                    "both messages open under the receiver's key, so the sender kept nothing"
                )
    return failures


def _gate(module, x0: int, x1: int, y0: int, y1: int, randomness: tuple[int, int]):
    """One AND gate, run the way the two parties run it. Returns both views."""
    mask_0, mask_1 = module.gate_masks(randomness)
    received_1 = module.offer(x0, mask_0)[y1]
    received_0 = module.offer(x1, mask_1)[y0]
    z0 = module.output_share(x0, y0, mask_0, received_0)
    z1 = module.output_share(x1, y1, mask_1, received_1)
    return (received_0, z0), (received_1, z1)


def check_and_gate(module, seed: str) -> list[str]:
    """Correctness of the gate, over every share layout rather than the seeded one."""
    failures: list[str] = []
    for x0, x1, y0, y1, r0, r1 in product((0, 1), repeat=6):
        try:
            masks = module.gate_masks((r0, r1))
        except Exception as error:  # noqa: BLE001
            return [f"gate_masks raised {type(error).__name__}"]
        if (
            not isinstance(masks, (tuple, list))
            or len(masks) != 2
            or not all(_bit(v) for v in masks)
        ):
            return ["gate_masks did not return one bit per transfer"]
        try:
            (_r0, z0), (_r1, z1) = _gate(module, x0, x1, y0, y1, (r0, r1))
        except Exception as error:  # noqa: BLE001
            return [f"the AND gate raised {type(error).__name__}"]
        if not _bit(z0) or not _bit(z1):
            return ["the gate did not produce one bit per party"]
        if (z0 ^ z1) != ((x0 ^ x1) & (y0 ^ y1)):
            failures.append("the output shares do not reconstruct to x AND y")
            break
    return failures


def check_gate_privacy(module, seed: str) -> list[str]:
    """Each party's view must not move when only the other party's secrets move.

    Correct-but-leaky is the failure being separated here, so this cannot be folded
    into the correctness check: a `gate_masks` that returns one mask twice passes
    every reconstruction above and fails here. Party 0's whole view is the message it
    received plus its own output share; sweeping the gate's randomness must leave that
    view's distribution unchanged as the other party's secrets vary. The sweep is
    symmetric: checking only party 0 leaves implementations that leak exclusively to
    party 1 undetected.
    """
    failures: list[str] = []
    for party in (0, 1):
        for own_x, own_y in product((0, 1), repeat=2):
            views: dict[tuple[int, int], frozenset[tuple[int, int]]] = {}
            for other_x, other_y in product((0, 1), repeat=2):
                seen: set[tuple[int, int]] = set()
                for randomness in product((0, 1), repeat=2):
                    if party == 0:
                        gate_inputs = (own_x, other_x, own_y, other_y)
                    else:
                        gate_inputs = (other_x, own_x, other_y, own_y)
                    try:
                        party_views = _gate(module, *gate_inputs, randomness)
                    except Exception as error:  # noqa: BLE001
                        return [f"the AND gate raised {type(error).__name__}"]
                    seen.add(party_views[party])
                views[(other_x, other_y)] = frozenset(seen)
            if len({*views.values()}) > 1:
                failures.append(
                    f"party {party}'s view of the gate changes with party {1 - party}'s "
                    "secret bits, so the two transfers are not independently masked"
                )
                break
        if failures:
            break
    return failures


def check_gates(module, _seed: str) -> list[str]:
    failures: list[str] = []
    for gate in GATES:
        try:
            answer = module.needs_transfer(gate)
        except Exception as error:  # noqa: BLE001
            return [f"needs_transfer raised {type(error).__name__}"]
        if not isinstance(answer, bool):
            failures.append("needs_transfer did not return a boolean")
            break
        if answer != (gate == "and"):
            failures.append(
                f"{gate} is classified wrongly: XOR is local on XOR-shares, AND is not"
            )
    return failures


def run(module, seed: str) -> list[str]:
    return [
        *check_request(module, seed),
        *check_receiver_privacy(module, seed),
        *check_transfer(module, seed),
        *check_and_gate(module, seed),
        *check_gate_privacy(module, seed),
        *check_gates(module, seed),
    ]
