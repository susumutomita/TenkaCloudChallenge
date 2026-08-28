"""Hidden tests. Run by /verify against a copy of the learner's prover.py.

Eight phases, graded separately, because the failures they catch are different failures. Each
stage is graded on its own output: `masks` is where `[d]` and `[e]` are checked against the
substitution, `product` is where `[C]` is checked against `A*B`, `open` is where the schedule
is measured. That split is deliberate rather than incidental, and it is what makes the last
one worth anything:

  * **the audit** (`check_audit`). A prover that opens `[A]` and `[B]` directly can compute
    `A*B` in the clear and hand back a sharing of it. `C` is correct at every seed and every
    shape, the round count is one, the triple was spent, and the whole witness-hiding property
    of the step is gone. `prove_product`'s contract is that `C` is right and the schedule is
    one round -- both of which that prover satisfies. What it does not satisfy is that the
    only values published were masked, and `openings()` is where that lives.
  * **the plan** (`check_plan`). Round count is the number everyone recites, so this phase
    never asks for it in the shape the recital fits: it plans layers of several widths, and a
    layer of no width at all.
  * **the open** (`check_open`). Two values in one round and two values in two rounds have
    identical output. The phase measures the runtime's round count rather than believing the
    report, and hands the report a runtime that has already opened something.

The discriminating scenarios are built out of real runtime state, never out of a wrapper that
lies: a pre-loaded opening really is in `openings()`, a spent triple really is in `consumed`,
and a forged triple really fails `z == x*y`.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fixtures.generate import (  # noqa: E402
    SHAPES,
    ParticipantRuntime,
    Runtime,
    Triple,
    field_id,
    linear_halves,
    relation,
    setting,
    witness,
)

LABELS = ("h0", "h1", "h2", "h3")

#: The keys a proof artifact is allowed to carry, and no others.
ARTIFACT_KEYS = {"relationId", "fieldId", "parties", "A", "B", "C", "tripleId", "roundId"}


# ---------------------------------------------------------------------------
# scenario construction
# ---------------------------------------------------------------------------


class _Scenario:
    """One setting, one witness, one relation, both linear halves, and a fresh triple.

    The halves are built by `linear_halves` **on this runtime**, so they carry a real
    ancestry: the masking check in `check_audit` walks back through them, and a fabricated
    `[A]` would make that check meaningless.
    """

    def __init__(self, seed: str, label: str, shape: str = "dense") -> None:
        self.seed = seed
        self.label = label
        self.cfg = setting(seed, label)
        self.witness = witness(seed, label, self.cfg)
        self.relation = dict(relation(seed, label, self.cfg, shape))
        self.runtime = Runtime(self.cfg)
        self.shares = self.runtime.deal_witness(seed, self.witness, label=f"{label}w")
        self.halves = linear_halves(self.runtime, self.relation, self.shares)
        self.triple = self.runtime.deal_triple(seed, f"{label}t")

    @property
    def participant(self) -> ParticipantRuntime:
        return ParticipantRuntime(self.runtime)

    @property
    def prime(self) -> int:
        return self.cfg["p"]

    def value_of_a(self) -> int:
        return self.runtime.reconstruct(self.halves["A"])

    def value_of_b(self) -> int:
        return self.runtime.reconstruct(self.halves["B"])

    def expected_product(self) -> int:
        return (self.value_of_a() * self.value_of_b()) % self.prime

    def spare_triple(self, tag: str = "spare"):
        return self.runtime.deal_triple(self.seed, f"{self.label}{tag}")

    def masked(self, triple=None) -> tuple[tuple, tuple]:
        """`[d]` and `[e]`, built checker-side so a later stage can be graded in isolation."""
        source = self.triple if triple is None else triple
        d_shares, e_shares = [], []
        for party in range(self.cfg["parties"]):
            with self.runtime.party_scope(party):
                d_shares.append(self.runtime.sub(self.halves["A"][party], source.x[party]))
                e_shares.append(self.runtime.sub(self.halves["B"][party], source.y[party]))
        return tuple(d_shares), tuple(e_shares)


def _valid_sharing(result: object, cfg: dict) -> bool:
    # A list is as good as a tuple. The lesson is which values end up where, not which
    # container they arrive in.
    if not isinstance(result, (list, tuple)) or len(result) != cfg["parties"]:
        return False
    for party, share in enumerate(result):
        if getattr(share, "party", None) != party:
            return False
        if getattr(share, "field", None) != cfg["fieldId"]:
            return False
        if not isinstance(getattr(share, "id", None), str):
            return False
    return True


def _refuses(call, what: str) -> list[str]:
    try:
        call()
    except Exception:  # noqa: BLE001 - any refusal is a refusal
        return []
    return [f"accepted {what}"]


def _attempt(call, what: str):
    """Call the submission where a raise is a failure rather than a refusal.

    Returns the result, or a string describing the failure. Without this a submission that
    raises inside a discriminating scenario would abort the phase -- which fails the
    checkpoint either way, but takes the rest of `check_transfer` down with it and reports
    a traceback instead of a sentence.
    """
    try:
        return call()
    except Exception as error:  # noqa: BLE001
        return f"{what} raised {type(error).__name__}"


# ---------------------------------------------------------------------------
# 1. the plan
# ---------------------------------------------------------------------------


LOCAL_OPERATIONS = ("add", "add-public", "mul-public", "sub")


def _plan_failures(module, scenario: _Scenario, products: int) -> list[str]:
    cfg = scenario.cfg
    try:
        plan = module.multiplication_plan(dict(scenario.relation), products)
    except Exception as error:  # noqa: BLE001
        return [f"multiplication_plan raised {type(error).__name__} on a valid layer"]
    if not isinstance(plan, dict):
        return ["multiplication_plan did not return a dict"]

    failures: list[str] = []
    for key, expected in (
        ("products", products),
        ("triples", products),
        ("opens", 2 * products),
        ("rounds", 1 if products else 0),
        ("messages", 2 * products * cfg["parties"]),
        ("fieldId", cfg["fieldId"]),
        ("relationId", scenario.relation["relationId"]),
    ):
        if plan.get(key) != expected:
            # Issue 630: this string can now travel to the participant, so it names the
            # field and echoes their own value, never the expected one.
            failures.append(
                f"the plan for a layer of {products} reported the wrong {key} "
                f"({plan.get(key)!r})"
            )
    local = plan.get("local")
    expected_local = LOCAL_OPERATIONS if products else ()
    if local is None or tuple(local) != expected_local:
        if local is not None and "open" in tuple(local):
            failures.append("the plan counts `open` among the local operations")
        else:
            # Issue 630: participant-visible now -- echo their answer, not the set the
            # starter asks them to read off the four terms of [C].
            failures.append(
                f"the plan named {local!r} as the local operations, and that is not what "
                "one multiplication needs"
            )
    return failures


def check_plan(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        for shape in ("dense", "sparse"):
            scenario = _Scenario(seed, label, shape)
            # A layer of one is what this problem computes. The others are what the claim
            # "one round for the whole layer" actually means, and a layer of none is where
            # a hard-coded 1 stops being right.
            for products in (1, 2, 5, 0, 3):
                failures.extend(_plan_failures(module, scenario, products))

    scenario = _Scenario(seed, LABELS[0])
    base = scenario.relation
    prime = scenario.prime
    malformed = [
        (({**base, "fieldId": field_id(prime + 1)}, 1), "a fieldId that does not name p"),
        (({**base, "parties": 1}, 1), "a single-party witness"),
        (({**base, "p": "97"}, 1), "a modulus that is not an integer"),
        (({**base, "parties": None}, 1), "a party count that is not an integer"),
        ((dict(base), -1), "a layer of negative width"),
        ((dict(base), "2"), "a layer width that is not an integer"),
    ]
    for (candidate, products), what in malformed:
        failures.extend(
            _refuses(lambda c=candidate, n=products: module.multiplication_plan(c, n), what)
        )
    return failures


# ---------------------------------------------------------------------------
# 2. the triple
# ---------------------------------------------------------------------------


def check_triple(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        scenario = _Scenario(seed, label)
        try:
            report = module.reserve_fresh_triple(
                scenario.participant, dict(scenario.relation), scenario.triple
            )
        except Exception as error:  # noqa: BLE001
            return [f"reserve_fresh_triple raised {type(error).__name__} on a fresh triple"]
        if not isinstance(report, dict):
            failures.append("reserve_fresh_triple did not return a dict")
            continue
        for key, expected in (
            ("tripleId", scenario.triple.id),
            ("fieldId", scenario.cfg["fieldId"]),
            ("parties", scenario.cfg["parties"]),
        ):
            if report.get(key) != expected:
                failures.append(f"reserve_fresh_triple reported the wrong {key}")
        consumed = report.get("consumed")
        if consumed is None or tuple(consumed) != (scenario.triple.id,):
            failures.append("reserve_fresh_triple did not report the triple as spent")
        if scenario.runtime.consumed != [scenario.triple.id]:
            failures.append("reserve_fresh_triple did not actually reserve the triple")

    # `consumed` is the runtime's ledger, not this call's receipt. A runtime that has already
    # spent one triple says so, and a report that names only its own does not read it.
    scenario = _Scenario(seed, LABELS[0])
    earlier = scenario.spare_triple("earlier")
    scenario.runtime.reserve_triple(earlier)
    report = _attempt(
        lambda s=scenario: module.reserve_fresh_triple(
            s.participant, dict(s.relation), s.triple
        ),
        "reserve_fresh_triple",
    )
    if isinstance(report, str):
        failures.append(report)
    elif not isinstance(report, dict) or tuple(report.get("consumed") or ()) != (
        earlier.id,
        scenario.triple.id,
    ):
        failures.append("reserve_fresh_triple reported its own triple instead of the ledger")

    # A mask is uniform exactly once. The runtime raises; a prover that swallows it hands the
    # same mask out twice and still produces a perfectly correct C.
    scenario = _Scenario(seed, LABELS[1])
    first = _attempt(
        lambda s=scenario: module.reserve_fresh_triple(
            s.participant, dict(s.relation), s.triple
        ),
        "reserve_fresh_triple",
    )
    if isinstance(first, str):
        failures.append(first)
    else:
        failures.extend(
            _refuses(
                lambda s=scenario: module.reserve_fresh_triple(
                    s.participant, dict(s.relation), s.triple
                ),
                "a triple that had already been spent",
            )
        )

    # A forged triple, and a triple shaped for another statement. The first the runtime
    # refuses; the last two only the relation can see, because the runtime never sees it.
    scenario = _Scenario(seed, LABELS[2])
    forged = scenario.runtime.forge_triple(seed, f"{LABELS[2]}forged")
    other_field = Triple(
        scenario.triple.id,
        field_id(scenario.prime + 1),
        scenario.triple.parties,
        scenario.triple.x,
        scenario.triple.y,
        scenario.triple.z,
    )
    tampered = [
        ((dict(scenario.relation), forged), "a triple whose z is not x*y"),
        ((dict(scenario.relation), other_field), "a triple drawn for another field"),
        (
            ({**scenario.relation, "fieldId": field_id(scenario.prime + 1)}, scenario.triple),
            "a triple whose field is not the relation's",
        ),
        (
            ({**scenario.relation, "parties": scenario.cfg["parties"] + 1}, scenario.triple),
            "a triple whose party count is not the relation's",
        ),
        ((dict(scenario.relation), "T-not-a-triple"), "something that is not a triple at all"),
    ]
    for (row, candidate), what in tampered:
        fresh = _Scenario(seed, LABELS[2])
        failures.extend(
            _refuses(
                lambda r=row, c=candidate, s=fresh: module.reserve_fresh_triple(
                    s.participant, r, c
                ),
                what,
            )
        )
    return failures


# ---------------------------------------------------------------------------
# 3. the masks
# ---------------------------------------------------------------------------


def check_masks(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        for shape in ("dense", "signed"):
            scenario = _Scenario(seed, label, shape)
            runtime, cfg, prime = scenario.runtime, scenario.cfg, scenario.prime
            runtime.reserve_triple(scenario.triple)
            openings_before = len(runtime.opened)
            try:
                masked = module.masked_operands(
                    scenario.participant, scenario.triple, scenario.halves
                )
            except Exception as error:  # noqa: BLE001
                return [f"masked_operands raised {type(error).__name__}"]
            if not isinstance(masked, dict) or "d" not in masked or "e" not in masked:
                failures.append("masked_operands did not return both masked sharings")
                continue
            if not _valid_sharing(masked["d"], cfg) or not _valid_sharing(masked["e"], cfg):
                failures.append("masked_operands did not return one stamped share per party")
                continue

            expected_d = (scenario.value_of_a() - runtime.reconstruct(scenario.triple.x)) % prime
            expected_e = (scenario.value_of_b() - runtime.reconstruct(scenario.triple.y)) % prime
            actual_d = runtime.reconstruct(masked["d"])
            actual_e = runtime.reconstruct(masked["e"])
            if actual_d == expected_e and actual_e == expected_d and expected_d != expected_e:
                failures.append("masked_operands returned d and e the wrong way round")
            else:
                if actual_d != expected_d:
                    if actual_d == (-expected_d) % prime and expected_d:
                        failures.append("masked_operands computed [x] - [A] rather than [A] - [x]")
                    else:
                        failures.append("[d] does not reconstruct to A - x")
                if actual_e != expected_e:
                    failures.append("[e] does not reconstruct to B - y")

            if len(runtime.opened) != openings_before:
                failures.append("masked_operands opened something; masking is local")
            if runtime.violations:
                failures.append(
                    f"masked_operands triggered a runtime violation: {runtime.violations[0]['kind']}"
                )

            # The mask has to be in the sharing's ancestry, or the opening that follows is
            # hiding nothing. A [d] assembled some other way can still hold the right value.
            for party in range(cfg["parties"]):
                ancestry = runtime.ancestry(masked["d"][party])
                if scenario.triple.x[party].id not in ancestry:
                    failures.append("[d] does not descend from the triple's x share")
                    break
    return failures


# ---------------------------------------------------------------------------
# 4. the round
# ---------------------------------------------------------------------------


def _open_failures(module, scenario: _Scenario, preloaded: int) -> list[str]:
    runtime = scenario.runtime
    runtime.reserve_triple(scenario.triple)
    d_sharing, e_sharing = scenario.masked()

    for index in range(preloaded):
        # A real opening under its own round id, before the participant is called. Nothing is
        # faked: `openings()` really holds it and it really is a distinct round.
        runtime.open(f"earlier-{index}", scenario.halves["A"])

    rounds_before = runtime.rounds()
    try:
        report = module.open_masks(scenario.participant, "one-round", {"d": d_sharing, "e": e_sharing})
    except Exception as error:  # noqa: BLE001
        return [f"open_masks raised {type(error).__name__}"]
    if not isinstance(report, dict):
        return ["open_masks did not return a dict"]

    failures: list[str] = []
    expected_d = runtime.reconstruct(d_sharing)
    expected_e = runtime.reconstruct(e_sharing)
    if report.get("d") != expected_d:
        failures.append("open_masks did not return the opened value of [d]")
    if report.get("e") != expected_e:
        failures.append("open_masks did not return the opened value of [e]")
    if report.get("roundId") != "one-round":
        failures.append("open_masks did not report the round id it was given")

    # The protocol property, measured on the runtime rather than read off the report: both
    # values went out together, so the participant added exactly one round to whatever was
    # already there.
    if runtime.rounds() != rounds_before + 1:
        failures.append(
            f"opening d and e cost {runtime.rounds() - rounds_before} rounds, not one"
        )
    if len(runtime.opened) != preloaded + 2:
        failures.append("open_masks did not open exactly the two masked sharings")

    if report.get("openings") != len(runtime.opened):
        failures.append(
            f"open_masks reported {report.get('openings')!r} openings, the runtime holds "
            f"{len(runtime.opened)}"
        )
    if report.get("rounds") != runtime.rounds():
        failures.append(
            f"open_masks reported {report.get('rounds')!r} rounds, the runtime holds "
            f"{runtime.rounds()}"
        )
    return failures


def check_open(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        failures.extend(_open_failures(module, _Scenario(seed, label), 0))
    # A runtime that has already opened something. `openings` and `rounds` are the runtime's
    # totals, not this call's, and a report that returns 2 and 1 from memory fails here.
    failures.extend(_open_failures(module, _Scenario(seed, LABELS[0]), 1))
    failures.extend(_open_failures(module, _Scenario(seed, LABELS[1]), 2))
    return failures


# ---------------------------------------------------------------------------
# 5. the product
# ---------------------------------------------------------------------------


def _product_failures(module, scenario: _Scenario) -> tuple[list[str], int]:
    """Grade `shared_product` in isolation. Returns the failures and this scenario's d*e."""
    runtime, prime = scenario.runtime, scenario.prime
    runtime.reserve_triple(scenario.triple)
    d_sharing, e_sharing = scenario.masked()
    d = runtime.open("checker", d_sharing)
    e = runtime.open("checker", e_sharing)

    try:
        product = module.shared_product(scenario.participant, scenario.triple, d, e)
    except Exception as error:  # noqa: BLE001
        return [f"shared_product raised {type(error).__name__}"], 0
    if not _valid_sharing(product, scenario.cfg):
        return ["shared_product did not return one stamped share per party"], 0

    failures: list[str] = []
    actual = runtime.reconstruct(product)
    expected = scenario.expected_product()
    if actual != expected:
        parties = scenario.cfg["parties"]
        if actual == (expected + (parties - 1) * d * e) % prime and (d * e) % prime:
            failures.append("every party folded the public d*e into its own share")
        elif actual == (expected - d * e) % prime and (d * e) % prime:
            failures.append("the public d*e term is missing from [C]")
        else:
            failures.append("[C] does not reconstruct to A * B")
    if runtime.violations:
        failures.append(
            f"shared_product triggered a runtime violation: {runtime.violations[0]['kind']}"
        )
    return failures, (d * e) % prime


