"""XOR-sharing cases and a supplied ideal OT fixture for the GMW gate."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field


def _stream(seed: str, label: str) -> bytes:
    return hashlib.sha256(f"{seed}:{label}".encode()).digest()


@dataclass(frozen=True)
class GateCase:
    x: int
    y: int
    x_shares: tuple[int, int]
    y_shares: tuple[int, int]
    masks: tuple[int, int]

    def as_public(self) -> dict[str, object]:
        return {
            "xShares": self.x_shares,
            "yShares": self.y_shares,
            "masks": self.masks,
        }


def gate_case(seed: str, label: str, x: int, y: int) -> GateCase:
    data = _stream(seed, f"{label}:{x}:{y}")
    x0 = data[0] & 1
    y0 = data[1] & 1
    r01 = data[2] & 1
    r10 = (data[3] & 1) ^ r01
    return GateCase(
        x=x,
        y=y,
        x_shares=(x0, x0 ^ x),
        y_shares=(y0, y0 ^ y),
        masks=(r01, r10),
    )


def gate_cases(seed: str, label: str) -> list[GateCase]:
    return [
        gate_case(seed, f"{label}:{index}", x, y)
        for index, (x, y) in enumerate(((0, 0), (0, 1), (1, 0), (1, 1)))
    ]


@dataclass
class IdealOt:
    """The OT building block supplied to this problem.

    It intentionally exposes no OT algebra. The preceding companion owns that
    mechanism; this fixture only records how the GMW composition used two sessions.
    """

    transfers: list[dict[str, object]] = field(default_factory=list)
    opens: list[str] = field(default_factory=list)

    def local(self, shares, party: int):
        if hasattr(shares, "read"):
            return shares.read(party)
        return shares[party]

    def transfer(
        self,
        session: int,
        sender_party: int,
        receiver_party: int,
        messages,
        choice,
    ):
        if not isinstance(messages, (tuple, list)) or len(messages) != 2:
            raise ValueError("OT needs two messages")
        choice_value = _value(choice)
        result = messages[choice_value]
        self.transfers.append(
            {
                "session": session,
                "sender": sender_party,
                "receiver": receiver_party,
                "messages": tuple(_value(value) for value in messages),
                "choice": choice_value,
                "result": _value(result),
            }
        )
        if isinstance(choice, PrivateBit):
            for value in messages:
                if not isinstance(value, PrivateBit) or value.owner != sender_party:
                    choice.ledger.boundary_violations.append("OT sender used another party's value")
            if choice.owner != receiver_party:
                choice.ledger.boundary_violations.append("OT choice came from the wrong party")
            return PrivateBit(_value(result), receiver_party, choice.ledger)
        return result

    def open(self, shares) -> int:
        self.opens.append("opened a secret inside the gate")
        if isinstance(shares, PrivateVector):
            return shares.values[0] ^ shares.values[1]
        return shares[0] ^ shares[1]


@dataclass
class AuditLedger:
    direct_reads: list[str] = field(default_factory=list)
    local_reads: list[tuple[str, int]] = field(default_factory=list)
    boundary_violations: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class PrivateBit:
    value: int
    owner: int
    ledger: AuditLedger

    def _other(self, other):
        if not isinstance(other, PrivateBit):
            self.ledger.boundary_violations.append("combined a private share with a public value")
            return int(other), self.owner
        if self.owner != other.owner:
            self.ledger.boundary_violations.append("combined shares owned by different parties")
        return other.value, other.owner

    def __xor__(self, other):
        value, _owner = self._other(other)
        return PrivateBit(self.value ^ value, self.owner, self.ledger)

    def __rxor__(self, other):
        return self.__xor__(other)

    def __and__(self, other):
        value, _owner = self._other(other)
        return PrivateBit(self.value & value, self.owner, self.ledger)

    def __rand__(self, other):
        return self.__and__(other)


@dataclass
class PrivateVector:
    name: str
    values: tuple[int, int]
    ledger: AuditLedger

    def __len__(self) -> int:
        return 2

    def read(self, party: int) -> PrivateBit:
        self.ledger.local_reads.append((self.name, party))
        return PrivateBit(self.values[party], party, self.ledger)

    def __getitem__(self, party: int) -> PrivateBit:
        self.ledger.direct_reads.append(f"{self.name}[{party}]")
        return PrivateBit(self.values[party], party, self.ledger)


def _value(value) -> int:
    return value.value if isinstance(value, PrivateBit) else value


def audit_inputs(item: GateCase):
    ledger = AuditLedger()
    runtime = IdealOt()
    return (
        PrivateVector("x", item.x_shares, ledger),
        PrivateVector("y", item.y_shares, ledger),
        PrivateVector("mask", item.masks, ledger),
        runtime,
        ledger,
    )


def output_values(output) -> tuple[int, int] | None:
    if not isinstance(output, (tuple, list)) or len(output) != 2:
        return None
    values = tuple(_value(value) for value in output)
    if any(type(value) is not int or value not in (0, 1) for value in values):
        return None
    return values


def health_token(seed: str) -> str:
    item = gate_case(seed, "public", 1, 1)
    return hashlib.sha256(
        f"health:{seed}:{item.x_shares}:{item.y_shares}".encode()
    ).hexdigest()[:16]
