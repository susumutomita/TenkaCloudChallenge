"""Hidden tests. Run by /verify against a copy of the learner's file, never shown to them.

Split into the phases the checkpoints buy separately:

  `check_verify`      the token is or is not one this gateway issued
  `check_isolate`     the token is genuine; may this request proceed?
  `check_generalize`  everything at once, plus the properties that catch a solution
                      built by pattern-matching the cases rather than deciding

Failure messages name the property. They never name the expected reason, the case
index in the fixture, or anything a learner could turn into a lookup table.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Callable, Protocol

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fixtures.generate import (  # noqa: E402
    ACTIONS,
    HiddenCase,
    extended_mac,
    forge_unsigned,
    hidden_cases,
    keyring,
    primary_kid,
    sign,
    truncated_mac,
)


class Submission(Protocol):
    """The one entry point a submission has to expose."""

    def authorize(
        self,
        token: str,
        action: str,
        resource: dict[str, str],
        now: int,
        keys: dict[str, str],
    ) -> dict[str, object]: ...


Authorize = Callable[..., object]

#: Which reasons belong to which phase. `malformed` sits in `verify` because a token
#: that will not decode has not reached the request question yet.
_VERIFY_REASONS = frozenset({"malformed", "unknown_key", "bad_signature"})
_ISOLATE_REASONS = frozenset({"ok", "not_yet_valid", "expired", "scope_missing", "tenant_mismatch"})


def _call(authorize: Authorize, case: HiddenCase, keys: dict[str, str]) -> object:
    request = case.request
    return authorize(
        request.token,
        request.action,
        {"id": request.resource_id, "tenant": request.resource_tenant},
        request.now,
        keys,
    )


def _check_case(authorize: Authorize, case: HiddenCase, keys: dict[str, str]) -> list[str]:
    try:
        actual = _call(authorize, case, keys)
    except Exception as error:  # noqa: BLE001 - raising on a request is a failing decision
        return [f"raised {type(error).__name__} instead of returning a decision"]

    if not isinstance(actual, dict):
        return ["did not return a decision object"]
    if set(actual) != {"allowed", "reason"}:
        return ["the decision object does not have exactly `allowed` and `reason`"]
    if not isinstance(actual["allowed"], bool):
        return ["`allowed` is not a bool"]

    failures: list[str] = []
    if actual["allowed"] != case.allowed:
        failures.append(
            "allowed a request that must be refused"
            if actual["allowed"]
            else "refused a request that must be allowed"
        )
    if actual["reason"] != case.reason:
        failures.append("the reason does not describe why this request was decided that way")
    return failures


def _phase(authorize: Authorize, seed: str, reasons: frozenset[str]) -> list[str]:
    keys = keyring(seed)
    failures: list[str] = []
    for case in hidden_cases(seed):
        if case.reason not in reasons:
            continue
        failures.extend(_check_case(authorize, case, keys))
    return failures


def check_verify(module: Submission, seed: str) -> list[str]:
    failures = _phase(module.authorize, seed, _VERIFY_REASONS)
    failures.extend(_check_every_held_key_is_usable(module.authorize, seed))
    failures.extend(_check_invalid_key_material_fails_closed(module.authorize, seed))
    return failures


def check_isolate(module: Submission, seed: str) -> list[str]:
    failures = _phase(module.authorize, seed, _ISOLATE_REASONS)
    failures.extend(_check_time_claim_types_fail_closed(module.authorize, seed))
    return failures


def _check_algorithm_is_not_negotiable(authorize: Authorize, seed: str) -> list[str]:
    """A token may not choose how it gets checked.

    The starter dispatches on `header["alg"]`, which passes every public test. This
    mints the same claims under three different declared algorithms and refuses to
    accept any of them: none is signed with the gateway key.
    """
    keys = keyring(seed)
    kid = primary_kid(seed)
    genuine = hidden_cases(seed)[0]
    payload = _payload_of(genuine)
    failures: list[str] = []
    for declared in ("none", "None", "NONE", "hs256"):
        token = forge_unsigned({"alg": declared, "kid": kid}, payload)
        try:
            decision = authorize(
                token,
                genuine.request.action,
                {"id": genuine.request.resource_id, "tenant": genuine.request.resource_tenant},
                genuine.request.now,
                keys,
            )
        except Exception as error:  # noqa: BLE001
            failures.append(f"raised {type(error).__name__} on a token with a declared algorithm")
            continue
        if isinstance(decision, dict) and decision.get("allowed"):
            failures.append("accepted a token that carries no signature made with a gateway key")
    return failures


def _check_every_action_is_decided_on_its_own(authorize: Authorize, seed: str) -> list[str]:
    """Scope is per action, not "this token is privileged".

    A solution that stops at "the token has a scope list" allows every action once any
    action is in scope. Sweeping the whole action set catches it without ever telling
    the learner which action their fixture happens to hold.
    """
    keys = keyring(seed)
    genuine = hidden_cases(seed)[0]
    payload = _payload_of(genuine)
    scope = payload.get("scope")
    if not isinstance(scope, list):
        return ["fixture error: the genuine case has no scope list"]
    failures: list[str] = []
    for action in ACTIONS:
        try:
            decision = authorize(
                genuine.request.token,
                action,
                {"id": genuine.request.resource_id, "tenant": genuine.request.resource_tenant},
                genuine.request.now,
                keys,
            )
        except Exception as error:  # noqa: BLE001
            failures.append(f"raised {type(error).__name__} while deciding an action")
            continue
        if not isinstance(decision, dict):
            failures.append("did not return a decision object while deciding an action")
            continue
        if decision.get("allowed") is not (action in scope):
            failures.append("an action was decided without consulting the token's scope")
    return failures


def _check_the_resource_is_read(authorize: Authorize, seed: str) -> list[str]:
    """The same genuine token against a series of resources.

    Exactly one tenant may be allowed: the one in the claims. A gateway that ignores
    `resource` allows all of them, and a gateway that hard-codes a comparison against
    the wrong field allows none.
    """
    keys = keyring(seed)
    genuine = hidden_cases(seed)[0]
    payload = _payload_of(genuine)
    own = payload.get("tenant")
    allowed_tenants: list[object] = []
    candidates = [own, f"{own}-x", "t-000", "", None]
    for tenant in candidates:
        try:
            decision = authorize(
                genuine.request.token,
                genuine.request.action,
                {"id": genuine.request.resource_id, "tenant": tenant},
                genuine.request.now,
                keys,
            )
        except Exception as error:  # noqa: BLE001
            return [f"raised {type(error).__name__} while deciding a resource"]
        if isinstance(decision, dict) and decision.get("allowed"):
            allowed_tenants.append(tenant)
    if allowed_tenants != [own]:
        return ["the resource's owner did not decide the outcome"]
    return []


def _check_time_boundaries(authorize: Authorize, seed: str) -> list[str]:
    """Sweep the instants around both ends of the validity window.

    Off-by-one at either end is invisible to a test that samples the middle. This walks
    `nbf - 2 .. nbf + 1` and `exp - 2 .. exp + 1` and requires the transition to land
    exactly where a half-open interval puts it.
    """
    keys = keyring(seed)
    genuine = hidden_cases(seed)[0]
    payload = _payload_of(genuine)
    not_before = payload.get("nbf")
    expires = payload.get("exp")
    if not isinstance(not_before, int) or not isinstance(expires, int):
        return ["fixture error: the genuine case has no integer window"]

    failures: list[str] = []
    for when in (not_before - 2, not_before - 1, not_before, not_before + 1, expires - 2,
                 expires - 1, expires, expires + 1):
        try:
            decision = authorize(
                genuine.request.token,
                genuine.request.action,
                {"id": genuine.request.resource_id, "tenant": genuine.request.resource_tenant},
                when,
                keys,
            )
        except Exception as error:  # noqa: BLE001
            failures.append(f"raised {type(error).__name__} while deciding an instant")
            continue
        if not isinstance(decision, dict):
            failures.append("did not return a decision object while deciding an instant")
            continue
        if decision.get("allowed") is not (not_before <= when < expires):
            failures.append("the validity window does not start and end where the claims put it")
    return failures


def _check_an_unknown_key_is_not_a_bad_signature(authorize: Authorize, seed: str) -> list[str]:
    """A key id the gateway does not hold is its own answer.

    Collapsing it into `bad_signature` reads, during an incident, as "somebody is
    forging tokens" when the truth may be "a key was retired and a client did not
    notice". Both deny; only one of them tells the on-call the right thing.
    """
    keys = keyring(seed)
    genuine = hidden_cases(seed)[0]
    payload = _payload_of(genuine)
    token = sign({"alg": "hs256", "kid": "k-does-not-exist"}, payload, next(iter(keys.values())))
    try:
        decision = authorize(
            token,
            genuine.request.action,
            {"id": genuine.request.resource_id, "tenant": genuine.request.resource_tenant},
            genuine.request.now,
            keys,
        )
    except Exception as error:  # noqa: BLE001
        return [f"raised {type(error).__name__} on a token naming an unheld key"]
    if not isinstance(decision, dict):
        return ["did not return a decision object for a token naming an unheld key"]
    if decision.get("allowed"):
        return ["accepted a token signed under a key id the gateway does not hold"]
    if decision.get("reason") != "unknown_key":
        return ["an unheld key id was not reported as its own reason"]
    return []


def _check_every_held_key_is_usable(authorize: Authorize, seed: str) -> list[str]:
    """`kid` selects the matching held key, including a rotated one.

    Looking up only the first key works for every primary-key fixture and still looks
    like key verification. A real rotation is the case that proves the identifier and
    key material remain bound together.
    """
    keys = keyring(seed)
    genuine = hidden_cases(seed)[0]
    payload = _payload_of(genuine)
    failures: list[str] = []
    for kid, secret in keys.items():
        token = sign({"alg": "hs256", "kid": kid}, payload, secret)
        try:
            decision = authorize(
                token,
                genuine.request.action,
                {"id": genuine.request.resource_id, "tenant": genuine.request.resource_tenant},
                genuine.request.now,
                keys,
            )
        except Exception as error:  # noqa: BLE001
            failures.append(f"raised {type(error).__name__} while using a held signing key")
            continue
        if not isinstance(decision, dict) or decision.get("allowed") is not True:
            failures.append("refused a genuine token made with a held signing key")
        elif decision.get("reason") != "ok":
            failures.append("did not report a genuine held-key token as accepted")
    return failures


def _check_invalid_key_material_fails_closed(authorize: Authorize, seed: str) -> list[str]:
    """A broken local key entry is a denial, never a crashed gateway.

    The participant contract does not assign a specific reason to locally corrupted
    key material, so this check deliberately grades only the fail-closed boundary.
    """
    keys: dict[str, object] = dict(keyring(seed))
    kid = primary_kid(seed)
    keys[kid] = None
    genuine = hidden_cases(seed)[0]
    try:
        decision = authorize(
            genuine.request.token,
            genuine.request.action,
            {"id": genuine.request.resource_id, "tenant": genuine.request.resource_tenant},
            genuine.request.now,
            keys,
        )
    except Exception as error:  # noqa: BLE001
        return [f"raised {type(error).__name__} on unusable held key material"]
    if not isinstance(decision, dict) or decision.get("allowed") is not False:
        return ["accepted a token when its selected held key was unusable"]
    return []


def _check_time_claim_types_fail_closed(authorize: Authorize, seed: str) -> list[str]:
    """JSON booleans must not become timestamps through Python's bool/int relation."""
    keys = keyring(seed)
    kid = primary_kid(seed)
    genuine = hidden_cases(seed)[0]
    payload = _payload_of(genuine)
    failures: list[str] = []
    for claim in ("nbf", "exp"):
        malformed = dict(payload)
        malformed[claim] = True
        token = sign({"alg": "hs256", "kid": kid}, malformed, keys[kid])
        try:
            decision = authorize(
                token,
                genuine.request.action,
                {"id": genuine.request.resource_id, "tenant": genuine.request.resource_tenant},
                genuine.request.now,
                keys,
            )
        except Exception as error:  # noqa: BLE001
            failures.append(f"raised {type(error).__name__} on a non-integer time claim")
            continue
        if not isinstance(decision, dict) or decision.get("allowed") is not False:
            failures.append("accepted a token whose time claim is not an integer")
        elif decision.get("reason") != "malformed":
            failures.append("did not report a non-integer time claim as malformed")

    try:
        decision = authorize(
            genuine.request.token,
            genuine.request.action,
            {"id": genuine.request.resource_id, "tenant": genuine.request.resource_tenant},
            True,
            keys,
        )
    except Exception as error:  # noqa: BLE001
        failures.append(f"raised {type(error).__name__} on a non-integer gateway clock")
    else:
        if not isinstance(decision, dict) or decision.get("allowed") is not False:
            failures.append("accepted a request whose gateway clock is not an integer")
        elif decision.get("reason") != "malformed":
            failures.append("did not report a non-integer gateway clock as malformed")
    return failures