def _step_failures(module, scenario: _Scenario, preloaded: int) -> list[str]:
    """Grade `prove_product` end to end. `preloaded` openings happen before it is called."""
    runtime, cfg = scenario.runtime, scenario.cfg
    for index in range(preloaded):
        runtime.open(f"earlier-{index}", scenario.halves["A"])
    rounds_before = runtime.rounds()

    try:
        proof = module.prove_product(
            scenario.participant, dict(scenario.relation), scenario.halves, scenario.triple
        )
    except Exception as error:  # noqa: BLE001
        return [f"prove_product raised {type(error).__name__}"]
    if not isinstance(proof, dict):
        return ["prove_product did not return a dict"]
    missing = {"A", "B", "C", "d", "e", "tripleId", "roundId", "rounds"} - set(proof)
    if missing:
        return [f"prove_product did not report {sorted(missing)}"]
    if not _valid_sharing(proof["C"], cfg):
        return ["prove_product's C is not one stamped share per party"]

    failures: list[str] = []
    if runtime.reconstruct(proof["C"]) != scenario.expected_product():
        failures.append("prove_product's C does not reconstruct to A * B")
    for name in ("A", "B"):
        handed = tuple(share.id for share in scenario.halves[name])
        returned = proof[name]
        if not _valid_sharing(returned, cfg) or tuple(share.id for share in returned) != handed:
            failures.append(f"prove_product did not pass {name} through unchanged")
    if proof["tripleId"] != scenario.triple.id:
        failures.append("prove_product did not report the triple it spent")
    if runtime.consumed != [scenario.triple.id]:
        failures.append("prove_product did not spend exactly one triple")
    if runtime.rounds() != rounds_before + 1:
        failures.append(
            f"the whole step cost {runtime.rounds() - rounds_before} rounds of communication, "
            "not one"
        )
    if proof["rounds"] != runtime.rounds():
        failures.append(
            f"prove_product reported {proof['rounds']!r} rounds, the runtime holds "
            f"{runtime.rounds()}"
        )
    round_id = proof["roundId"]
    if not isinstance(round_id, str) or scenario.relation["relationId"] not in round_id:
        failures.append("prove_product's round id does not name the relation")
    return failures


