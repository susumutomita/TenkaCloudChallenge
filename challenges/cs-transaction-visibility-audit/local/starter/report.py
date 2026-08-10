"""The only file you edit.

Build one report for ``account_ids``.  The return value must have exactly this shape:

    {
        "revision": 123,
        "balances": {"acct-a": 80, "acct-b": 120},
        "total": 200,
    }

``ledger.read_committed(account_id)`` returns a ``BalanceRead`` containing ``balance``
and ``revision``.  Every call returns committed data, but two calls may observe
different committed revisions.

``ledger.snapshot()`` captures one immutable committed revision.  Its ``revision`` is
the report revision and ``snapshot.read(account_id)`` reads an integer balance from
that same revision.  The ordinary snapshot does not stop later commits.

The starter below passes every public test.  Audit whether that proves that all rows in
one report describe the same moment.
"""

from __future__ import annotations

from typing import Iterable


def build_report(ledger: object, account_ids: Iterable[str]) -> dict[str, object]:
    """Return balances, their displayed revision, and their total."""
    ids = tuple(account_ids)
    reads = [ledger.read_committed(account_id) for account_id in ids]
    balances = {read.account_id: read.balance for read in reads}
    revision = reads[-1].revision if reads else ledger.current_revision
    return {
        "revision": revision,
        "balances": balances,
        "total": sum(balances.values()),
    }
