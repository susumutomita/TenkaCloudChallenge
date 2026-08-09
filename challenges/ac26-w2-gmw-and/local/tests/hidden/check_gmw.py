"""Hidden checks for the Boolean gate's construction and privacy transcript."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fixtures.generate import (  # noqa: E402
    GateCase,
    IdealOt,
    PrivateBit,
    audit_inputs,
    gate_cases,
    output_values,
)


def check_delivery(module, seed: str) -> list[str]:
    """Full truth table under several seed-derived sharings."""
    failures: list[str] = []
    for label in ("delivery-a", "delivery-b", "delivery-c"):
        for item in gate_cases(seed, label):
            try:
                output = output_values(
                    module.and_shared_bits(
                        item.x_shares, item.y_shares, item.masks, IdealOt()
                    )
                )
            except Exception as error:  # noqa: BLE001
                return [f"the gate raised {type(error).__name__}"]
            if output is None:
                failures.append("the gate did not return two canonical bit shares")
            elif output[0] ^ output[1] != (item.x & item.y):
                failures.append("the output shares reconstruct to the wrong AND bit")
    return failures


def _audit_run(module, item):
    x_shares, y_shares, masks, runtime, ledger = audit_inputs(item)
    output = module.and_shared_bits(x_shares, y_shares, masks, runtime)
    return output, runtime, ledger


def check_cross_terms(module, seed: str) -> list[str]:
    failures: list[str] = []
    for item in gate_cases(seed, "cross"):
        try:
            _output, runtime, _ledger = _audit_run(module, item)
        except Exception as error:  # noqa: BLE001
            return [f"cross-term construction raised {type(error).__name__}"]
        if len(runtime.transfers) != 2:
            failures.append("the gate did not use exactly two OT transfers")
            continue
        first, second = runtime.transfers
        if (
            first["session"],
            first["sender"],
            first["receiver"],
        ) != (0, 0, 1):
            failures.append("the first cross term is not an OT from party 0 to party 1")
        if (
            second["session"],
            second["sender"],
            second["receiver"],
        ) != (1, 1, 0):
            failures.append("the second cross term is not an OT from party 1 to party 0")
        r01, r10 = item.masks
        if first["messages"] != (r01, r01 ^ item.x_shares[0]):
            failures.append("the first OT messages do not split x0 AND y1")
        if second["messages"] != (r10, r10 ^ item.x_shares[1]):
            failures.append("the second OT messages do not split x1 AND y0")
    return failures


def check_output_sharing(module, seed: str) -> list[str]:
    """Fresh masks must rerandomize the shares without changing their XOR."""
    failures: list[str] = []
    for item in gate_cases(seed, "sharing"):
        seen: set[tuple[int, int]] = set()
        for masks in ((0, 0), (0, 1), (1, 0), (1, 1)):
            variant = GateCase(
                item.x, item.y, item.x_shares, item.y_shares, masks
            )
            try:
                output = output_values(
                    module.and_shared_bits(
                        variant.x_shares,
                        variant.y_shares,
                        variant.masks,
                        IdealOt(),
                    )
                )
            except Exception as error:  # noqa: BLE001
                return [f"output-sharing check raised {type(error).__name__}"]
            if output is None or output[0] ^ output[1] != (item.x & item.y):
                failures.append("changing masks changed the reconstructed result")
            else:
                seen.add(output)
        if len(seen) < 2:
            failures.append("fresh masks do not rerandomize the output sharing")
    return failures


def check_transcript(module, seed: str) -> list[str]:
    failures: list[str] = []
    for item in gate_cases(seed, "transcript"):
        try:
            output, runtime, ledger = _audit_run(module, item)
        except Exception as error:  # noqa: BLE001
            return [f"transcript audit raised {type(error).__name__}"]
        values = output_values(output)
        if values is None or any(
            not isinstance(value, PrivateBit) for value in output
        ):
            failures.append("the audited run did not return one local share per party")
        elif tuple(value.owner for value in output) != (0, 1):
            failures.append("an output share crossed to the wrong party")
        if runtime.opens:
            failures.append("the gate reconstructed a secret during the protocol")
        if ledger.direct_reads:
            failures.append("the gate read the share container outside a party-local view")
        if ledger.boundary_violations:
            failures.append("the gate combined values owned by different parties")
        expected_reads = {
            ("x", 0), ("x", 1), ("y", 0), ("y", 1), ("mask", 0), ("mask", 1)
        }
        if set(ledger.local_reads) != expected_reads:
            failures.append("the gate did not read exactly the two parties' local inputs")
    return failures


def check_privacy(module, seed: str) -> list[str]:
    """One checkpoint owns the actual privacy boundary, not the final bit."""
    return [
        *check_cross_terms(module, f"{seed}:privacy"),
        *check_transcript(module, f"{seed}:privacy"),
        *check_output_sharing(module, f"{seed}:privacy"),
    ]


def run(module, seed: str) -> list[str]:
    return [
        *check_delivery(module, seed),
        *check_cross_terms(module, seed),
        *check_output_sharing(module, seed),
        *check_transcript(module, seed),
        *check_privacy(module, seed),
    ]