def _check_the_whole_signature_is_compared(authorize: Authorize, seed: str) -> list[str]:
    """A signature is not a prefix.

    `expected[:8] == presented[:8]` looks like a comparison and passes every test that
    only presents genuine and wholly-wrong tokens. It accepts a token whose signature
    was cut down to the bytes being looked at -- which is a forgery costing 2^64 work
    instead of 2^256, and free if the attacker already holds one genuine token for
    the same claims.
    """
    keys = keyring(seed)
    genuine = hidden_cases(seed)[0]
    failures: list[str] = []
    variants = [truncated_mac(genuine.request.token, keep) for keep in (0, 1, 8, 16, 31)]
    variants.extend(extended_mac(genuine.request.token, extra) for extra in (1, 8))
    for token in variants:
        try:
            decision = authorize(
                token,
                genuine.request.action,
                {"id": genuine.request.resource_id, "tenant": genuine.request.resource_tenant},
                genuine.request.now,
                keys,
            )
        except Exception as error:  # noqa: BLE001
            failures.append(f"raised {type(error).__name__} on a wrong-length signature")
            continue
        if isinstance(decision, dict) and decision.get("allowed"):
            failures.append("accepted a signature that is not the one this gateway would make")
    return failures


def _payload_of(case: HiddenCase) -> dict[str, object]:
    """Decode the claims out of a fixture token, so properties can be stated in its terms."""
    import base64
    import json

    body = case.request.token.split(".")[1]
    padded = body + "=" * (-len(body) % 4)
    value = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")))
    assert isinstance(value, dict)
    return value


def check_generalize(module: Submission, seed: str) -> list[str]:
    authorize = module.authorize
    failures = _phase(authorize, seed, _VERIFY_REASONS | _ISOLATE_REASONS)
    failures.extend(_check_algorithm_is_not_negotiable(authorize, seed))
    failures.extend(_check_every_action_is_decided_on_its_own(authorize, seed))
    failures.extend(_check_the_resource_is_read(authorize, seed))
    failures.extend(_check_time_boundaries(authorize, seed))
    failures.extend(_check_an_unknown_key_is_not_a_bad_signature(authorize, seed))
    failures.extend(_check_every_held_key_is_usable(authorize, seed))
    failures.extend(_check_invalid_key_material_fails_closed(authorize, seed))
    failures.extend(_check_time_claim_types_fail_closed(authorize, seed))
    failures.extend(_check_the_whole_signature_is_compared(authorize, seed))
    return failures


def run(module: Submission, seed: str) -> list[str]:
    """Every phase at once. Used by the mutation suite."""
    return check_generalize(module, seed)
