"""What `check` and `repair` actually decide, and why.

Two judgements, both structural rather than a comparison against a stored answer.
That is what lets the same code grade either of the two possible drops, and what
stops a memorised witness from carrying between deployments.

`check` -- a forged witness has to do two things at once:

  1. satisfy the DEPLOYED circuit, so production would have accepted it, and
  2. carry a claim the written policy calls false: the `granted` it asserts differs
     from what the policy says about that credential.

(2) is the part that is easy to leave out, and leaving it out makes the checkpoint
gradeable by accident. With `c-iszero-a` dropped, an honest witness with a garbage
`inv` already satisfies the deployed circuit and fails the intended one -- and
asserts nothing false whatsoever. Requiring the claim to be false is what separates
"found a witness the intended circuit rejects" from "got a lie accepted".

`repair` -- the added constraint has to make the deployed circuit agree with the
policy again, and nothing more:

  1. exactly one constraint, because exactly one is missing. Adding the whole gadget
     back on top of the half that is already there is not a repair, it is a rewrite.
  2. both honest witnesses still accepted. A repair that denies a legitimate holder
     is an outage.
  3. the repaired circuit accepts exactly the witnesses the intended circuit accepts,
     over a family of witnesses built around this deployment's parameters.

(3) is checked over a *structured* family, not uniform random draws. The intended
circuit's solution set is about 4p points out of p**5, so uniform sampling would
compare `False == False` every time and pass almost any wrong repair. The family
below crosses the values that actually distinguish: 0 and non-zero revocation
counters, the true inverse and wrong ones, `ok` outside {0, 1}, and several
different `revoked` values so a repair with this deployment's counter hard-coded
into it fails.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fixtures.evaluator import residual, satisfies, unsatisfied
from fixtures.generate import (
    SIGNALS,
    deployed_circuit,
    honest_witnesses,
    intended_circuit,
    params,
    policy_verdict,
)
from lab.expr import ExpressionError, compile_expression, split_expressions

#: A repair adds back what was removed. Exactly one constraint was removed.
MAX_ADDED_CONSTRAINTS = 1


@dataclass
class Verdict:
    """A pass/fail plus the lines the CLI prints. Never carries the answer."""

    passed: bool
    lines: list[str] = field(default_factory=list)

    def say(self, line: str = "") -> "Verdict":
        self.lines.append(line)
        return self


def parse_witness(arguments: list[str], p: int) -> dict[str, int]:
    """`revoked=58 inv=0 ok=1 issuer_ok=1 granted=1` -> a witness, or ValueError."""
    values: dict[str, int] = {}
    for piece in split_expressions(arguments):
        if "=" not in piece:
            raise ValueError(f"{piece!r} is not name=value")
        name, _, raw = piece.partition("=")
        name = name.strip()
        if name not in SIGNALS:
            raise ValueError(f"unknown signal {name!r}; the signals are " + ", ".join(SIGNALS))
        if name in values:
            raise ValueError(f"{name} is given twice")
        try:
            values[name] = int(raw.strip()) % p
        except ValueError:
            raise ValueError(f"{raw.strip()!r} is not an integer") from None
    missing = [name for name in SIGNALS if name not in values]
    if missing:
        raise ValueError("no value for " + ", ".join(missing))
    return values


def witness_family(prm: dict[str, int]) -> list[dict[str, int]]:
    """Witnesses that distinguish a correct repair from a plausible wrong one.

    Built by hand rather than sampled, for the reason in this module's docstring.
    Small enough (a few thousand points) to evaluate in well under a second.
    """
    p = prm["p"]
    r = prm["revoked"] % p
    revocations = sorted({0, 1, 2, r, (r + 1) % p, p - 1})
    inverses = {0, 1, pow(r, -1, p)}
    oks = (0, 1, 2)
    issuers = (0, 1)
    grants = {0, 1}

    family: list[dict[str, int]] = []
    for revoked in revocations:
        # The true inverse of *this* revoked value belongs in the family too, or the
        # honest witness for every counter except the deployment's own is missing --
        # and a repair with the deployment's counter written into it would survive.
        local_inverses = sorted(inverses | ({pow(revoked, -1, p)} if revoked else set()))
        for inv in local_inverses:
            for ok in oks:
                for issuer_ok in issuers:
                    for granted in sorted(grants | {(ok * issuer_ok) % p}):
                        family.append(
                            {
                                "revoked": revoked,
                                "inv": inv,
                                "ok": ok,
                                "issuer_ok": issuer_ok,
                                "granted": granted,
                            }
                        )
    return family


def check_witness(seed: str, arguments: list[str]) -> Verdict:
    """Grade a forged witness. See this module's docstring for the two requirements."""
    prm = params(seed)
    p = prm["p"]
    deployed = deployed_circuit(seed)
    verdict = Verdict(passed=False)

    try:
        witness = parse_witness(arguments, p)
    except ValueError as error:
        return verdict.say(f"that is not a witness: {error}").say().say(
            "  a witness names every signal once, for example:"
        ).say(f"  circuit check revoked={prm['revoked']} inv=0 ok=0 issuer_ok=1 granted=0")

    verdict.say(f"witness (mod p = {p}):")
    for name in SIGNALS:
        verdict.say(f"  {name:<10} = {witness[name]}")
    verdict.say()

    verdict.say("residuals of the deployed circuit:")
    for constraint in deployed:
        verdict.say(f"  {str(constraint['id']):<14} {residual(constraint, witness, p)}")
    verdict.say()

    failing = unsatisfied(deployed, witness, p)
    if failing:
        return verdict.say(
            "REJECTED: production would not have accepted this witness. "
            + ("these constraints are not zero: " + ", ".join(failing))
        ).say().say(
            "  a forgery has to get *through* the deployed circuit. Every residual above "
            "must be 0."
        )

    claimed = witness["granted"]
    truth = policy_verdict(prm, witness["revoked"], witness["issuer_ok"])
    if claimed == truth:
        return verdict.say(
            "REJECTED: the deployed circuit accepts this witness, but so does the policy."
        ).say(
            f"  the policy says this credential's `granted` is {truth}, and the witness "
            f"asserts {claimed}."
        ).say().say(
            "  nothing false is being claimed here, so nothing has been exploited. "
            "A forgery has to assert something the policy denies."
        )

    if satisfies(intended_circuit(), witness, p):
        # Unreachable while the intended circuit is sound; kept because the day it
        # is reachable is the day the intended circuit is the thing that is broken.
        return verdict.say(
            "REJECTED: the circuit the policy intends accepts this witness too."
        )

    verdict.passed = True
    return verdict.say("ACCEPTED: this is a forged witness.").say().say(
        f"  the deployed circuit is satisfied, so production would have honoured it, "
        f"and it asserts granted = {claimed} where the policy says {truth}."
    ).say(
        "  the constraint that would have stopped it is not in the deployed circuit. "
        "Put it back: `circuit repair \"<expression>\"`."
    )


