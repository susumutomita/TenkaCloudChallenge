"""Seven MPC programs that all compute the right answer, and the runtime that runs them.

A "program" here is a list of operations, not Python source. That is deliberate. An
auditor that greps for the word `reconstruct` is defeated by a rename, a wrapper, or a
helper; an auditor that reads the *operations a run actually performed* is not. Making
the program data rather than code is what lets this problem grade the difference.

The scenario: three parties hold private risk figures and want their weighted total.
Every program below returns the correct total. They differ only in what leaks on the way.

    OP                          effect
    ("share",   label, owner)   owner's private value becomes a sharing named `label`
    ("const",   label, value)   a public constant
    ("mask",    out, val, msk)  out = val - msk, still shared (local, leaks nothing)
    ("scale",   out, val, k)    out = val * k, k public (local)
    ("addsh",   out, x, y)      out = x + y (local)
    ("open",    label)          the value behind `label` is revealed to everyone
    ("peek",    party, owner)   `party` reads `owner`'s raw share slot
    ("emit",    label, text)    a log line that interpolates `label`'s value
    ("fail",    label, text)    an error path carrying `label`'s value in its message
    ("output",  label)          the protocol's declared result

Only `open`, `peek`, `emit`, `fail` and `output` are observable to an outsider; the rest
is local arithmetic. That asymmetry is the whole subject of the problem.

Toy parameters, chosen so a learner can check any step by hand. Not secure, not a model
of a real MPC deployment, and not to be read as guidance for one.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field

PRIMES = (1009, 1013, 1019, 1021, 1031, 1033, 1039, 1049)

# Every violation this problem can observe. The auditor names one of these.
VIOLATIONS = (
    "opened-a-secret",
    "cross-party-read",
    "leaked-in-log",
    "leaked-in-error",
)

PROGRAM_IDS = ("alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf")


def _stream(seed: str, label: str) -> list[int]:
    out: list[int] = []
    counter = 0
    while len(out) < 96:
        out.extend(hashlib.sha256(f"{seed}:{label}:{counter}".encode()).digest())
        counter += 1
    return out


def _pick(s: list[int], i: int, low: int, high: int) -> int:
    return low + ((s[i] * 256 + s[i + 1]) % (high - low + 1))


@dataclass(frozen=True)
class Spec:
    """The protocol specification the auditor derives its allowed-open set from.

    `public_inputs` are known to everyone before the run. `masked` values are secrets
    hidden behind a fresh one-time mask, which is exactly why opening them is safe.
    `result` is the declared output. Anything else is an intermediate secret.
    """

    p: int
    parties: tuple[str, ...]
    weights: dict[str, int]
    private: dict[str, int]
    masks: dict[str, int]
    public_inputs: tuple[str, ...]
    masked: tuple[str, ...]
    result: str

    def allowed_opens(self) -> set[str]:
        return {*self.public_inputs, *self.masked, self.result}


def spec(seed: str, label: str = "public") -> Spec:
    s = _stream(seed, f"spec:{label}")
    p = PRIMES[s[0] % len(PRIMES)]
    parties = ("p0", "p1", "p2")
    weights = {party: _pick(s, 4 + 2 * i, 1, 9) for i, party in enumerate(parties)}
    private = {party: _pick(s, 20 + 2 * i, 1, p - 1) for i, party in enumerate(parties)}
    masks = {party: _pick(s, 40 + 2 * i, 1, p - 1) for i, party in enumerate(parties)}
    return Spec(
        p=p,
        parties=parties,
        weights=weights,
        private=private,
        masks=masks,
        # Weights are agreed in advance, and each masked difference is hidden behind a
        # fresh one-time mask, so both are safe to open. Everything else is an
        # intermediate secret.
        public_inputs=tuple(f"weight-{party}" for party in parties),
        masked=tuple(f"masked-{party}" for party in parties),
        result="total",
    )


def expected_total(sp: Spec) -> int:
    return sum(sp.weights[party] * sp.private[party] for party in sp.parties) % sp.p


@dataclass
class Event:
    """One observable step. The auditor sees a list of these and nothing else."""

    kind: str
    label: str = ""
    party: str = ""
    owner: str = ""
    text: str = ""
    value: int = 0

    def as_dict(self) -> dict[str, object]:
        return {
            "kind": self.kind,
            "label": self.label,
            "party": self.party,
            "owner": self.owner,
            "text": self.text,
            "value": self.value,
        }


@dataclass
class Run:
    events: list[dict[str, object]] = field(default_factory=list)
    transcript: list[dict[str, object]] = field(default_factory=list)
    output: int | None = None
    error: str = ""


def execute(program_ops: list[tuple], sp: Spec) -> Run:
    """Run a program and record everything an outsider could observe.

    Local arithmetic produces no events. That is the point: a protocol is judged by what
    it reveals, not by how much it computes.
    """
    values: dict[str, int] = {}
    run = Run()
    for op in program_ops:
        kind = op[0]
        if kind == "share":
            _, label, owner = op
            values[label] = sp.private[owner]
        elif kind == "const":
            _, label, value = op
            values[label] = value % sp.p
        elif kind == "mask":
            _, out, val, msk = op
            values[out] = (values[val] - values[msk]) % sp.p
        elif kind == "scale":
            _, out, val, k = op
            values[out] = (values[val] * k) % sp.p
        elif kind == "addsh":
            _, out, x, y = op
            values[out] = (values[x] + values[y]) % sp.p
        elif kind == "open":
            _, label = op
            run.events.append(Event(kind="open", label=label, value=values[label]).as_dict())
            run.transcript.append({"label": label, "value": values[label]})
        elif kind == "peek":
            _, party, owner = op
            run.events.append(Event(kind="peek", party=party, owner=owner).as_dict())
        elif kind == "emit":
            _, label, text = op
            run.events.append(
                Event(kind="emit", label=label, text=text, value=values[label]).as_dict()
            )
        elif kind == "fail":
            _, label, text = op
            run.events.append(
                Event(kind="fail", label=label, text=text, value=values[label]).as_dict()
            )
            run.error = f"{text}: {values[label]}"
        elif kind == "output":
            _, label = op
            run.events.append(Event(kind="output", label=label, value=values[label]).as_dict())
            # The declared result is revealed by definition, so it is part of what an
            # outsider sees. Leaving it out of the transcript would understate the view.
            run.transcript.append({"label": label, "value": values[label]})
            run.output = values[label]
        else:
            raise ValueError(f"unknown op: {kind}")
    return run


def _core(sp: Spec) -> list[tuple]:
    """The honest skeleton every program shares: mask, open the masked differences,
    recombine locally. No intermediate secret is ever revealed."""
    ops: list[tuple] = []
    for party in sp.parties:
        ops.append(("share", f"x-{party}", party))
        ops.append(("const", f"m-{party}", sp.masks[party]))
        ops.append(("const", f"weight-{party}", sp.weights[party]))
        ops.append(("mask", f"masked-{party}", f"x-{party}", f"m-{party}"))
        ops.append(("open", f"masked-{party}"))
        ops.append(("open", f"weight-{party}"))
        ops.append(("scale", f"w-{party}", f"x-{party}", sp.weights[party]))
    ops.append(("addsh", "sub", f"w-{sp.parties[0]}", f"w-{sp.parties[1]}"))
    ops.append(("addsh", "total", "sub", f"w-{sp.parties[2]}"))
    ops.append(("output", "total"))
    return ops


def _insert_before_output(ops: list[tuple], extra: list[tuple]) -> list[tuple]:
    cut = next(i for i, op in enumerate(ops) if op[0] == "output")
    return [*ops[:cut], *extra, *ops[cut:]]


def program(sp: Spec, program_id: str) -> list[tuple]:
    """One of five implementations. Every one of them outputs the correct total."""
    ops = _core(sp)
    victim = sp.parties[1]
    if program_id == "alpha":
        # Clean. An auditor that flags this one is flagging the legitimate final output.
        return ops
    if program_id == "bravo":
        # Opens an intermediate secret: a partial weighted sum, behind no mask at all,
        # so whoever reads the transcript learns it.
        return _insert_before_output(ops, [("open", "sub")])
    if program_id == "charlie":
        # A party reads another party's raw share slot. Nothing is opened and the
        # transcript is spotless; only the access trace shows it.
        return _insert_before_output(ops, [("peek", sp.parties[0], victim)])
    if program_id == "delta":
        # A log line carrying a raw private value. Logs are inside the threat model.
        return _insert_before_output(ops, [("emit", f"x-{victim}", "debug: share")])
    if program_id == "echo":
        # The error path carries a secret. The happy path is clean, which is exactly why
        # a correctness-only review passes it.
        return _insert_before_output(ops, [("fail", f"x-{victim}", "assertion failed")])
    if program_id == "foxtrot":
        # Logs a value that is public by specification. An auditor that treats every log
        # line as a leak reports a violation here that does not exist.
        return _insert_before_output(
            ops, [("emit", f"weight-{sp.parties[0]}", "audit: weight")]
        )
    if program_id == "golf":
        # A party reads its own share slot, which is the ordinary thing for a party to
        # do. An auditor that flags every read reports a violation here that does not
        # exist.
        return _insert_before_output(ops, [("peek", sp.parties[0], sp.parties[0])])
    raise ValueError(f"unknown program id: {program_id}")


# What the auditor must conclude for each program. Inside the image only.
TRUTH: dict[str, str | None] = {
    "alpha": None,
    "bravo": "opened-a-secret",
    "charlie": "cross-party-read",
    "delta": "leaked-in-log",
    "echo": "leaked-in-error",
    "foxtrot": None,
    "golf": None,
}


def renamed(ops: list[tuple], sp: Spec, tag: str) -> tuple[list[tuple], Spec]:
    """Rename every label, in the program and in the spec, consistently.

    Renaming leaves the protocol -- and therefore the verdict -- unchanged. An auditor
    keyed on the literal label text rather than on the spec's allowed-open set will
    disagree with itself between the two runs, which is exactly what the mutation
    checkpoint is looking for.
    """

    def rn(label: str) -> str:
        return f"{tag}_{label}"

    out: list[tuple] = []
    for op in ops:
        kind = op[0]
        if kind in ("share", "const"):
            out.append((kind, rn(op[1]), op[2]))
        elif kind == "mask":
            out.append((kind, rn(op[1]), rn(op[2]), rn(op[3])))
        elif kind == "scale":
            out.append((kind, rn(op[1]), rn(op[2]), op[3]))
        elif kind == "addsh":
            out.append((kind, rn(op[1]), rn(op[2]), rn(op[3])))
        elif kind in ("open", "output"):
            out.append((kind, rn(op[1])))
        elif kind in ("emit", "fail"):
            out.append((kind, rn(op[1]), op[2]))
        else:
            out.append(op)
    moved = Spec(
        p=sp.p,
        parties=sp.parties,
        weights=sp.weights,
        private=sp.private,
        masks=sp.masks,
        public_inputs=tuple(rn(label) for label in sp.public_inputs),
        masked=tuple(rn(label) for label in sp.masked),
        result=rn(sp.result),
    )
    return out, moved


def reordered(ops: list[tuple]) -> list[tuple]:
    """Move the public-weight openings to just before the output.

    They depend on nothing and nothing depends on them, so the protocol is unchanged --
    but every event index after the first one moves. An auditor that memorized where a
    violation sat, rather than deciding from the event itself, breaks here.
    """
    movable = [op for op in ops if op[0] == "open" and op[1].startswith("weight-")]
    rest = [op for op in ops if op not in movable]
    return _insert_before_output(rest, movable)


def rename_tag(seed: str, label: str) -> str:
    s = _stream(seed, f"rename:{label}")
    return f"v{s[0] % 97}"


def spec_as_public(sp: Spec) -> dict[str, object]:
    """What the auditor is given: the specification, never the private values."""
    return {
        "p": sp.p,
        "parties": list(sp.parties),
        "publicInputs": list(sp.public_inputs),
        "masked": list(sp.masked),
        "result": sp.result,
    }


def health_token(seed: str) -> str:
    sp = spec(seed)
    return hashlib.sha256(f"health:{seed}:{sp.p}".encode()).hexdigest()[:16]
