"""Mirrors of `verifier/server.py`'s direct-answer graders for ac26-bridge-experiment."""


def _predict(server, seed):
    case = server.public_case(seed)
    return (case.start + case.step * case.rounds) % case.modulus


EXPECTED = {
    # The health token is *meant* to be copied off the screen: it only proves the
    # container was started. It is listed so the sweep records that on purpose.
    "environment": lambda server, seed: server.health_token(seed),
    "predict": _predict,
    # Issue 543/537: `corrupted_trace` no longer returns the broken index at all (it
    # ships to the participant image; see fixtures/generate.py). `first_broken_index`
    # -- imported into `verifier.server`'s namespace from `verifier/expected.py`, which
    # does not ship there -- is the only place that derivation still exists.
    "first-broken": lambda server, seed: server.first_broken_index(seed),
}


def _public_fields(server, seed):
    """The four numbers `make inspect` prints for the predict box."""
    return server.public_case(seed).as_dict()


def _corrupt_fields(server, seed):
    # `server.public_payload` is the same dict the Workbench fetches from the verifier
    # at `GET /public` and `show.py` prints; `trace` itself is dropped (as before) so
    # the visibility check runs over the same small field set as the other checkpoints.
    payload = server.public_payload(seed)["firstBroken"]
    fields = {key: value for key, value in payload.items() if key != "trace"}
    fields["traceLength"] = len(payload["trace"])
    return fields


#: What the player is looking at when they answer. The `predict` answer coinciding with
#: the printed `start` was the second defect this whole guard exists because of.
VISIBLE = {
    "environment": lambda server, seed: {"healthToken": server.health_token(seed)},
    "predict": _public_fields,
    "first-broken": _corrupt_fields,
}