def check_product(module, seed: str) -> list[str]:
    failures: list[str] = []
    nonzero_de = 0
    for label in LABELS:
        for shape in ("dense", "sparse"):
            scenario = _Scenario(seed, label, shape)
            stage, de = _product_failures(module, scenario)
            failures.extend(stage)
            nonzero_de += 1 if de else 0
    if not failures and not nonzero_de:
        # Every scenario had d*e == 0, so the fold-into-every-party defect could not have
        # shown up in any of them. That is a broken phase, not a passing submission -- and
        # it is only worth saying when nothing else failed, since a submission that raised
        # on all eight scenarios reports no d*e for a reason it already knows about.
        failures.append("no scenario in this phase had a non-zero d*e term")

    # The whole step, wired together.
    for label in LABELS:
        for shape in ("dense", "unit"):
            failures.extend(_step_failures(module, _Scenario(seed, label, shape), 0))
    # The same step on a runtime that has already opened something. `rounds` is the runtime's
    # total, so a step that reports a constant 1 is right only by coincidence until now.
    failures.extend(_step_failures(module, _Scenario(seed, LABELS[0]), 1))

    # Two rows are two statements. Batching is per layer, and a constant round id would put
    # openings from unrelated rows in the same round.
    first = _Scenario(seed, LABELS[0], "dense")
    second = _Scenario(seed, LABELS[1], "sparse")
    ids = []
    for scenario in (first, second):
        proof = _attempt(
            lambda s=scenario: module.prove_product(
                s.participant, dict(s.relation), s.halves, s.triple
            ),
            "prove_product",
        )
        if isinstance(proof, str):
            return [*failures, proof]
        ids.append(proof.get("roundId") if isinstance(proof, dict) else None)
    if ids[0] == ids[1]:
        failures.append("prove_product used the same round id for two different relations")
    return failures


