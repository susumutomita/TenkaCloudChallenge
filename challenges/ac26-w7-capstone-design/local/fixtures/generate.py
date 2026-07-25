"""Seed-derived design briefs, and the primitive capability table they are designed against.

Everything a learner reasons about here is data: a *brief* states who the actors are, what
the assets are, who may learn what, and who relies on what. Nothing in a brief names a
cryptographic primitive — that is the whole point of the exercise. The primitive shows up
only in `PRIMITIVES`, as a table of what each one actually provides and what it makes you
trust in exchange.

Toy warning: `PRIMITIVES` is a teaching abstraction. Real deployments differ in ways this
table flattens (setup assumptions, malicious-versus-semi-honest security, circuit size,
ciphertext expansion). It is chosen for observability, not as production guidance.
"""

from __future__ import annotations

import copy
import hashlib
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


# ---------------------------------------------------------------------------
# Briefs
# ---------------------------------------------------------------------------


def _stream(seed: str, label: str) -> int:
    """A stable integer from the seed, so a redeploy reshuffles which brief is visible."""
    digest = hashlib.sha256(f"{seed}/{label}".encode()).digest()
    return int.from_bytes(digest[:8], "big")


def _brief(
    brief_id: str,
    statement: str,
    actors: list[dict[str, Any]],
    assets: list[dict[str, Any]],
    constraints: dict[str, Any],
) -> dict[str, Any]:
    return {
        "id": brief_id,
        "statement": statement,
        "actors": actors,
        "assets": assets,
        "constraints": constraints,
    }


def _joint_statistic() -> dict[str, Any]:
    """Several clinics want one statistic, and no clinic will hand over its row."""
    return _brief(
        "joint-statistic",
        "Three clinics want the average of a number each of them holds. No clinic may see "
        "another clinic's number, and none of them is willing to hand its number to a shared "
        "server. Everybody accepts the average once it exists.",
        [
            {"id": "clinic_a", "role": "input_provider"},
            {"id": "clinic_b", "role": "input_provider"},
            {"id": "clinic_c", "role": "input_provider"},
        ],
        [
            {
                "id": "row_a",
                "owner": "clinic_a",
                "known_to": ["clinic_a"],
                "must_not_learn": ["clinic_b", "clinic_c"],
                "integrity_relied_on_by": [],
            },
            {
                "id": "row_b",
                "owner": "clinic_b",
                "known_to": ["clinic_b"],
                "must_not_learn": ["clinic_a", "clinic_c"],
                "integrity_relied_on_by": [],
            },
            {
                "id": "row_c",
                "owner": "clinic_c",
                "known_to": ["clinic_c"],
                "must_not_learn": ["clinic_a", "clinic_b"],
                "integrity_relied_on_by": [],
            },
            {
                "id": "average",
                "owner": "clinic_a",
                "known_to": ["clinic_a", "clinic_b", "clinic_c"],
                "must_not_learn": [],
                "integrity_relied_on_by": [],
                "derived_from": ["row_a", "row_b", "row_c"],
            },
        ],
        {"parties": 3, "must_complete_without_all_parties": False, "commit_then_reveal": False},
    )


def _solvency_claim() -> dict[str, Any]:
    """One party acts on a statement about a number it is not allowed to see."""
    return _brief(
        "solvency-claim",
        "A borrower wants a lender to accept that a balance is above a threshold. The lender "
        "acts on the answer and will not simply take the borrower's word for it. The balance "
        "itself is none of the lender's business.",
        [
            {"id": "borrower", "role": "input_provider"},
            {"id": "lender", "role": "relying_party"},
        ],
        [
            {
                "id": "balance",
                "owner": "borrower",
                "known_to": ["borrower"],
                "must_not_learn": ["lender"],
                "integrity_relied_on_by": [],
            },
            {
                "id": "threshold_met",
                "owner": "borrower",
                "known_to": ["borrower", "lender"],
                "must_not_learn": [],
                "integrity_relied_on_by": ["lender"],
                "derived_from": ["balance"],
            },
        ],
        {"parties": 2, "must_complete_without_all_parties": False, "commit_then_reveal": False},
    )


