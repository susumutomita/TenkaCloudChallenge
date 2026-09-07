"""Trusted finite checks for the declared OT arithmetic and selected gate observations.

Receiver privacy assumes a uniform draw over the inclusive q-integer interval and
checks every request value and count. Gate privacy compares occurrence counts of
(received, output) under four equally likely random pairs, with each party's input
fixed. This is not a proof of arbitrary Python behavior, all protocol transcripts,
or security of the tiny group against discrete-log enumeration.
"""

from __future__ import annotations

import sys
from collections import Counter
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
    """Compare uniform full-cycle request probabilities, not just possible values."""
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
            reachable = []
            for choice in (0, 1):
                counts = Counter()
                for t in range(low, high + 1):
                    req = module.request(grp, key['public'], choice, t)
                    if not _int(req) or not 0 <= req < grp['p'] or pow(req,grp['q'],grp['p']) != 1:
                        raise ValueError('request must be a canonical subgroup element')
                    counts[req] += 1
                reachable.append(counts)
        except Exception as error:
            return [f'request raised {type(error).__name__} while sweeping the blind']
        if any(len(side) != grp['q'] or set(side.values()) != {1} for side in reachable):
            failures.append('the request does not visit every subgroup value once over the uniform blind range')
            continue
        if reachable[0] != reachable[1]:
            failures.append('the two choices do not have the same request distribution')
    return failures


def check_transfer(module, seed: str) -> list[str]:
    """Verify the declared keys and selected-message recovery, not sender security."""
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
                    "the ciphertexts do not use the declared sender keys"
                )
                continue
            try:
                got = module.unwrap(grp, key["public"], choice, ses["blind"], tuple(cts))
            except Exception as error:  # noqa: BLE001
                return [f"unwrap raised {type(error).__name__}"]
            wanted = ses["message_0"] if choice == 0 else ses["message_1"]
            if not _int(got) or got != wanted:
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
    masks = module.gate_masks(randomness)
    if not isinstance(masks,(tuple,list)) or len(masks)!=2 or not all(_bit(v) for v in masks):
        raise ValueError('gate_masks must return two bits')
    mask_0,mask_1=masks
    offers=(module.offer(x0,mask_0),module.offer(x1,mask_1))
    if any(not isinstance(pair,(tuple,list)) or len(pair)!=2 or not all(_bit(v) for v in pair) for pair in offers):
        raise ValueError('offer must return two bits')
    received_1=offers[0][y1]
    received_0=offers[1][y0]
    z0 = module.output_share(x0, y0, mask_0, received_0)
    z1 = module.output_share(x1, y1, mask_1, received_1)
    if not _bit(z0) or not _bit(z1):
        raise ValueError("output_share must return a bit")
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
    """Count each selected (received, output) observation with uniform random bits.

    The correctness phase remains a separate prerequisite in the checkpoint.
    Neither this projection nor its finite enumeration attests a full semi-honest
    or malicious-security protocol implementation.
    """
    failures: list[str] = []
    for party in (0, 1):
        for own_x, own_y in product((0, 1), repeat=2):
            views: list[Counter] = []
            for other_x, other_y in product((0, 1), repeat=2):
                seen = Counter()
                for randomness in product((0, 1), repeat=2):
                    if party == 0:
                        gate_inputs = (own_x, other_x, own_y, other_y)
                    else:
                        gate_inputs = (other_x, own_x, other_y, own_y)
                    try:
                        party_views = _gate(module, *gate_inputs, randomness)
                    except Exception as error:  # noqa: BLE001
                        return [f"the AND gate raised {type(error).__name__}"]
                    seen[party_views[party]] += 1
                views.append(seen)
            if any(view != views[0] for view in views[1:]):
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
