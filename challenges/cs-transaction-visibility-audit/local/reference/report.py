"""Reference solution.  The participant image never copies this directory."""

from __future__ import annotations

from typing import Iterable


def build_report(ledger: object, account_ids: Iterable[str]) -> dict[str, object]:
    """Read every requested balance from one non-exclusive snapshot."""
    ids = tuple(account_ids)
    snapshot = ledger.snapshot()
    balances = {account_id: snapshot.read(account_id) for account_id in ids}
    return {
        "revision": snapshot.revision,
        "balances": balances,
        "total": sum(balances.values()),
    }
