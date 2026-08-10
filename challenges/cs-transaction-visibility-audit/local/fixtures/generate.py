"""Seeded, deterministic evidence and a tiny immutable-revision ledger.

This module models visibility, not a database product.  There are no threads, sleeps,
locks, sockets, or SQL dialect rules.  A read advances a pre-written schedule; a
snapshot keeps reading the revision it captured while that schedule can continue.
That is enough to reproduce the one leap this problem teaches:

    every individual read saw committed data
    does not imply
    all reads in the report describe one committed moment
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Iterable, Mapping


class SeedStream:
    """Small deterministic number stream backed only by SHA-256."""

    def __init__(self, seed: str) -> None:
        self._seed = seed.encode("utf-8")
        self._counter = 0

    def number(self, modulus: int) -> int:
        if modulus <= 0:
            raise ValueError("modulus must be positive")
        block = hashlib.sha256(
            self._seed + b"\0" + self._counter.to_bytes(8, "big")
        ).digest()
        self._counter += 1
        return int.from_bytes(block[:8], "big") % modulus

    def token(self, prefix: str, width: int = 5) -> str:
        value = self.number(16**width)
        return f"{prefix}-{value:0{width}x}"


@dataclass(frozen=True)
class Transfer:
    """One committed movement of points.  It never creates or destroys points."""

    transfer_id: str
    source: str
    destination: str
    amount: int


@dataclass(frozen=True)
class Revision:
    """One immutable committed state of the ledger."""

    number: int
    balances: Mapping[str, int]
    transfer: Transfer | None = None

    @property
    def total(self) -> int:
        return sum(self.balances.values())


@dataclass(frozen=True)
class BalanceRead:
    """The value and committed revision returned by one live read."""

    account_id: str
    balance: int
    revision: int


class Snapshot:
    """A view fixed to one revision while later commits may still progress."""

    def __init__(
        self,
        ledger: "Ledger",
        revision: int,
        balances: Mapping[str, int],
        *,
        exclusive: bool,
    ) -> None:
        self._ledger = ledger
        self.revision = revision
        self._balances = dict(balances)
        self._exclusive = exclusive

    def read(self, account_id: str) -> int:
        """Read one account from the captured revision."""
        if account_id not in self._balances:
            raise KeyError(account_id)
        value = self._balances[account_id]
        self._ledger._record_snapshot_read(  # noqa: SLF001 - paired fixture types
            account_id, self.revision, exclusive=self._exclusive
        )
        return value


class Ledger:
    """A deterministic toy MVCC ledger used by both public and hidden tests.

    ``commit_after_reads=(1,)`` means revision 1 commits immediately after the first
    account read.  The next account read therefore sees it.  A snapshot read still
    notifies the schedule, but returns data from the revision captured by that
    snapshot.  ``exclusive=True`` deliberately suppresses progress and exists only so
    the hidden suite can reject the tempting "freeze every writer" workaround.
    """

    def __init__(
        self,
        revisions: Iterable[Revision],
        *,
        start_index: int = 0,
        commit_after_reads: Iterable[int] = (),
    ) -> None:
        self._revisions = tuple(revisions)
        if not self._revisions:
            raise ValueError("a ledger needs at least one revision")
        if not 0 <= start_index < len(self._revisions):
            raise ValueError("start_index is outside the revision history")
        schedule = tuple(commit_after_reads)
        if any(type(cut) is not int or cut < 1 for cut in schedule):
            raise ValueError("commit cuts must be positive integers")
        if tuple(sorted(schedule)) != schedule or len(set(schedule)) != len(schedule):
            raise ValueError("commit cuts must be strictly increasing")
        if len(schedule) > len(self._revisions) - start_index - 1:
            raise ValueError("the schedule commits more revisions than the history has")
        self._current = start_index
        self._schedule = schedule
        self._reads = 0
        self._commits_completed = 0
        self._events: list[dict[str, object]] = []

    @property
    def current_revision(self) -> int:
        return self._revisions[self._current].number

    @property
    def commits_completed(self) -> int:
        return self._commits_completed

    @property
    def has_pending_commits(self) -> bool:
        return self._commits_completed < len(self._schedule)

    @property
    def events(self) -> tuple[dict[str, object], ...]:
        return tuple(dict(event) for event in self._events)

    def read_committed(self, account_id: str) -> BalanceRead:
        """Read the latest committed value at the instant this call begins."""
        revision = self._revisions[self._current]
        if account_id not in revision.balances:
            raise KeyError(account_id)
        observation = BalanceRead(account_id, revision.balances[account_id], revision.number)
        self._events.append(
            {
                "kind": "read-committed",
                "accountId": account_id,
                "revision": revision.number,
            }
        )
        self._after_read(writer_may_progress=True)
        return observation

    def snapshot(self, *, exclusive: bool = False) -> Snapshot:
        """Capture one immutable revision.

        The normal call is non-exclusive: later commits continue while rows are read.
        Passing ``exclusive=True`` is observable and intentionally not a valid report
        strategy, because a reader-wide writer freeze changes the service contract.
        """
        revision = self._revisions[self._current]
        self._events.append(
            {
                "kind": "snapshot",
                "revision": revision.number,
                "exclusive": exclusive,
            }
        )
        return Snapshot(
            self,
            revision.number,
            revision.balances,
            exclusive=exclusive,
        )

    def _record_snapshot_read(self, account_id: str, revision: int, *, exclusive: bool) -> None:
        self._events.append(
            {
                "kind": "snapshot-read",
                "accountId": account_id,
                "revision": revision,
                "exclusive": exclusive,
            }
        )
        self._after_read(writer_may_progress=not exclusive)

    def _after_read(self, *, writer_may_progress: bool) -> None:
        self._reads += 1
        if not writer_may_progress:
            return
        while (
            self._commits_completed < len(self._schedule)
            and self._schedule[self._commits_completed] <= self._reads
        ):
            self._current += 1
            self._commits_completed += 1
            self._events.append(
                {
                    "kind": "commit",
                    "revision": self._revisions[self._current].number,
                }
            )


@dataclass(frozen=True)
class ReportCase:
    name: str
    revisions: tuple[Revision, ...]
    account_ids: tuple[str, ...]
    start_index: int = 0
    commit_after_reads: tuple[int, ...] = ()

    def ledger(self) -> Ledger:
        return Ledger(
            self.revisions,
            start_index=self.start_index,
            commit_after_reads=self.commit_after_reads,
        )

    @property
    def starting_revision(self) -> Revision:
        return self.revisions[self.start_index]

    @property
    def expected_commits(self) -> int:
        return sum(cut <= len(self.account_ids) for cut in self.commit_after_reads)


def _account_ids(stream: SeedStream, count: int) -> tuple[str, ...]:
    values: list[str] = []
    while len(values) < count:
        candidate = stream.token("acct")
        if candidate not in values:
            values.append(candidate)
    return tuple(values)


def _history(seed: str, count: int = 4) -> tuple[Revision, ...]:
    """Build three immutable revisions whose transfers preserve one total."""
    stream = SeedStream(seed)
    accounts = _account_ids(stream, count)
    balances = {account: 90 + stream.number(111) for account in accounts}
    first_revision = 100 + stream.number(800)
    revisions = [Revision(first_revision, dict(balances))]

    pairs = ((0, 1), (2 % count, 3 % count)) if count >= 4 else ((0, 1), (1, 0))
    for offset, (source_index, destination_index) in enumerate(pairs, start=1):
        source = accounts[source_index]
        destination = accounts[destination_index]
        amount = 7 + stream.number(min(24, max(8, balances[source] // 3)))
        transfer = Transfer(
            stream.token("tx"),
            source,
            destination,
            amount,
        )
        balances = dict(balances)
        balances[source] -= amount
        balances[destination] += amount
        revisions.append(
            Revision(first_revision + offset * (2 + stream.number(6)), balances, transfer)
        )
    # The random-looking gaps above can make the second number no larger than the first
    # gap.  Revision identifiers only need uniqueness, so repair ordering explicitly.
    ordered: list[Revision] = [revisions[0]]
    for revision in revisions[1:]:
        number = max(revision.number, ordered[-1].number + 1)
        ordered.append(Revision(number, revision.balances, revision.transfer))
    return tuple(ordered)


def public_cases(seed: str) -> tuple[ReportCase, ...]:
    """Cases that deliberately contain no commit between report row reads."""
    history = _history(f"{seed}:public")
    accounts = tuple(history[0].balances)
    return (
        ReportCase("no interleaving", history[:1], accounts),
        ReportCase("commit before the report", history, accounts, start_index=2),
        ReportCase("commit after the report", history[:2], accounts, commit_after_reads=(99,)),
        ReportCase("one account", history[:1], accounts[:1]),
    )


def audit_fixture(seed: str) -> dict[str, object]:
    """Committed states and report traces with exactly one impossible report."""
    history = _history(f"{seed}:audit")
    accounts = tuple(history[0].balances)
    first, second, third = history
    stream = SeedStream(f"{seed}:audit:reports")

    def trace(revisions: tuple[Revision, ...]) -> dict[str, object]:
        reads = [
            {
                "accountId": account,
                "balance": revision.balances[account],
                "revision": revision.number,
            }
            for account, revision in zip(accounts, revisions, strict=True)
        ]
        return {
            "reportId": stream.token("report", 7),
            "revision": reads[-1]["revision"],
            "reads": reads,
            "total": sum(int(read["balance"]) for read in reads),
        }

    good_first = trace((first,) * len(accounts))
    good_second = trace((second,) * len(accounts))
    good_third = trace((third,) * len(accounts))
    # Transfer 1 moves points from accounts[0] to accounts[1].  Reading the source
    # before that commit and the destination after it counts the moved points twice.
    mixed = trace((first, second, second, second))
    reports = [good_first, good_second, good_third, mixed]
    shift = stream.number(len(reports))
    reports = reports[shift:] + reports[:shift]
    return {
        "committed": [
            {
                "revision": revision.number,
                "balances": dict(revision.balances),
                "total": revision.total,
            }
            for revision in history
        ],
        "reports": reports,
    }


def counterexample_fixture(seed: str) -> dict[str, object]:
    """A fixed read order and three candidate commits; exactly one crosses the cut."""
    stream = SeedStream(f"{seed}:counterexample")
    accounts = list(_account_ids(stream, 4))
    shift = stream.number(len(accounts))
    order = tuple(accounts[shift:] + accounts[:shift])
    amount = 5 + stream.number(26)

    candidates = [
        Transfer(stream.token("tx", 7), order[0], order[2], amount),
        Transfer(stream.token("tx", 7), order[0], order[1], amount + 1),
        Transfer(stream.token("tx", 7), order[2], order[3], amount + 2),
    ]
    candidate_shift = stream.number(len(candidates))
    candidates = candidates[candidate_shift:] + candidates[:candidate_shift]
    return {
        "readOrder": list(order),
        "commitAfterRead": 2,
        "candidates": [
            {
                "transferId": transfer.transfer_id,
                "source": transfer.source,
                "destination": transfer.destination,
                "amount": transfer.amount,
            }
            for transfer in candidates
        ],
    }
