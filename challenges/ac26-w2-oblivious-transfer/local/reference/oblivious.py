"""Reference solution. Inside the image only; never mounted to the host."""

from __future__ import annotations

from participant.ot import derive_key


def request(grp: dict[str, int], public: int, choice: int, blind: int) -> int:
    p, g = grp["p"], grp["g"]
    blinded = pow(g, blind, p)
    # choice 1 shifts the request by the sender's public key; choice 0 leaves it.
    # Both are uniform over the subgroup when `blind` is, which is what hides the bit.
    return (public * blinded) % p if choice else blinded


def blind_range(grp: dict[str, int]) -> tuple[int, int]:
    # Inclusive bounds. 0 is IN: excluding it makes B = 1 reachable only under
    # choice 1 and B = A only under choice 0, which names the bit outright.
    return (0, grp["q"] - 1)


def encrypt(
    grp: dict[str, int], secret: int, public: int, req: int, message_0: int, message_1: int
) -> tuple[int, int]:
    p = grp["p"]
    key_0 = derive_key(grp, pow(req, secret, p))
    # The choice-1 branch is the request with the public key divided back out.
    unshifted = (req * pow(public, p - 2, p)) % p
    key_1 = derive_key(grp, pow(unshifted, secret, p))
    return (message_0 ^ key_0, message_1 ^ key_1)


def unwrap(
    grp: dict[str, int], public: int, choice: int, blind: int, ciphertexts: tuple[int, int]
) -> int:
    # One key, computed from the receiver's own blind. Whichever branch was taken,
    # this equals the sender's key for that branch and no other.
    key = derive_key(grp, pow(public, blind, grp["p"]))
    return ciphertexts[choice] ^ key


def gate_masks(randomness: tuple[int, int]) -> tuple[int, int]:
    # One fresh mask per transfer. Reusing a single mask for both still reconstructs
    # -- the masks cancel either way -- and turns each party's output share into a
    # readout of the other party's bits, so the gate stays correct and stops hiding.
    return (randomness[0], randomness[1])


def offer(own_bit: int, mask: int) -> tuple[int, int]:
    # The two messages a party puts into its transfer: the mask, and the mask with
    # its own bit folded in. The receiver takes one according to its own bit, so it
    # ends up holding mask ^ (own_bit & other_bit) without either side learning the
    # other's bit.
    return (mask, mask ^ own_bit)


def output_share(own_x: int, own_y: int, own_mask: int, received: int) -> int:
    # The local product, plus the mask this party kept as sender, plus what it got
    # as receiver. XOR the two parties' rows and the masks cancel, leaving all four
    # cross terms of (x0^x1)&(y0^y1).
    return (own_x & own_y) ^ own_mask ^ received


def needs_transfer(gate: str) -> bool:
    # XOR is linear over XOR-shares: each party XORs its own row, no talking.
    return gate == "and"
