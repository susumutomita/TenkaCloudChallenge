"""Hidden tests. Run by /verify against a copy of the learner's prover.py.

Eight phases, graded separately, because the failures they catch are different failures.
Three of them cannot be reached by looking at `A` and `B` at all:

  * **the parser** (`check_relation`). A coefficient left as `-3` instead of `94` still
    produces the right `A`, because every arithmetic step reduces mod p anyway. What it does
    not produce is a canonical relation, and two provers comparing what they are proving
    compare that.
  * **the audit** (`check_audit`). A prover that assembles the witness, does the arithmetic
    in the clear and re-shares the answer reconstructs correctly on every shape, every seed
    and every parameter set. Nothing about the *values* can see it. `issued` and `ancestry`
    can.
  * **the trace** (`check_trace`). "Zero rounds" is the answer, and every learner knows it
    before they write a line -- which is exactly why a report that asserts it is worth no
    points. Each scenario here hands the report a log that says something else.

The discriminating scenarios are built out of real runtime state, never out of a wrapper that
lies: a poisoned log really holds a communication event, a leaky log really names a foreign
operand, and a ghost share really was never emitted. An implementation that derives its answer
from `events()` by hand instead of from `ancestry()` / `issued()` gets the same result.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fixtures.generate import (  # noqa: E402
    SHAPES,
    ParticipantRuntime,
    Runtime,
    Share,
    dot,
    field_id,
    relation,
    setting,
    witness,
)

LABELS = ("h0", "h1", "h2", "h3")


# ---------------------------------------------------------------------------
# scenario construction
# ---------------------------------------------------------------------------


class _Scenario:
    """One setting, one witness, one sharing of it, one relation. Fresh runtime each time."""

    def __init__(self, seed: str, label: str, shape: str = "dense", share_salt: str = "") -> None:
        self.seed = seed
        self.label = label
        self.cfg = setting(seed, label)
        self.witness = witness(seed, label, self.cfg)
        self.relation = dict(relation(seed, label, self.cfg, shape))
        self.share_salt = share_salt
        self.runtime = Runtime(self.cfg)
        self.shares = self.runtime.deal_witness(
            f"{seed}{share_salt}", self.witness, label=f"{label}{share_salt}w"
        )

    @property
    def participant(self) -> ParticipantRuntime:
        return ParticipantRuntime(self.runtime)

    def canonical(self) -> dict:
        prime = self.cfg["p"]
        return {
            "a": tuple(c % prime for c in self.relation["a"]),
            "b": tuple(c % prime for c in self.relation["b"]),
            "p": prime,
            "width": self.cfg["width"],
            "parties": self.cfg["parties"],
            "fieldId": self.cfg["fieldId"],
        }

    def separate_halves(self) -> None:
        """Make `dot(a, w)` and `dot(b, w)` differ, so swapping the vectors is visible."""
        prime = self.cfg["p"]
        if dot(self.relation["a"], self.witness, prime) != dot(
            self.relation["b"], self.witness, prime
        ):
            return
        index = next((j for j, value in enumerate(self.witness) if value % prime), None)
        if index is None:
            return  # every witness element is zero; both halves are 0 whatever the row says
        bumped = list(self.relation["b"])
        bumped[index] += 1
        self.relation["b"] = tuple(bumped)


def _valid_sharing(result: object, cfg: dict) -> bool:
    # A list is as good as a tuple here. The lesson is which values end up where, not which
    # container they arrive in, and failing a learner over that teaches nothing.
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


def _rejects(module, relation_value: dict, what: str) -> list[str]:
    try:
        module.parse_relation(relation_value)
    except Exception:  # noqa: BLE001 - any refusal is a refusal
        return []
    return [f"parse_relation accepted {what}"]


# ---------------------------------------------------------------------------
# 1. the relation
# ---------------------------------------------------------------------------


def check_relation(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        for shape in SHAPES:
            scenario = _Scenario(seed, label, shape)
            expected = scenario.canonical()
            try:
                parsed = module.parse_relation(dict(scenario.relation))
            except Exception as error:  # noqa: BLE001
                return [f"parse_relation raised {type(error).__name__} on a valid relation"]
            if not isinstance(parsed, dict):
                failures.append("parse_relation did not return a dict")
                continue
            for key in ("p", "width", "parties", "fieldId"):
                if parsed.get(key) != expected[key]:
                    failures.append(f"parse_relation changed {key}")
            for name in ("a", "b"):
                vector = parsed.get(name)
                if not isinstance(vector, (list, tuple)) or len(vector) != expected["width"]:
                    failures.append(f"parse_relation did not return {name} at the declared width")
                    continue
                if any(isinstance(c, bool) or not isinstance(c, int) for c in vector):
                    failures.append(f"parse_relation returned a non-integer in {name}")
                    continue
                if tuple(vector) != expected[name]:
                    if tuple(c % expected["p"] for c in vector) == expected[name]:
                        failures.append(
                            f"parse_relation left {name} outside the field's canonical range"
                        )
                    else:
                        failures.append(f"parse_relation returned the wrong {name}")

    scenario = _Scenario(seed, LABELS[0])
    base = scenario.relation
    prime = scenario.cfg["p"]
    malformed = [
        ({**base, "a": tuple(base["a"])[:-1]}, "a coefficient vector shorter than width"),
        ({**base, "b": (*tuple(base["b"]), 1)}, "a coefficient vector longer than width"),
        ({**base, "fieldId": field_id(prime + 1)}, "a fieldId that does not name p"),
        ({**base, "width": 0}, "a width of zero"),
        ({**base, "parties": 1}, "a single-party witness"),
        ({**base, "a": ("3", *tuple(base["a"])[1:])}, "a coefficient that is not an integer"),
        ({**base, "p": "97"}, "a modulus that is not an integer"),
        ({**base, "a": None}, "a coefficient vector that is not a sequence"),
    ]
    for candidate, what in malformed:
        failures.extend(_rejects(module, candidate, what))
    return failures


# ---------------------------------------------------------------------------
# 2. the shared witness
# ---------------------------------------------------------------------------


def check_witness(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        scenario = _Scenario(seed, label)
        cfg, runtime = scenario.cfg, scenario.runtime
        reads_before, events_before = runtime.reads, len(runtime.events)
        try:
            summary = module.validate_shared_witness(
                scenario.participant, scenario.canonical(), scenario.shares
            )
        except Exception as error:  # noqa: BLE001
            return [f"validate_shared_witness raised {type(error).__name__} on a valid witness"]
        if not isinstance(summary, dict):
            failures.append("validate_shared_witness did not return a dict")
            continue
        for key, expected in (
            ("width", cfg["width"]),
            ("parties", cfg["parties"]),
            ("fieldId", cfg["fieldId"]),
        ):
            if summary.get(key) != expected:
                failures.append(f"validate_shared_witness reported the wrong {key}")
        expected_ids = tuple(tuple(share.id for share in sharing) for sharing in scenario.shares)
        reported = summary.get("shareIds")
        if reported is None or tuple(tuple(row) for row in reported) != expected_ids:
            failures.append("validate_shared_witness did not report the share ids in order")
        if runtime.reads != reads_before:
            failures.append("validate_shared_witness read share values to check labels")
        if len(runtime.events) != events_before:
            failures.append("validate_shared_witness performed operations while validating")

    scenario = _Scenario(seed, LABELS[1])
    cfg, canonical, shares = scenario.cfg, scenario.canonical(), scenario.shares
    swapped = list(shares[0])
    swapped[0], swapped[1] = swapped[1], swapped[0]
    foreign = tuple(
        Share(share.party, "F2", f"foreign-{share.id}", 0) for share in shares[0]
    )
    tampered = [
        (shares[:-1], "a witness shorter than the relation's width"),
        (
            (tuple(shares[0])[:-1], *shares[1:]),
            "a sharing missing a party",
        ),
        ((tuple(swapped), *shares[1:]), "a sharing whose parties are out of order"),
        ((foreign, *shares[1:]), "a sharing in another field"),
        ((shares[0], shares[0], *shares[2:]), "the same sharing at two witness positions"),
    ]
    for candidate, what in tampered:
        runtime = Runtime(cfg)
        try:
            module.validate_shared_witness(ParticipantRuntime(runtime), canonical, candidate)
        except Exception:  # noqa: BLE001 - any refusal is a refusal
            continue
        failures.append(f"validate_shared_witness accepted {what}")
    return failures


# ---------------------------------------------------------------------------
# 3. the linear combination
# ---------------------------------------------------------------------------


def _combination_failures(module, scenario: _Scenario, vector, expected: int) -> list[str]:
    runtime = scenario.runtime
    try:
        result = module.shared_linear_combination(scenario.participant, vector, scenario.shares)
    except Exception as error:  # noqa: BLE001
        return [f"shared_linear_combination raised {type(error).__name__}"]
    if not _valid_sharing(result, scenario.cfg):
        return ["shared_linear_combination did not return one stamped share per party"]
    if runtime.reconstruct(result) != expected:
        return ["the shared linear combination does not reconstruct to the plain dot product"]
    if runtime.violations:
        return [f"the combination triggered a runtime violation: {runtime.violations[0]['kind']}"]
    return []


def check_combine_a(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        for shape in ("dense", "unit"):
            scenario = _Scenario(seed, label, shape)
            canonical = scenario.canonical()
            failures.extend(
                _combination_failures(
                    module,
                    scenario,
                    canonical["a"],
                    dot(canonical["a"], scenario.witness, scenario.cfg["p"]),
                )
            )
    # A vector of zeros is a relation row that ignores the witness, not a reason to return
    # nothing: the result is still a sharing, of zero.
    scenario = _Scenario(seed, LABELS[0])
    failures.extend(
        _combination_failures(module, scenario, (0,) * scenario.cfg["width"], 0)
    )
    return failures


# ---------------------------------------------------------------------------
# 4. both halves of the row
# ---------------------------------------------------------------------------


def check_combine_b(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        for shape in ("dense", "unit"):
            scenario = _Scenario(seed, label, shape)
            scenario.separate_halves()
            canonical, cfg = scenario.canonical(), scenario.cfg
            runtime = scenario.runtime
            try:
                proof = module.prove_linear(
                    scenario.participant, dict(scenario.relation), scenario.shares
                )
            except Exception as error:  # noqa: BLE001
                return [f"prove_linear raised {type(error).__name__}"]
            if not isinstance(proof, dict) or "A" not in proof or "B" not in proof:
                failures.append("prove_linear did not return both halves of the row")
                continue
            for name in ("A", "B"):
                if not _valid_sharing(proof[name], cfg):
                    failures.append(f"prove_linear's {name} is not one stamped share per party")
            if not _valid_sharing(proof["A"], cfg) or not _valid_sharing(proof["B"], cfg):
                continue
            expected_a = dot(canonical["a"], scenario.witness, cfg["p"])
            expected_b = dot(canonical["b"], scenario.witness, cfg["p"])
            actual_a = runtime.reconstruct(proof["A"])
            actual_b = runtime.reconstruct(proof["B"])
            if actual_a == expected_b and actual_b == expected_a:
                failures.append("prove_linear returned A and B the wrong way round")
                continue
            if actual_a != expected_a:
                failures.append("prove_linear's A does not reconstruct to the a-half of the row")
            if actual_b != expected_b:
                if actual_b == expected_a:
                    failures.append("prove_linear built B from the a coefficients")
                else:
                    failures.append(
                        "prove_linear's B does not reconstruct to the b-half of the row"
                    )
            if runtime.violations:
                failures.append(
                    f"prove_linear triggered a runtime violation: {runtime.violations[0]['kind']}"
                )

    # The same sharing at two witness positions is the tampering that does not crash on its
    # own: a prover that skips the check folds it and returns a well-formed wrong statement.
    scenario = _Scenario(seed, LABELS[0])
    duplicated = (scenario.shares[0], scenario.shares[0], *scenario.shares[2:])
    try:
        module.prove_linear(scenario.participant, dict(scenario.relation), duplicated)
    except Exception:  # noqa: BLE001 - any refusal is a refusal
        pass
    else:
        failures.append("prove_linear folded a witness it never checked against the relation")
    return failures


# ---------------------------------------------------------------------------
# 5. the audit
# ---------------------------------------------------------------------------


class _GhostRuntime(Runtime):
    """Hands back result shares the log never names, with the right values.

    A prover running on this runtime computes correctly and can prove nothing about where its
    results came from. `issued` is the only thing that notices.
    """

    def add(self, left, right):
        result = super().add(left, right)
        return Share(result.party, result.field, f"ghost-{result.id}", result._value)  # noqa: SLF001


class _LeakyRuntime(Runtime):
    """Records the first addition as also having consumed another party's input share.

    Nothing is faked afterwards: the event really names that operand, so `ancestry` really
    reaches it and so does anyone who walks `events()` by hand.
    """

    def __init__(self, cfg: dict) -> None:
        super().__init__(cfg)
        #: `(share id, owning party)` for every input share, filled in after dealing.
        self.inputs: tuple[tuple[str, int], ...] = ()
        self._leaked = False

    def add(self, left, right):
        result = super().add(left, right)
        if not self._leaked:
            foreign = next(
                (identifier for identifier, party in self.inputs if party != self._party), None
            )
            if foreign is not None:
                self._leaked = True
                event = self.events[-1]
                event["operands"] = (*event["operands"], foreign)
        return result


class _OpenRuntime(ParticipantRuntime):
    """A participant runtime that does hand out `reconstruct`. Reporting otherwise is a guess."""

    def reconstruct(self, shares) -> int:
        return self._runtime.reconstruct(shares)


def _report(module, runtime: Runtime, scenario: _Scenario, facade=None) -> dict | str:
    participant = facade if facade is not None else ParticipantRuntime(runtime)
    try:
        report = module.no_reconstruction_report(
            participant, dict(scenario.relation), scenario.shares
        )
    except Exception as error:  # noqa: BLE001
        return f"no_reconstruction_report raised {type(error).__name__}"
    if not isinstance(report, dict):
        return "no_reconstruction_report did not return a dict"
    return report


def check_audit(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        scenario = _Scenario(seed, label)
        report = _report(module, scenario.runtime, scenario)
        if isinstance(report, str):
            return [report]
        for key, expected in (
            ("issued", True),
            ("singleParty", True),
            ("violations", 0),
            ("reconstructAvailable", False),
            ("width", scenario.cfg["width"]),
        ):
            if report.get(key) != expected:
                failures.append(f"the audit reported {key}={report.get(key)!r} on an honest run")

    # Results the runtime never issued. The values are right; the provenance is absent.
    scenario = _Scenario(seed, LABELS[0])
    scenario.runtime = _GhostRuntime(scenario.cfg)
    scenario.shares = scenario.runtime.deal_witness(seed, scenario.witness, label=f"{LABELS[0]}w")
    report = _report(module, scenario.runtime, scenario)
    if isinstance(report, str):
        return [*failures, report]
    if report.get("issued") is not False:
        failures.append("the audit claimed shares were issued that the runtime never produced")

    # A result that really does descend from another party's share.
    scenario = _Scenario(seed, LABELS[1])
    leaky = _LeakyRuntime(scenario.cfg)
    scenario.runtime = leaky
    scenario.shares = leaky.deal_witness(seed, scenario.witness, label=f"{LABELS[1]}w")
    leaky.inputs = tuple(
        (share.id, share.party) for sharing in scenario.shares for share in sharing
    )
    report = _report(module, leaky, scenario)
    if isinstance(report, str):
        return [*failures, report]
    if report.get("singleParty") is not False:
        failures.append("the audit missed a result descending from another party's share")

    # Refused reads really are in the log.
    scenario = _Scenario(seed, LABELS[2])
    scenario.runtime.violations.append({"kind": "cross-party-read", "party": 0, "share": "x", "owner": 1})
    scenario.runtime.violations.append({"kind": "field-mismatch", "party": 1, "share": "y", "owner": 1})
    report = _report(module, scenario.runtime, scenario)
    if isinstance(report, str):
        return [*failures, report]
    if report.get("violations") != 2:
        failures.append("the audit did not count the runtime's refused reads")

    # A runtime that does offer `reconstruct`.
    scenario = _Scenario(seed, LABELS[3])
    report = _report(module, scenario.runtime, scenario, facade=_OpenRuntime(scenario.runtime))
    if isinstance(report, str):
        return [*failures, report]
    if report.get("reconstructAvailable") is not True:
        failures.append("the audit did not notice a runtime that offers reconstruct")
    return failures


# ---------------------------------------------------------------------------
# 6. the trace
# ---------------------------------------------------------------------------


def _trace_failures(module, scenario: _Scenario, poison: tuple[dict, ...]) -> list[str]:
    runtime = scenario.runtime
    runtime.events.extend(dict(event) for event in poison)
    try:
        report = module.communication_report(
            scenario.participant, dict(scenario.relation), scenario.shares
        )
    except Exception as error:  # noqa: BLE001
        return [f"communication_report raised {type(error).__name__}"]
    if not isinstance(report, dict):
        return ["communication_report did not return a dict"]

    expected_rounds = sum(1 for event in poison if event["communication"])
    expected_messages = sum(int(event.get("messages", 0)) for event in poison)
    failures: list[str] = []
    if report.get("operations") != len(runtime.events):
        failures.append("communication_report did not count the operations the log holds")
    if report.get("rounds") != expected_rounds:
        failures.append(f"communication_report reported {report.get('rounds')!r} rounds, log says {expected_rounds}")
    if report.get("messages") != expected_messages:
        failures.append(
            f"communication_report reported {report.get('messages')!r} messages, log says {expected_messages}"
        )
    if report.get("localOnly") is not (expected_rounds == 0):
        failures.append("communication_report's localOnly does not follow from the log")
    expected_parties = tuple(sorted({event["party"] for event in runtime.events}))
    reported = report.get("parties")
    if reported is None or tuple(reported) != expected_parties:
        failures.append("communication_report did not report the parties the log names")
    return failures


def _sent(party: int, messages: int) -> dict:
    return {
        "op": "open",
        "party": party,
        "operands": (),
        "result": f"c{party}-{messages}",
        "communication": True,
        "messages": messages,
    }


def check_trace(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        failures.extend(_trace_failures(module, _Scenario(seed, label), ()))
    # One round carrying three messages: an implementation that returns `rounds` twice fails.
    failures.extend(_trace_failures(module, _Scenario(seed, LABELS[0]), (_sent(0, 3),)))
    # Two rounds carrying five messages between them.
    failures.extend(
        _trace_failures(module, _Scenario(seed, LABELS[1]), (_sent(0, 1), _sent(1, 4)))
    )
    # A round that carried nothing is still a round.
    failures.extend(_trace_failures(module, _Scenario(seed, LABELS[2]), (_sent(0, 0),)))
    # A message from outside this row's committee. `parties` derived from the setting rather
    # than from the log cannot see it.
    scenario = _Scenario(seed, LABELS[3])
    outsider = scenario.cfg["parties"] + 4
    failures.extend(_trace_failures(module, scenario, (_sent(outsider, 2),)))
    return failures


# ---------------------------------------------------------------------------
# 7. agreement with the plain relation
# ---------------------------------------------------------------------------


def _proof_values(module, scenario: _Scenario) -> tuple[int, int] | str:
    try:
        proof = module.prove_linear(
            scenario.participant, dict(scenario.relation), scenario.shares
        )
    except Exception as error:  # noqa: BLE001
        return f"prove_linear raised {type(error).__name__}"
    if not isinstance(proof, dict) or not _valid_sharing(
        proof.get("A"), scenario.cfg
    ) or not _valid_sharing(proof.get("B"), scenario.cfg):
        return "prove_linear did not return two sharings"
    return (
        scenario.runtime.reconstruct(proof["A"]),
        scenario.runtime.reconstruct(proof["B"]),
    )


def check_equivalence(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        for shape in SHAPES:
            scenario = _Scenario(seed, label, shape)
            prime = scenario.cfg["p"]
            values = _proof_values(module, scenario)
            if isinstance(values, str):
                return [values]
            expected = (
                dot(scenario.relation["a"], scenario.witness, prime),
                dot(scenario.relation["b"], scenario.witness, prime),
            )
            if values != expected:
                failures.append(
                    f"the {shape} relation does not reconstruct to the plain dot products"
                )

            # A different sharing of the same witness is the same statement.
            again = _Scenario(seed, label, shape, share_salt=":again")
            reshared = _proof_values(module, again)
            if isinstance(reshared, str):
                return [reshared]
            if reshared != expected:
                failures.append(
                    f"a rerandomized sharing of the same witness changed the {shape} result"
                )

    # Which party holds which value is a relabelling, not a different statement. Rotating the
    # values across parties is still a sharing of the same witness, so both halves must land
    # on the same field elements -- an implementation whose answer moved with the labels is
    # reading the sharing rather than the secret it represents.
    for label in LABELS:
        source = _Scenario(seed, label)
        expected = _proof_values(module, source)
        if isinstance(expected, str):
            return [*failures, expected]
        rotated = _Scenario(seed, label)
        parties = rotated.cfg["parties"]
        original = rotated.shares
        rotated.shares = tuple(
            tuple(
                Share(
                    party,
                    share.field,
                    f"rot-{share.id}",
                    sharing[(party + 1) % parties]._value,  # noqa: SLF001 - checker side
                )
                for party, share in enumerate(sharing)
            )
            for sharing in original
        )
        permuted = _proof_values(module, rotated)
        if isinstance(permuted, str):
            return [*failures, permuted]
        if permuted != expected:
            failures.append("permuting which party holds which share changed the result")

    # A unit vector at position j reads exactly w_j back out.
    scenario = _Scenario(seed, LABELS[0])
    prime, width = scenario.cfg["p"], scenario.cfg["width"]
    for index in range(width):
        unit = tuple(1 if j == index else 0 for j in range(width))
        scenario = _Scenario(seed, LABELS[0])
        scenario.relation["a"] = unit
        scenario.relation["b"] = tuple((-1 if j == index else 0) for j in range(width))
        values = _proof_values(module, scenario)
        if isinstance(values, str):
            return [*failures, values]
        if values != (scenario.witness[index] % prime, (-scenario.witness[index]) % prime):
            failures.append(f"a unit relation at position {index} did not select w_{index}")
    return failures


# ---------------------------------------------------------------------------
# 8. a setting nothing above has seen
# ---------------------------------------------------------------------------


def check_transfer(module, seed: str) -> list[str]:
    transferred = f"{seed}:transfer"
    return [
        *check_relation(module, transferred),
        *check_witness(module, transferred),
        *check_combine_a(module, transferred),
        *check_combine_b(module, transferred),
        *check_audit(module, transferred),
        *check_trace(module, transferred),
        *check_equivalence(module, transferred),
    ]


PHASES = (
    check_relation,
    check_witness,
    check_combine_a,
    check_combine_b,
    check_audit,
    check_trace,
    check_equivalence,
    check_transfer,
)


def run(module, seed: str) -> list[str]:
    failures: list[str] = []
    for phase in PHASES:
        failures.extend(phase(module, seed))
    return failures
