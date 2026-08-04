"""Mirrors for sha256-schedule-logic. Words are submitted as hex, per `_normalized_words`."""


def _rotate(server, seed):
    case = server.rotate_case(seed)
    amount = case.rotate_by % server.WORD_BITS
    rotated = ((case.word >> amount) | (case.word << (server.WORD_BITS - amount))) & server.MASK
    return [f"{rotated:08x}", f"{case.word >> case.shift_by:08x}"]


def _mux(server, seed):
    case = server.mux_case(seed)
    return [f"{(case.e & case.f) ^ (~case.e & server.MASK & case.g):08x}"]


EXPECTED = {
    "rotate": _rotate,
    "mux": _mux,
    "dependency": lambda server, _seed: server.first_affected_index(),
}


def _rotate_fields(server, seed):
    case = server.rotate_case(seed)
    return {
        "word": [f"{case.word:08x}"],
        "rotate_by": case.rotate_by,
        "shift_by": case.shift_by,
    }


def _mux_fields(server, seed):
    case = server.mux_case(seed)
    return {name: [f"{getattr(case, name):08x}"] for name in ("e", "f", "g")}


#: A rotate answer equal to an input word means the shift amount was a no-op; a Ch answer
#: equal to `f` or `g` means the fixture picked a mask that selects one input whole.
VISIBLE = {"rotate": _rotate_fields, "mux": _mux_fields}
