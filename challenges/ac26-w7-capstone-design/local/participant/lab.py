"""Completed option and property vocabulary for design.py.

This is a teaching comparison, not a cryptographic implementation or production
recommendation. The free statement defines each name and how to use these tables.
A real protocol's assumptions, guarantees and implementation require separate review.
"""

from __future__ import annotations

from typing import Any

# ---------------------------------------------------------------------------
# The property vocabulary. A design says which of these the brief requires.
# ---------------------------------------------------------------------------

PROPERTIES: tuple[str, ...] = (
    "correctness",
    "privacy",
    "soundness",
    "zero_knowledge",
    "binding",
    "availability",
)

# ---------------------------------------------------------------------------
# What each primitive provides, and what it makes you trust to get it.
#
# `provides`    — properties the primitive delivers when used as intended.
# `trusts`      — what has to hold. An entry in ACTOR_TRUSTS names a *party*; anything else
#                 names an assumption about the world.
# `assumptions` — stated in words, for the design document.
# `non_goals`   — what the primitive is routinely, wrongly, assumed to give you.
#
# The `non_goals` are the misconceptions this problem targets. FHE does not remove key
# management: somebody still holds the decryption key, and that somebody is an actor in the
# threat model. MPC does not remove the collusion assumption, it relocates it. A ZK proof
# does not hide the public inputs, only the witness.
# ---------------------------------------------------------------------------

PRIMITIVES: dict[str, dict[str, Any]] = {
    "none": {
        "provides": ("correctness", "availability"),
        "trusts": ("operator",),
        "assumptions": ("the operator is honest and its host is not compromised",),
        "non_goals": ("privacy from the operator", "soundness against the operator"),
    },
    "mpc": {
        "provides": ("correctness", "privacy"),
        "trusts": ("non_collusion",),
        "assumptions": ("fewer than the threshold number of parties collude",),
        "non_goals": (
            "removing the collusion assumption",
            "soundness against a lying input provider",
        ),
    },
    "fhe": {
        "provides": ("correctness", "privacy"),
        "trusts": ("key_holder",),
        "assumptions": ("the decryption key holder is not the evaluator",),
        "non_goals": ("removing key management", "access control on the decrypted result"),
    },
    "zk": {
        "provides": ("correctness", "soundness", "zero_knowledge"),
        "trusts": (),
        "assumptions": ("the statement is the one the verifier believes it is",),
        "non_goals": ("hiding the public inputs", "privacy of an input held by another party"),
    },
    "commitment": {
        "provides": ("binding",),
        "trusts": (),
        "assumptions": ("the commitment is opened by the party that made it",),
        "non_goals": ("privacy of the committed value after it is opened",),
    },
    "threshold": {
        "provides": ("availability",),
        "trusts": ("non_collusion",),
        "assumptions": ("at least the threshold number of parties stay reachable",),
        "non_goals": ("privacy on its own",),
    },
}

#: `trusts` entries that name a party rather than an assumption about the world. A brief can
#: rule these out: you cannot trust an operator that somebody's asset must be hidden from.
ACTOR_TRUSTS: frozenset[str] = frozenset({"operator", "key_holder"})

#: Roles that run infrastructure, and are therefore what "the operator" resolves to.
OPERATOR_ROLES: frozenset[str] = frozenset({"operator", "evaluator"})
