"""Mirrors for sha256-bytes-padding.

`collision` wants a second message that zero-only padding cannot tell apart from the
fixture's. Zero-only padding is not injective under a trailing zero byte, and
`collision_message` is short enough that the extra byte stays inside the same block.
"""


def _length_field(server, seed):
    bits = server.length_field_case(seed) * 8
    return bits.to_bytes(server.LENGTH_FIELD_BYTES, "big").hex()


EXPECTED = {
    "byte-length": lambda server, seed: server.text_case(seed).byte_length,
    "padded-length": lambda server, seed: [
        server.padded_length(length) for length in server.length_quiz(seed)
    ],
    "length-field": _length_field,
    "collision": lambda server, seed: (server.collision_message(seed) + b"\x00").hex(),
}


def _text_fields(server, seed):
    """`byte-length` is only a question while the text has a multi-byte character in it.

    If the fixture string is pure ASCII its byte length equals its character count, and
    the character count is on the screen — the checkpoint is then answered by counting.
    """
    # Only values the player can read off without doing the work belong here. The case's
    # own `byte_length` is the answer, so listing it would report a leak against itself.
    return {"charLength": len(server.text_case(seed).text)}


def _length_field_fields(server, seed):
    """The message length the player is given, in the forms they might submit unchanged.

    The answer is that length times eight, big-endian in eight bytes. Submitting the
    length itself — bytes rather than bits — is the mistake the checkpoint exists to
    catch, so the two must never coincide.
    """
    length = server.length_field_case(seed)
    return {
        "messageLengthBytes": length,
        "messageLengthAsField": length.to_bytes(server.LENGTH_FIELD_BYTES, "big").hex(),
    }


VISIBLE = {"byte-length": _text_fields, "length-field": _length_field_fields}


def _collision_fields(server, seed):
    """The message the player is colliding with.

    The grader rejects a candidate equal to it, so a leak here is impossible by
    construction; the declaration exists so the audit records that it looked.
    """
    return {"originalMessage": server.collision_message(seed).hex()}


VISIBLE["collision"] = _collision_fields

# `padded-length` answers with six numbers at once, and the probe compares a declared
# field against the answer *as a whole* — so no field it could be handed would ever match,
# and declaring the six shown message lengths here would read as a measurement while
# measuring nothing. What is actually wrong with this checkpoint is that those six numbers
# only ever take two values, which the guessable-answer probe reports.
VISIBLE["padded-length"] = lambda _server, _seed: {}