def check_repair(seed: str, arguments: list[str]) -> Verdict:
    """Grade a proposed repair. See this module's docstring for the three requirements."""
    prm = params(seed)
    p = prm["p"]
    deployed = deployed_circuit(seed)
    intended = intended_circuit()
    verdict = Verdict(passed=False)

    sources = split_expressions(arguments)
    if not sources:
        return verdict.say(
            "no constraint given. A repair is the residual that must come out zero. "
            "The syntax, using a constraint the circuit already has: "
            'circuit repair "ok*issuer_ok - granted"'
        )
    if len(sources) > MAX_ADDED_CONSTRAINTS:
        return verdict.say(
            f"REJECTED: {len(sources)} constraints given, and a minimal repair here adds "
            f"{MAX_ADDED_CONSTRAINTS}."
        ).say().say(
            "  exactly one constraint was removed from the deployed circuit. Adding more "
            "than that is a rewrite, and every extra constraint is another way to deny an "
            "honest holder."
        )

    added: list[dict] = []
    for index, source in enumerate(sources):
        try:
            evaluate = compile_expression(source, SIGNALS)
        except ExpressionError as error:
            return verdict.say(f"that is not an expression: {error}").say().say(
                "  signals: " + ", ".join(SIGNALS)
            ).say("  operators: + - * ( ) and an optional = ; integers are literals")
        added.append({"id": f"c-repair-{index + 1}", "kind": "expr", "evaluate": evaluate})

    repaired = [*deployed, *added]

    for source in sources:
        verdict.say(f"added constraint: {source}  = 0")
    verdict.say()

    for label, witness in zip(("revoked holder", "clean holder"), honest_witnesses(prm)):
        if not satisfies(repaired, witness, p):
            return verdict.say(
                f"REJECTED: the repaired circuit no longer accepts the honest {label}."
            ).say(f"  {_render(witness)}").say().say(
                "  a repair that denies a legitimate holder is an outage. Both honest "
                "witnesses from `circuit show` have to stay accepted."
            )

    accepted_by_intended = 0
    too_weak = 0
    too_strict: dict[str, int] | None = None
    for witness in witness_family(prm):
        by_intended = satisfies(intended, witness, p)
        by_repaired = satisfies(repaired, witness, p)
        accepted_by_intended += int(by_intended)
        if by_repaired and not by_intended:
            too_weak += 1
        elif by_intended and not by_repaired and too_strict is None:
            too_strict = witness

    if accepted_by_intended == 0:
        # A family that contains no satisfying assignment would make the comparison
        # below vacuously true and pass everything. Fail closed and loudly.
        raise AssertionError("the witness family contains nothing the policy accepts")

    if too_strict is not None:
        return verdict.say(
            "REJECTED: the repaired circuit is stricter than the policy."
        ).say(f"  it rejects this witness, which the policy allows: {_render(too_strict)}").say().say(
            "  the constraint you added rules out more than the missing one did."
        )

    if too_weak:
        return verdict.say(
            "REJECTED: the repaired circuit still accepts witnesses the policy calls false."
        ).say().say(
            "  the constraint you added is not the one that was removed -- it is satisfied "
            "by the same lies the deployed circuit already was. Which residual is zero for "
            "every lie you can get through `check`?"
        )

    verdict.passed = True
    return verdict.say("ACCEPTED: the repaired circuit matches the policy.").say().say(
        "  both honest holders are still accepted, and every witness that the policy "
        "calls false is now rejected."
    ).say("  run `circuit flag` for your flag.")


def _render(witness: dict[str, int]) -> str:
    return " ".join(f"{name}={witness[name]}" for name in SIGNALS)
