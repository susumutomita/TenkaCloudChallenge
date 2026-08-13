"""The only file you edit.

Two parties who share nothing want one thing from each other, and neither will say
which thing. That is oblivious transfer, and once you have it you can compute any
Boolean circuit between two mutually suspicious parties.

## Part 1 -- the transfer itself

The sender publishes A = g^a in a subgroup of order q. You are the receiver, holding
a choice bit and a blind t.

    B = g^t          if you want message 0
    B = A * g^t      if you want message 1

The sender, who cannot tell those apart, replies with two ciphertexts:

    message 0 under the key for  B^a
    message 1 under the key for  (B/A)^a

Exactly one of those two keys is A^t, which you can compute and the other you cannot.
Use `derive_key` from `fixtures.generate` for both sides so you are never debugging
two hash conventions at once.

## Part 2 -- an AND gate on top of it

x and y are split as x = x0 ^ x1 and y = y0 ^ y1; party 0 holds (x0, y0) and party 1
holds (x1, y1). XOR is free -- each party XORs its own row. AND is not:

    (x0 ^ x1) & (y0 ^ y1)  =  x0y0 ^ x1y1 ^ x0y1 ^ x1y0

The first two terms are local. The last two are the cross terms, and each is bought
with one transfer: a party offers two messages built from its own bit and a mask, and
the other party picks with its own bit.

`blind_range` is not decoration. One of these functions is correct on every input and
still hands the other party a secret; the public tests will not tell you which.
"""

from __future__ import annotations

from fixtures.generate import derive_key


def request(grp: dict[str, int], public: int, choice: int, blind: int) -> int:
    """The element you send to the sender. It must not reveal `choice`."""
    return 1


def blind_range(grp: dict[str, int]) -> tuple[int, int]:
    """Inclusive low and high bounds that `blind` must be drawn from.

    Think about which elements `request` can and cannot produce under each choice.
    """
    return (1, grp["q"] - 1)


def encrypt(
    grp: dict[str, int], secret: int, public: int, req: int, message_0: int, message_1: int
) -> tuple[int, int]:
    """The sender's reply: message 0 and message 1, each under its own branch's key."""
    return (message_0, message_1)


def unwrap(
    grp: dict[str, int], public: int, choice: int, blind: int, ciphertexts: tuple[int, int]
) -> int:
    """The message you asked for. You can build exactly one of the two keys."""
    return 0


def gate_masks(randomness: tuple[int, int]) -> tuple[int, int]:
    """The mask each of the gate's two transfers uses, drawn from fresh randomness.

    The masks cancel when the two output shares are XORed, so more than one arrangement
    reconstructs correctly. Only one of them still hides anything.
    """
    return (randomness[0], randomness[0])


def offer(own_bit: int, mask: int) -> tuple[int, int]:
    """The two messages you put into your transfer, indexed by the other party's bit."""
    return (0, 0)


def output_share(own_x: int, own_y: int, own_mask: int, received: int) -> int:
    """Your share of x AND y, from your own row, your mask, and what you received."""
    return 0


def needs_transfer(gate: str) -> bool:
    """Does this gate need the two parties to talk?"""
    return True
