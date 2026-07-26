"""The only file you edit.

Eight co-SNARK provers are handed to you as `S1`..`S8`. Every one of them computes the same
relation, and every one of them reconstructs `C` to `A * B` on every seed and every shape.
Line them up against a correctness test and it cannot tell them apart. That is the premise of
this problem, not a spoiler.

```text
A = sum_j a_j w_j        B = sum_j b_j w_j        C = A * B        (mod p)
```

The two problems before this one are **supplied**. `ac26-w6-cosnark-linear` built `[A]` and
`[B]`; `ac26-w6-cosnark-beaver` built the one multiplication that has to communicate, and
`fixtures.generate.beaver_product` is that answer, handed over. You are not computing `C`
again. You are asking what a prover built on top of it is allowed to say out loud.

## What you may not do

Read a specimen's source. Two of them reach a capability through a name that does not spell
it, and `grep` is exactly the audit this problem exists to be better than. Everything you
need is in the record a run leaves behind.

## The bench

```python
from fixtures.lab import malformed_row, probe_factory, serialized
```

```text
probe(specimen_id, row=None)   run one specimen in a fresh scenario, return its Evidence
malformed_row(row)             a row whose declared width disagrees with its coefficients
serialized(disclosure)         the disclosure as a next stage receives it
```

An `Evidence` carries:

```text
runtime      the AuditRuntime it ran on
             .reached()    every capability reached: {"capability", "party", "operands"}
             .openings()   every opening:            {"roundId", "shareIds", "maskedBy"}
             .events()     the full operation trace
             .violations() what the runtime refused or recorded
disclosure   what it put in front of you: .artifact, .log, .metrics, .error
row          the relation it was handed
setting      p, parties, width, fieldId, settingId
raised       the exception type name if it let one out, else None
```

The runtime **does** offer `reconstruct` and `peek`, unlike the previous problem's. That is
deliberate: a real MPC library exposes reconstruction and debugging hooks because real
operators need them, and withholding them here would make the whole class of defect
unwritable and therefore unauditable. Reaching a capability is not a violation. Reaching one
is recorded, and what a prover does next with what it read is the question you are asking.

## The policy

```python
from fixtures.generate import ALLOWED_NAMES, SHARING_ONLY_NAMES, CHANNELS, is_sharing
```

`ALLOWED_NAMES` is every field name a prover may put in front of a participant, whichever
channel it comes out of. `SHARING_ONLY_NAMES` is the subset that may only ever carry a
sharing. Those are two rules, and one of the specimens is the reason.

Run `make inspect` first.
"""

from __future__ import annotations


# ---------------------------------------------------------------------------
# 1. The policy, written down
# ---------------------------------------------------------------------------


def classify(entry: dict, row: dict) -> str:
    """Put one value from `fixtures.generate.value_catalog` into exactly one of six classes.

    ```text
    public-input            known to everyone before the run
    secret-share            one party's piece of something shared
    allowed-open            a value the protocol authorized publishing
    secret-intermediate     witness-derived, in the clear, and nobody authorized it
    participant-artifact    what the next stage receives
    verifier-only           only the checker holds it
    ```

    An entry describes a value without naming it, so `w` and `x` will not help you:

    ```text
    origin    relation / witness / triple / runtime
    form      metadata / element / share / sharing
    opened    None, or {"roundId", "maskedBy"} -- the same shape `openings()` records use
    audience  everyone / participant / party / verifier
    ```

    The catalog contains two entries that are the whole reason this is a policy rather than a
    lookup table. Both of them were opened. One went out in a round the relation never
    declared, and one went out in the right round with nothing hiding it. "It was published,
    so publishing it was allowed" is the belief this checkpoint exists to break — an opening
    is the multiplication's own only if a reserved mask is behind it **and** the round is the
    one `round_id_for(row)` names.

    Order matters, and working out which rule has to be asked first is most of the work.

    Raise `ValueError` for an entry whose `origin`, `form` or `audience` is outside the
    vocabulary — an auditor that silently classifies a value it did not understand is worse
    than one that stops.
    """
    return ""


# ---------------------------------------------------------------------------
# 2. What a run was able to do
# ---------------------------------------------------------------------------


def capability_audit(probe, specimen_id: str) -> tuple[str, ...]:
    """Every capability this specimen reaches, beyond the ones the protocol reaches anyway.

    Sorted, no duplicates. `fixtures.generate.PROTOCOL_CAPABILITIES` is the baseline: one
    authorized multiplication opens `d` and `e` and does nothing else, so anything else in
    `reached()` is something the prover on top decided to do.

    This is the one checkpoint where **you** decide how many times to run the specimen. The
    others hand you a run and ask what it says. Here you are handed `probe`, and one probe is
    one input: a specimen whose only defect sits on an exception path is spotless right up
    until something makes it take that path. `malformed_row` builds one such input, and at
    least one specimen needs it.

    A capability record is `{"capability", "party", "operands"}` — the name and the operand
    ids, never a value. That is deliberate: it is evidence rather than a transcript.
    """
    return ()


# ---------------------------------------------------------------------------
# 3. What a run published to the other parties
# ---------------------------------------------------------------------------