def _delegated_scoring() -> dict[str, Any]:
    """A computation is delegated to a host that must not read its input."""
    return _brief(
        "delegated-scoring",
        "A client wants a server to run a published scoring function over the client's own "
        "record. The server must not read the record. The client uses the score itself and "
        "shows it to nobody.",
        [
            {"id": "client", "role": "input_provider"},
            {"id": "server", "role": "evaluator"},
        ],
        [
            {
                "id": "record",
                "owner": "client",
                "known_to": ["client"],
                "must_not_learn": ["server"],
                "integrity_relied_on_by": [],
            },
            {
                "id": "score",
                "owner": "client",
                "known_to": ["client"],
                "must_not_learn": ["server"],
                "integrity_relied_on_by": [],
                "derived_from": ["record"],
            },
        ],
        {"parties": 2, "must_complete_without_all_parties": False, "commit_then_reveal": False},
    )


def _sealed_bid() -> dict[str, Any]:
    """Offers are fixed before they are opened, and everybody acts on the outcome."""
    return _brief(
        "sealed-bid",
        "Bidders submit an offer before a deadline, and the offers are opened afterwards. A "
        "bidder must not be able to change an offer once the deadline has passed, and the "
        "auctioneer publishes a winner that every bidder then acts on.",
        [
            {"id": "bidder_a", "role": "input_provider"},
            {"id": "bidder_b", "role": "input_provider"},
            {"id": "auctioneer", "role": "relying_party"},
        ],
        [
            {
                "id": "bid_a",
                "owner": "bidder_a",
                "known_to": ["bidder_a"],
                "must_not_learn": ["bidder_b"],
                "integrity_relied_on_by": [],
            },
            {
                "id": "bid_b",
                "owner": "bidder_b",
                "known_to": ["bidder_b"],
                "must_not_learn": ["bidder_a"],
                "integrity_relied_on_by": [],
            },
            {
                "id": "winner",
                "owner": "auctioneer",
                "known_to": ["bidder_a", "bidder_b", "auctioneer"],
                "must_not_learn": [],
                "integrity_relied_on_by": ["bidder_a", "bidder_b"],
                "derived_from": ["bid_a", "bid_b"],
            },
        ],
        {"parties": 3, "must_complete_without_all_parties": False, "commit_then_reveal": True},
    )


def _shift_board() -> dict[str, Any]:
    """The brief that needs no cryptography. A design has to be able to say so.

    Nothing is secret, nobody distrusts the operator, and no party relies on a value it did
    not compute. Reaching for a primitive here is starting from the primitive rather than
    from the problem — which is the habit the whole checkpoint exists to catch.
    """
    return _brief(
        "shift-board",
        "A team wants a shared page showing who is on shift today. Everyone on the team may "
        "read it, and everyone is content for the team's own server to display it. The roster "
        "is not confidential, and nothing outside the team depends on it.",
        [
            {"id": "member", "role": "input_provider"},
            {"id": "team_server", "role": "operator"},
        ],
        [
            {
                "id": "roster",
                "owner": "member",
                "known_to": ["member", "team_server"],
                "must_not_learn": [],
                "integrity_relied_on_by": [],
            },
            {
                "id": "today_view",
                "owner": "team_server",
                "known_to": ["member", "team_server"],
                "must_not_learn": [],
                "integrity_relied_on_by": [],
                "derived_from": ["roster"],
            },
        ],
        {"parties": 2, "must_complete_without_all_parties": False, "commit_then_reveal": False},
    )


def _recovery_key() -> dict[str, Any]:
    """A secret that has to survive one custodian being unreachable."""
    return _brief(
        "recovery-key",
        "An organization stores one recovery secret with three custodians. No single "
        "custodian may learn it, and recovery has to succeed on a day when one custodian "
        "cannot be reached.",
        [
            {"id": "owner_org", "role": "input_provider"},
            {"id": "custodian_a", "role": "operator"},
            {"id": "custodian_b", "role": "operator"},
            {"id": "custodian_c", "role": "operator"},
        ],
        [
            {
                "id": "recovery_secret",
                "owner": "owner_org",
                "known_to": ["owner_org"],
                "must_not_learn": ["custodian_a", "custodian_b", "custodian_c"],
                "integrity_relied_on_by": [],
            },
            {
                "id": "restored_secret",
                "owner": "owner_org",
                "known_to": ["owner_org"],
                "must_not_learn": ["custodian_a", "custodian_b", "custodian_c"],
                "integrity_relied_on_by": [],
                "derived_from": ["recovery_secret"],
            },
        ],
        {"parties": 4, "must_complete_without_all_parties": True, "commit_then_reveal": False},
    )


