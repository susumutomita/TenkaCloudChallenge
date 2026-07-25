"""The only file you edit in this problem.

You are handed a *brief*: who the actors are, what the assets are, who must not learn what,
who acts on what they did not compute, and what the deadline rules are. Nothing in a brief
names a cryptographic primitive. That is deliberate — the primitive is the last decision,
not the first.

Your job is to turn a brief into a design, as code. Eight functions, each one deriving its
answer from the brief in front of it. Write them that way and the last checkpoint costs you
nothing; write down an answer instead and the last checkpoint is where that shows.

`fixtures.generate` gives you the vocabulary:

    PROPERTIES     the six properties a design can be required to hold
    PRIMITIVES     each option, what it provides, what it makes you trust, what it does not do
    ACTOR_TRUSTS   which of those trusts name a *party* rather than an assumption
    OPERATOR_ROLES the actor roles that run infrastructure

Run `make inspect` for a worked brief, `make test` to check yourself.
"""

from __future__ import annotations

from typing import Any


def classify_assets(brief: dict[str, Any]) -> dict[str, dict[str, str]]:
    """Every asset in the brief, as {"owner": ..., "classification": ...}.

    The four classifications are `public`, `private`, `derived-public` and `derived-private`.
    Two facts in the brief decide which one applies, and neither is a matter of taste.

    Every asset gets an entry. An asset you did not classify is an asset nobody is
    protecting.
    """
    return {}


def required_properties(brief: dict[str, Any]) -> dict[str, bool]:
    """Which of `PROPERTIES` this brief requires. Every property gets a yes or a no.

    Some are easier than they look:

      - being hidden from a party that *takes part* in producing the result, and being
        hidden from a party that only *reads* the result, are not the same requirement;
      - somebody acting on a value they did not compute is what puts soundness on the list;
      - soundness on its own is an ordinary signature. Something else has to be true before
        zero knowledge is also required — look at what the relied-upon value is derived from.
    """
    return {}


def compare_alternatives(brief: dict[str, Any]) -> list[dict[str, Any]]:
    """Every option, judged against this brief.

    One entry per primitive, each carrying `primitive`, `satisfies`, `assumptions`,
    `non_goals`, and `admissible`.

    Four of those are lookups. `admissible` is not: it asks whether *this* brief supplies
    the party the option needs you to trust. An option that trusts an assumption about the
    world is available anywhere; an option that trusts a party is only available where the
    brief has one to spare.

    Include the option that uses no cryptography. A comparison that leaves it out cannot
    show that cryptography bought anything.
    """
    return []


def select_primitive(brief: dict[str, Any]) -> list[str]:
    """The options this design uses. A list, because some briefs need more than one.

    Three conditions, and one rule that comes before them.

    The rule: if the brief requires nothing that cryptography provides, the answer is the
    option that uses none.

    The conditions: the selection covers every required property; every option in it is
    admissible for this brief; and nothing in it could be removed with the cover intact.
    """
    return []


def architecture(brief: dict[str, Any], selection: list[str]) -> dict[str, Any]:
    """A typed data-flow graph: {"nodes": [...], "edges": [...]}.

    A node is {"id", "operated_by", "primitives", "trusts"} — who runs this component, what
    it implements, and which other components it takes on faith. An edge is
    {"from", "to", "asset", "visibility"}, where visibility is one of `plaintext`,
    `ciphertext`, `share`, `proof`, `public`.

    The type on the edge is the design. "the record reaches the evaluator" says nothing;
    "the record reaches the evaluator as ciphertext" is a claim that can be wrong.

    Two things are checked that a diagram usually hides: no asset may arrive readably at a
    party that must not learn it, and every asset in the brief has to appear somewhere —
    including one held by the very component that computes on it.
    """
    return {}


def attack_plan(brief: dict[str, Any], graph: dict[str, Any]) -> list[dict[str, Any]]:
    """At least five hypotheses about how this design fails.

    Each is {"id", "property", "hypothesis", "experiment"}, and the experiment is
    {"kind", "observable", "expected"}. `kind` says how it is attacked; `observable` says
    what you would see if it worked. An entry with nothing observable is a sentence.

    Every required property needs at least one. And every trust the architecture took on is
    itself an attack somebody can run — those are the ones a plan written from the happy
    path always misses.
    """
    return []


def property_matrix(brief: dict[str, Any], graph: dict[str, Any]) -> dict[str, dict[str, str]]:
    """One row per required property: what it protects, from whom, where, and how you know.

    Each row is {"asset", "adversary", "component", "evidence", "limitation"}. `component`
    names a node in your architecture, `evidence` names an entry in your attack plan, and
    `limitation` says what the property still rests on once the primitive has done its job.

    The row that is easiest to get wrong: a component can only be responsible for a property
    that one of its own options actually provides. Check `PRIMITIVES` before writing it down
    — several options are widely believed to provide things they list under `non_goals`.
    """
    return {}


def revise(brief: dict[str, Any]) -> dict[str, Any]:
    """The whole design again, for a brief whose facts have changed.

    Return {"required", "selection", "architecture", "matrix"}.

    Nothing new is asked for here. If the seven functions above read the brief, this one is
    four calls; if any of them decided something once, this is where it has to be decided
    again — for a brief you have not seen.
    """
    return {}