def open_set_audit(evidence) -> tuple[dict, ...]:
    """Every opening this run made that the multiplication did not authorize, in order.

    One per record, in the order `evidence.runtime.openings()` holds them:

    ```text
    roundId    the round it went out in
    shareIds   the share ids that were opened
    masked     whether a reserved triple mask was behind it at all
    ```

    Two different mistakes are both unauthorized and only one of them is the obvious one.
    Publishing a value with nothing hiding it is visible the moment you look at `maskedBy`.
    Publishing a *masked* value in a round the relation never declared is not: it looks
    exactly like the protocol's own openings, and what it did was spend a mask on a value the
    mask was not drawn for. An audit that only checks `maskedBy` passes it, and an audit that
    only checks the round id passes the other one.

    `round_id_for(row)` names the one round a single multiplication may open in.
    """
    return ()


# ---------------------------------------------------------------------------
# 4. Whose shares a run read
# ---------------------------------------------------------------------------


def cross_party_audit(evidence) -> dict:
    """Report the peeks in this run and whether any of them crossed a party boundary.

    ```text
    peeks     how many peek records the run left
    parties   the party ids whose shares were peeked, sorted, no duplicates
    crossed   whether party-local computation read outside its own party
    ```

    `peek` is the runtime's debugging hook: it reads any share from anywhere and is not
    refused, because an operator debugging a stuck party needs it. It is recorded, with the
    id of the party that **owns** the share rather than the one that read it — which is
    enough, and working out why is the checkpoint.

    One of the specimens discloses nothing at all through any channel and still fails here.
    Its disclosure is identical to a clean prover's, and one operator now holds a witness
    half. An audit of what was *said* cannot see it. An audit of what was *reached* can.
    """
    return {}


# ---------------------------------------------------------------------------
# 5. What a run published to us
# ---------------------------------------------------------------------------


def leakage_audit(evidence) -> tuple[tuple[str, str], ...]:
    """Every `(channel, field name)` pair this run put in front of us outside the policy.

    Sorted, no duplicates. The channels are `CHANNELS`: `artifact`, `log`, `metrics`,
    `error`. A correctness test reads the first field of the first one, which is why three of
    the specimens use only the other three.

    The log is structured — a record is `{"event", "values"}` — so the *field names* are the
    policy surface. The event name is a label and is not policed; the names inside `values`
    are. The error record works the same way.

    `ALLOWED_NAMES` alone is not the policy. `SHARING_ONLY_NAMES` is the second half of it,
    and one specimen exists entirely to make the difference matter: it publishes a name that
    is squarely on the allowlist, carrying an integer where a sharing belongs. A scan that
    only looks at names finds nothing. `is_sharing(value, parties)` is supplied so you can
    ask the other question without reaching into `Share._value`.
    """
    return ()


# ---------------------------------------------------------------------------
# 6. What we can recover from it
# ---------------------------------------------------------------------------


def leakage_evidence(disclosure, setting) -> dict | None:
    """Recover a secret from the disclosure alone, or return `None` if it does not yield one.

    ```text
    value   the secret, as a field element mod p
    from    the (channel, field name) pair you got it out of
    ```

    You are handed a `serialized` disclosure: every sharing has already become a list of
    opaque share ids, exactly as it would arrive at a next stage across a process boundary.
    So `Share._value` is not on the table here, and neither is `reconstruct` — the checker
    watches the runtime and an audit that reaches a capability to answer this has answered a
    different question.

    A leak is not "a number you recognize". It is a number you can **derive** something
    secret from, using only what is in front of you, and the disclosures here need three
    different derivations. One hands you the secret directly under a name nobody would flag
    as sensitive. One hands you a whole sharing in the clear. And one hands you a value that
    is not secret-looking at all, published in the same record as a value the policy
    explicitly **allows** — the previous problem's `d = A - x` is the whole of it, and
    finding the leak and deriving the secret are two different skills.

    Some of the runs yield nothing at all, and reporting a leak for one of those is wrong.
    """
    return None


# ---------------------------------------------------------------------------
# 7. The repair
# ---------------------------------------------------------------------------


def private_prover(runtime, row: dict, halves: dict, triple, sink) -> dict:
    """A prover on top of the supplied `beaver_product` that gives none of it away.

    Return what `beaver_product` returns — `{"A", "B", "C", "d", "e", "tripleId", "roundId"}`
    — and publish an artifact of the shape `clean_artifact` produces, through `sink.publish`.

    Everything the previous seven checkpoints measured has to come out empty, at once:

    ```text
    C reconstructs to A * B          correctness is still the floor, not the ceiling
    exactly two openings, one round  both of them the multiplication's own
    no capability beyond `open`      no reconstruct, no peek, not through an alias either
    nothing outside the policy       in any of the four channels
    ```

    Publishing nothing at all satisfies four of those and fails the first, which is the point:
    a prover that says nothing is not private, it is useless. The artifact is what the next
    stage consumes and it has to be there.

    One more thing is graded, and it is the one that is easy to get wrong precisely because it
    only happens when something else has already gone wrong. This will be called on a runtime
    whose triple has already been spent, so `reserve_triple` refuses and the call fails. Let
    it fail. A handler that puts the failing state in front of someone so the failure can be
    debugged is the single most common way a prover that is private on Tuesday stops being
    private on Wednesday.
    """
    return {}