#: Every brief the problem can hand out. The public tests show one; the hidden tests use all
#: of them, plus the variants below.
BRIEF_BUILDERS = (
    _joint_statistic,
    _solvency_claim,
    _delegated_scoring,
    _sealed_bid,
    _shift_board,
    _recovery_key,
)


def all_briefs() -> list[dict[str, Any]]:
    """Fresh copies, so a caller that mutates one does not corrupt the next call."""
    return [build() for build in BRIEF_BUILDERS]


def brief(name: str) -> dict[str, Any]:
    """One brief by id."""
    for candidate in all_briefs():
        if candidate["id"] == name:
            return candidate
    raise KeyError(name)


def public_brief(seed: str) -> dict[str, Any]:
    """The brief the public tests and `make inspect` work through.

    Seed-dependent, so the visible example is not a fixed one that a solution can be shaped
    around — but always one the hidden tests also cover.
    """
    briefs = all_briefs()
    return briefs[_stream(seed, "public-brief") % len(briefs)]


# ---------------------------------------------------------------------------
# Variants — the hidden scenario review
# ---------------------------------------------------------------------------


def distrust_operator(source: dict[str, Any]) -> dict[str, Any]:
    """Every operator becomes a party that no owner will reveal a secret to.

    This is the variant that invalidates a design whose privacy was quietly delegated to a
    party the original brief happened to trust.
    """
    variant = copy.deepcopy(source)
    operators = [a["id"] for a in variant["actors"] if a["role"] in OPERATOR_ROLES]
    if not operators:
        # Nothing to distrust yet: name the party the design was relying on.
        variant["actors"].append({"id": "hosted_runner", "role": "operator"})
        operators = ["hosted_runner"]
    for asset in variant["assets"]:
        for operator in operators:
            # An operator that already owns the asset cannot be hidden from it; anything
            # else it could previously read, it now may not. Revoking the read is the point
            # — appending to `must_not_learn` while leaving the operator in `known_to`
            # would contradict itself and change no design.
            if asset["owner"] == operator:
                continue
            if operator in asset["known_to"]:
                asset["known_to"].remove(operator)
            if operator not in asset["must_not_learn"]:
                asset["must_not_learn"].append(operator)
    variant["id"] = f"{source['id']}-distrusted-operator"
    return variant


def add_relying_party(source: dict[str, Any]) -> dict[str, Any]:
    """Somebody outside now acts on the result, and will not take the producer's word for it.

    A party relying on a value it did not compute is what makes soundness a requirement —
    and, when that value is derived from something private, zero knowledge along with it.
    """
    variant = copy.deepcopy(source)
    variant["actors"].append({"id": "regulator", "role": "relying_party"})
    for asset in variant["assets"]:
        if not asset.get("derived_from"):
            continue
        if "regulator" not in asset["known_to"]:
            asset["known_to"].append("regulator")
        if "regulator" not in asset["integrity_relied_on_by"]:
            asset["integrity_relied_on_by"].append("regulator")
    variant["id"] = f"{source['id']}-with-regulator"
    return variant


def require_partial_availability(source: dict[str, Any]) -> dict[str, Any]:
    """The result must still be produced on a day when one party is unreachable."""
    variant = copy.deepcopy(source)
    variant["constraints"]["must_complete_without_all_parties"] = True
    variant["id"] = f"{source['id']}-partial"
    return variant


VARIANT_BUILDERS = (distrust_operator, add_relying_party, require_partial_availability)