# ---------------------------------------------------------------------------
# 6. the artifact
# ---------------------------------------------------------------------------


def check_artifact(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        for shape in SHAPES:
            scenario = _Scenario(seed, label, shape)
            cfg = scenario.cfg
            try:
                artifact = module.proof_artifact(
                    scenario.participant,
                    dict(scenario.relation),
                    scenario.halves,
                    scenario.triple,
                )
            except Exception as error:  # noqa: BLE001
                return [f"proof_artifact raised {type(error).__name__}"]
            if not isinstance(artifact, dict):
                failures.append("proof_artifact did not return a dict")
                continue
            if set(artifact) != ARTIFACT_KEYS:
                extra = sorted(set(artifact) - ARTIFACT_KEYS)
                absent = sorted(ARTIFACT_KEYS - set(artifact))
                if extra:
                    failures.append(f"the artifact carries {extra}, which is not part of it")
                if absent:
                    failures.append(f"the artifact is missing {absent}")
                continue

            for name in ("A", "B", "C"):
                if not _valid_sharing(artifact[name], cfg):
                    if isinstance(artifact[name], int):
                        failures.append(
                            f"the artifact holds {name} as a reconstructed value, not a sharing"
                        )
                    else:
                        failures.append(f"the artifact's {name} is not a sharing")
            if any(not _valid_sharing(artifact[name], cfg) for name in ("A", "B", "C")):
                continue
            if scenario.runtime.reconstruct(artifact["C"]) != scenario.expected_product():
                failures.append("the artifact's C does not reconstruct to A * B")
            for key, expected in (
                ("relationId", scenario.relation["relationId"]),
                ("fieldId", cfg["fieldId"]),
                ("parties", cfg["parties"]),
                ("tripleId", scenario.triple.id),
            ):
                if artifact.get(key) != expected:
                    failures.append(f"the artifact's {key} is not the one it was built from")
            if not isinstance(artifact.get("roundId"), str) or not artifact["roundId"]:
                failures.append("the artifact does not name the round its openings went out in")

    # A relation the artifact has to read rather than reconstruct: a C labelled with the wrong
    # statement is a valid proof of something nobody claimed.
    scenario = _Scenario(seed, LABELS[0])
    renamed = {**scenario.relation, "relationId": "R-some-other-row"}
    artifact = _attempt(
        lambda s=scenario: module.proof_artifact(
            s.participant, renamed, s.halves, s.triple
        ),
        "proof_artifact",
    )
    if isinstance(artifact, str):
        failures.append(artifact)
    elif not isinstance(artifact, dict) or artifact.get("relationId") != "R-some-other-row":
        failures.append("the artifact did not label itself with the relation it was given")
    return failures


# ---------------------------------------------------------------------------
# 7. the audit
# ---------------------------------------------------------------------------


class _OpenRuntime(ParticipantRuntime):
    """A participant runtime that does hand out `reconstruct`. Reporting otherwise is a guess."""

    def reconstruct(self, shares) -> int:
        return self._runtime.reconstruct(shares)


def _audit(module, scenario: _Scenario, facade=None) -> dict | str:
    participant = facade if facade is not None else scenario.participant
    try:
        report = module.privacy_audit(
            participant, dict(scenario.relation), scenario.halves, scenario.triple
        )
    except Exception as error:  # noqa: BLE001
        return f"privacy_audit raised {type(error).__name__}"
    if not isinstance(report, dict):
        return "privacy_audit did not return a dict"
    return report


def check_audit(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        for shape in ("dense", "signed"):
            scenario = _Scenario(seed, label, shape)
            report = _audit(module, scenario)
            if isinstance(report, str):
                return [report]
            for key, expected in (
                ("opened", 2),
                ("rounds", 1),
                ("unmasked", 0),
                ("violations", 0),
                ("triplesConsumed", (scenario.triple.id,)),
                ("reconstructAvailable", False),
            ):
                actual = report.get(key)
                if key == "triplesConsumed":
                    actual = tuple(actual) if actual is not None else None
                if actual != expected:
                    failures.append(f"the audit reported {key}={actual!r} on an honest run")

    # An opening nothing was hiding. It really is in `openings()` with an empty `maskedBy`,
    # and the runtime really recorded the violation.
    scenario = _Scenario(seed, LABELS[0])
    scenario.runtime.open("in-the-clear", scenario.halves["A"])
    report = _audit(module, scenario)
    if isinstance(report, str):
        return [*failures, report]
    if report.get("unmasked") != 1:
        failures.append(
            f"the audit reported unmasked={report.get('unmasked')!r} with a raw opening in the log"
        )
    if report.get("opened") != 3 or report.get("rounds") != 2:
        failures.append("the audit did not count an opening that happened before it ran")
    if report.get("violations") != 1:
        failures.append("the audit did not count the runtime's recorded violations")

    # A triple spent before the step. `triplesConsumed` is the ledger, in order.
    scenario = _Scenario(seed, LABELS[1])
    earlier = scenario.spare_triple("earlier")
    scenario.runtime.reserve_triple(earlier)
    report = _audit(module, scenario)
    if isinstance(report, str):
        return [*failures, report]
    if tuple(report.get("triplesConsumed") or ()) != (earlier.id, scenario.triple.id):
        failures.append("the audit did not report every triple the runtime has spent")

    # A runtime that does offer `reconstruct`.
    scenario = _Scenario(seed, LABELS[2])
    report = _audit(module, scenario, facade=_OpenRuntime(scenario.runtime))
    if isinstance(report, str):
        return [*failures, report]
    if report.get("reconstructAvailable") is not True:
        failures.append("the audit did not notice a runtime that offers reconstruct")
    return failures


# ---------------------------------------------------------------------------
# 8. a setting nothing above has seen
# ---------------------------------------------------------------------------


def check_transfer(module, seed: str) -> list[str]:
    transferred = f"{seed}:transfer"
    return [
        *check_plan(module, transferred),
        *check_triple(module, transferred),
        *check_masks(module, transferred),
        *check_open(module, transferred),
        *check_product(module, transferred),
        *check_artifact(module, transferred),
        *check_audit(module, transferred),
    ]


PHASES = (
    check_plan,
    check_triple,
    check_masks,
    check_open,
    check_product,
    check_artifact,
    check_audit,
    check_transfer,
)


def run(module, seed: str) -> list[str]:
    failures: list[str] = []
    for phase in PHASES:
        failures.extend(phase(module, seed))
    return failures
