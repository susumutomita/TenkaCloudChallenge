"""Mirrors of `verifier/server.py`'s direct-answer graders for cs-auth-claim-audit."""


EXPECTED = {
    # The health token is *meant* to be copied off the screen: it only proves the
    # container was started. It is listed so the sweep records that on purpose.
    "environment": lambda server, seed: server.health_token(seed),
    "window": lambda server, seed: server.validity_window(seed),
    "audit": lambda server, seed: server.decision_log(seed)[1],
}


def _window_visible(server, seed):
    """What the player is looking at when they answer `window`.

    The claims are on screen in full, so `nbf` and `exp` themselves are visible. The
    answer is `[nbf, exp - 1]`, and the probe exists to catch the case where the second
    element coincides with the printed `exp` -- which would mean the checkpoint scores
    "I copied the claim" the same as "I worked out that `exp` is exclusive".

    Imported from the fixture module rather than read off `verifier.server`'s namespace:
    the server only happened to re-export it, so tidying an unused import there broke
    this probe with an AttributeError instead of a solvability finding. Imported per
    call, because the audit purges and re-imports `fixtures` between seeds.
    """
    from fixtures.generate import public_request

    claims = public_request(seed)["claims"]
    return {"nbf": claims["nbf"], "exp": claims["exp"]}


def _audit_visible(server, seed):
    """What the player is looking at when they answer `audit`.

    The row indices and the gateway's own decisions are on screen. The answer is a
    subset of the allowed indices, so the interesting coincidence is "the answer equals
    every allowed row" -- at which point the audit degenerates into copying a column
    instead of recomputing the MACs and comparing tenants.
    """
    entries, _wrong = server.decision_log(seed)
    return {
        "allowedIndices": [
            index for index, entry in enumerate(entries) if entry["gatewayDecision"] == "allow"
        ],
        "deniedIndices": [
            index for index, entry in enumerate(entries) if entry["gatewayDecision"] == "deny"
        ],
        "rowCount": len(entries),
    }


VISIBLE = {
    "environment": lambda server, seed: {"healthToken": server.health_token(seed)},
    "window": _window_visible,
    "audit": _audit_visible,
}