def variants(seed: str) -> list[dict[str, Any]]:
    """Every brief under every change of facts, in a seed-dependent order.

    All of them, not a seeded sample: for several combinations the right answer differs
    from the original brief's, and a sample could miss every one of those in some runs.
    The scenario review is only a review if the design has to move.
    """
    produced = [build(source) for source in all_briefs() for build in VARIANT_BUILDERS]
    produced.sort(key=lambda variant: _stream(seed, variant["id"]))
    return produced


def review_variant(seed: str) -> dict[str, Any]:
    """The one variant `make inspect` walks through, so the learner has a worked example."""
    return variants(seed)[0]


# ---------------------------------------------------------------------------
# Synthetic briefs
# ---------------------------------------------------------------------------


def synthetic_briefs(seed: str, count: int = 12) -> list[dict[str, Any]]:
    """Briefs nobody has read, built from the seed.

    The six briefs above are files in this repository, so a solution *could* be a lookup
    table keyed by `brief["id"]`. These cannot be looked up: the actors, the assets, who
    hides what from whom, and the constraints are all derived from the per-deploy seed, and
    the ids carry a seed-dependent suffix so they never repeat across deployments.

    Every generated brief is well formed by construction — every `must_not_learn` and
    `integrity_relied_on_by` entry is an actor that exists, every `derived_from` entry is an
    asset that exists, and no asset is both owned by and hidden from the same party.
    """
    produced: list[dict[str, Any]] = []
    for index in range(count):
        tag = f"{_stream(seed, f'synthetic/{index}/tag') % 0xFFFF:04x}"
        providers = 1 + _stream(seed, f"synthetic/{index}/providers") % 3
        has_operator = bool(_stream(seed, f"synthetic/{index}/operator") % 2)
        has_relier = bool(_stream(seed, f"synthetic/{index}/relier") % 2)

        actors = [{"id": f"p{n}_{tag}", "role": "input_provider"} for n in range(providers)]
        if has_operator:
            actors.append({"id": f"host_{tag}", "role": "operator"})
        if has_relier:
            actors.append({"id": f"audit_{tag}", "role": "relying_party"})

        assets: list[dict[str, Any]] = []
        for n in range(providers):
            owner = f"p{n}_{tag}"
            # Who may not read this input: the other providers, and sometimes the host.
            hidden = [a["id"] for a in actors if a["role"] == "input_provider" and a["id"] != owner]
            if has_operator and _stream(seed, f"synthetic/{index}/hide-host/{n}") % 2:
                hidden.append(f"host_{tag}")
            if not _stream(seed, f"synthetic/{index}/secret/{n}") % 3:
                hidden = []  # a public input, so `privacy` is not a foregone conclusion
            assets.append(
                {
                    "id": f"input{n}_{tag}",
                    "owner": owner,
                    "known_to": [owner],
                    "must_not_learn": hidden,
                    "integrity_relied_on_by": [],
                }
            )

        result_owner = f"host_{tag}" if has_operator else f"p0_{tag}"
        relied_on_by = [f"audit_{tag}"] if has_relier else []
        assets.append(
            {
                "id": f"result_{tag}",
                "owner": result_owner,
                "known_to": sorted({a["id"] for a in actors}),
                "must_not_learn": [],
                "integrity_relied_on_by": relied_on_by,
                "derived_from": [f"input{n}_{tag}" for n in range(providers)],
            }
        )
        # The auditor reads the result, so it can only be an adversary for the inputs.
        if has_relier:
            for asset in assets[:-1]:
                if asset["must_not_learn"] and _stream(seed, f"synthetic/{index}/hide-audit") % 2:
                    asset["must_not_learn"].append(f"audit_{tag}")

        produced.append(
            _brief(
                f"synthetic-{index}-{tag}",
                "A generated brief. Read the actors, the assets, and the constraints; "
                "nothing here has a name you can look up.",
                actors,
                assets,
                {
                    "parties": len(actors),
                    "must_complete_without_all_parties": bool(
                        _stream(seed, f"synthetic/{index}/availability") % 2
                    ),
                    "commit_then_reveal": bool(_stream(seed, f"synthetic/{index}/binding") % 2),
                },
            )
        )
    return produced
