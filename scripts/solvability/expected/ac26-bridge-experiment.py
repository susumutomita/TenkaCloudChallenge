"""Mirrors of `verifier/server.py`'s direct-answer graders for ac26-bridge-experiment."""


def _predict(server, seed):
    case = server.public_case(seed)
    return (case.start + case.step * case.rounds) % case.modulus


EXPECTED = {
    # The health token is *meant* to be copied off the screen: it only proves the
    # container was started. It is listed so the sweep records that on purpose.
    "environment": lambda server, seed: server.health_token(seed),
    "predict": _predict,
    "first-broken": lambda server, seed: server.corrupted_trace(seed)[2],
}


def _public_fields(server, seed):
    """The four numbers `make inspect` prints for the predict box."""
    return server.public_case(seed).as_dict()


def _corrupt_fields(server, seed):
    case, trace, _broke = server.corrupted_trace(seed)
    fields = case.as_dict()
    fields["traceLength"] = len(trace)
    return fields


#: What the player is looking at when they answer. The `predict` answer coinciding with
#: the printed `start` was the second defect this whole guard exists because of.
VISIBLE = {
    "environment": lambda server, seed: {"healthToken": server.health_token(seed)},
    "predict": _public_fields,
    "first-broken": _corrupt_fields,
}
