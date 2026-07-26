"""The only file you edit.

`ac26-w6-zkvm-exploit-predicate` decided **what counts as an exploit** on a toy prepaid
account. This one takes that same predicate and asks the question a proof system asks next:
what has to be true about the *inputs and outputs* of a guest so that a valid proof is evidence
for one statement and for nothing else?

No proof is generated here. The cryptography that turns a run into a receipt is the part that
already works. What is built is everything around it:

```text
the public statement   what is being asserted, and about what
the private witness    what the prover knew
the public journal     what the run publishes, forever, to everyone
```

Every failure in this problem lives in those three. A statement two different accounts can both
satisfy. A digest over a file path rather than over the bytes that ran. A witness handed to the
guest through an argument anybody can read. A guest that believes the host's answer. A journal
carrying one number too many, and the number happens to determine the witness.

## The target, carried over

The same account, with the same two places one order can wrap:

```text
order(quantity)
    cost  = price * quantity      <- wrap site "mul"
    total = spent + cost          <- wrap site "add"
    if total <= budget:
        deliver(quantity)
        spent = total
```

and the same security property, stated over plain integers where nothing wraps:

```text
spent + price * quantity <= budget
```

Two things moved, and both of them are why this is a separate problem.

**The account is public input now.** `price`, `spent` and `budget` are no longer baked into a
target; they travel in the statement, and the same compiled guest proves claims about every
account there is. The only thing that says which account a proof is about is the statement it
was bound to — so if two accounts can produce the same bytes, a proof about a toy account is a
proof about the production one, and nothing in the cryptography will ever notice.

**The arithmetic is public input too.** A `semantics` profile names the width *and* what the
hardware does when a result does not fit:

```text
wrapping     reduced modulo 2 ** width — the machine this exploit needs
saturating   clamped at the largest value the machine can hold
checked      the machine traps and the run stops
```

The claim has a witness on exactly one of the three. A journal that does not say which one it
ran under is a proof about whichever machine the reader assumes.

## The image, and what a digest is over

An image is bytes: a header, a build stamp, and the opcodes. Next to those bytes a toolchain
writes down two labels — `sourcePath` and `imageId` — and among the images you are handed, one
label is wrong on purpose. A rebuild of the same source with one comparison changed is a
different program under the same path. The same bytes copied elsewhere are the same program.

## The runner has two doors

```python
from fixtures.generate import Env
```

```text
env.public(name, value)     a public input. The verifier reads it, and so does anyone
                            holding the operator's transcript
env.variable(name, value)   a process environment variable for the guest. Recorded
env.note(label, **values)   one host log record. Recorded
env.hint(name, value)       host advice. It reaches the guest and is not recorded — and it
                            is not evidence, because the host is the party under suspicion
env.write_private(payload)  the private input channel. Not recorded
```

and from the guest's side, `env.public_inputs()`, `env.hints()` and `env.read_private()`. An
auditor gets `env.transcript()` and `env.writes()`, and gets neither the hints nor the payload.

## What you are handed

```python
from fixtures.generate import (
    BYTE_ORDER, CLAIMS, CHANNELS, DIGEST_HEX_LENGTH, DOMAINS, GUARDS, GUEST_VERSIONS,
    IMAGE_COMMITMENT_DOMAIN, INTEGER_BYTES, JOURNAL_FIELDS, LENGTH_PREFIX_BYTES,
    MEASUREMENT_NAMES, PARAM_NAMES, PUBLIC_NAMES, RECEIPT_FIELDS, RUN_FIELDS, SEMANTICS,
    STATEMENT_COMMITMENT_DOMAIN, STATEMENT_FIELDS, WRAP_SITE_OF,
    claim_site, commit, decode_program, is_well_formed, scenario, statement, image,
    sibling_images, naive_encode, shuffled, disclosures, replay_cases,
)
```

```text
commit(payload, domain)    a domain-separated digest over bytes. The hash is not the lesson
decode_program(body)       the steps an image body holds, or a refusal
is_well_formed(w, profile) whether a witness is in this machine's domain at all
claim_site(claim)          which wrap site a claim names
scenario(seed, label)      one image, one statement, and a witness that proves its claim
naive_encode(statement)    every field concatenated. What a sloppy encoder does
```

A `statement`: `domain`, `guestVersion`, `imageDigest`, `semantics`, `claim`, `params`, where
`params` is `price` / `spent` / `budget`. A `witness`: `quantity`, `aux`
(`machineCost`, `machineTotal`) and `search`. A `profile` from `SEMANTICS`: `semanticsId`,
`width`, `modulus`, `max`, `overflow`.

Run `make inspect` first.
"""

from __future__ import annotations


# ---------------------------------------------------------------------------
# 1. The canonical statement encoding
# ---------------------------------------------------------------------------


def encode_statement(statement: dict) -> bytes:
    """One statement as bytes, in a way that means exactly one statement.

    The shape this problem uses, and the constants for it are in the fixtures rather than in
    your file so that you and the checker are reading the same numbers:

    ```text
    every field is emitted as <length><payload>, the length being LENGTH_PREFIX_BYTES
    bytes in BYTE_ORDER byte order
    text becomes UTF-8; an integer becomes INTEGER_BYTES bytes in BYTE_ORDER
    the fields come in STATEMENT_FIELDS order, always, whatever order the dict was built in
    params is its own framed block: each PARAM_NAMES entry as a name and then a value
    the domain identifier is the first field, so a reader knows which protocol these bytes
    belong to before it has parsed any of them
    ```

    What that buys, and what it is worth is easiest to see by removing it. Concatenate the
    fields with no lengths and no separators — `naive_encode` does exactly that, and it is not
    a straw man: the field order is fixed, every field is present, and nothing is dropped. It
    is still not an encoding, because the boundary between one field and the next is not in the
    output. `"53" + "7"` and `"5" + "37"` are the same three characters, so an account priced
    at 53 with 7 already charged and an account priced at 5 with 37 already charged produce the
    same bytes. Both are real accounts. Both have real exploits. A proof about one verifies
    against the other, and nothing in the cryptography is broken while that happens.

    `fixtures.generate.collision_pair` is that pair, drawn from your seed. Your encoding has to
    keep them apart, and it has to keep apart every other pair too — including the two that
    differ only in `domain` and only in `guestVersion`, which are the two people leave out
    because they "do not affect the computation".

    Fixed width for integers because `1` and `01` are the same number and have to be the same
    bytes. Fixed byte order because a proof produced on one machine is checked on another. And
    fixed field order taken from `STATEMENT_FIELDS` rather than from the dict, because two
    dicts that compare equal are the same statement and have to encode identically —
    `shuffled(statement)` is the same statement with its keys inserted in the other order.

    Raise `ValueError` for anything that is not a statement: wrong fields, a `domain` or
    `semantics` or `claim` outside its vocabulary, an `imageDigest` that is not a digest, or
    parameters outside the domain of the machine the statement itself names. An encoder that
    encodes anything hands out commitments to things that are not statements, and a commitment
    is worth exactly what the encoder refused.
    """
    return b""


# ---------------------------------------------------------------------------
# 2. Which program the claim is about
# ---------------------------------------------------------------------------


def image_digest(image: dict) -> str:
    """A name for one program, deterministic, and bound to what will actually run.

    An image record is `{"imageId", "sourcePath", "buildId", "body"}`. Three of those are what
    a build system wrote down about the fourth.

    `sibling_images(seed, label)` hands you four images next to the base one, each differing in
    exactly one way:

    ```text
    rebuilt     the same source path, one comparison changed, a new stamp
    restamped   the same steps, a different build stamp
    renamed     the same bytes, under another path
    relabelled  the same bytes, under another image's id
    ```

    Two of those four are the same program as the base image and two are not, and every way of
    getting this wrong gets a different pair wrong. A digest over `sourcePath` says the rebuild
    is the base image — and the rebuild disagrees with it about every order whose total lands
    exactly on the budget, which is the order an attacker will pick. A digest over `imageId`
    says the relabelled copy is a different program, and then a perfectly good proof is refused
    for a reason nobody can find.

    `restamped` is the one that feels arbitrary. Settle it the way proving systems settle it: a
    rebuild is a different image even when nothing observable changed, because "nothing
    observable changed" is the claim under audit rather than an input to it.

    `commit(payload, domain)` is supplied — the hash is not the lesson, and
    `IMAGE_COMMITMENT_DOMAIN` is the domain an image body is committed under. That domain is
    not the statement's `domain` field: one says which protocol a claim belongs to, the other
    says what kind of object a hash was taken over, and you need both.

    Raise `ValueError` for a body `decode_program` refuses. A digest is a promise that the
    bytes under it are the bytes that ran; bytes nothing can run have no such promise to make.
    """
    return ""


# ---------------------------------------------------------------------------
# 3. Handing the guest its inputs
# ---------------------------------------------------------------------------


def guest_input(env, statement: dict, witness: dict) -> None:
    """Load one `Env` so the guest can do its work and an observer learns nothing.

    Two things have to be true at once, and they pull in opposite directions.

    The guest needs the whole statement and the whole witness. The public inputs have to be
    exactly `STATEMENT_FIELDS`, carrying exactly the statement's values — fewer and a verifier
    is holding a claim it cannot reconstruct; more and the extra one is a public input nobody
    agreed to.

    And `env.transcript()` has to survive being read by somebody who should not learn the
    witness. It holds the public inputs, the process environment and every note, and it is what
    an operator's log aggregator keeps for ninety days. The private channel is not in it.

    None of the witness is publishable, and the three parts are unpublishable for three
    different reasons. `quantity` is the exploit. `aux` is the exploit with one modular inverse
    applied — the price is public and the modulus is a power of two, so a machine cost is a
    quantity that has not been divided yet. `search` is the exploit surrounded by its
    neighbours, which is worse than the quantity on its own.

    Raise `ValueError` for a statement that is not one, and for a witness `is_well_formed`
    refuses against the profile the statement names. A value outside `0..max` is not a small
    mistake to be masked into range; it is a witness for a different machine, and a run built
    on one proves something about an execution that never happened.
    """


# ---------------------------------------------------------------------------
# 4. Running the program the statement names
# ---------------------------------------------------------------------------


def run_guest(image: dict, env) -> dict:
    """Execute the named program on the named machine and decide the claim. Report `RUN_FIELDS`.

    ```text
    imageDigest  the digest of the program that actually ran
    steps        how many steps it took
    accepted     the machine's guard let the order through
    violated     the security property was broken
    wrapped      the wrap sites whose result had to be reduced, sorted
    trapped      a checked build stopped the run
    claimResult  the claim in the statement holds
    ```

    Read the statement from `env.public_inputs()` and the witness from `env.read_private()`.
    Refuse — `ValueError` — before a single step runs if the image handed over is not the one
    the statement's `imageDigest` names, or if what arrives on the private channel is not a
    witness for this machine. Executing first and reporting which program it was afterwards
    produces a run somebody can quote out of context.

    The arithmetic comes out of `SEMANTICS[statement["semantics"]]` and nowhere else. The width
    is not 8, 16, 32 or 64 and it changes between checkpoints, so a constant written in here
    passes every checkpoint until `transfer`. And the profile says more than a width:

    ```text
    wrapping     reduce modulo the modulus, and record which site had to be reduced
    saturating   clamp at max — nothing carried around zero, so nothing wrapped
    checked      stop, with trapped set and however many steps had run
    ```

    The two arithmetic steps happen in sequence: the addition is performed on the multiply's
    already-reduced output, not on the exact product. Written the other way it is a machine with
    a wider register somewhere in the middle of it, and the two witnesses this target family is
    built out of stop being two on that machine.

    `violated` is the field to think hardest about and the thinking is not arithmetic. The
    security property is a statement about **value**, over plain integers where nothing wraps.
    Which register the machine kept that value in is no part of it. Ask the property of the
    machine's own total instead and you have asked whether the machine *noticed* — and it did
    not, every time, because not noticing is the failure being proven.

    `claimResult` is the previous problem's predicate: the machine accepted, the property was
    violated, and the site the claim names is one that actually wrapped. All three, and the
    third one is why a claim names a site at all.

    One line matters by being absent. `env.hints()` carries the host's own account of what this
    run produced, and on the runs the checker builds it is confident, detailed and wrong. The
    host is the party being proved about. Its answer is not an input to the guest's answer, and
    a guest that takes the hint is fast, is right almost always, and proves nothing at all.
    """
    return {}


# ---------------------------------------------------------------------------
# 5. What the run publishes
# ---------------------------------------------------------------------------


def seal_journal(statement: dict, run: dict) -> dict:
    """The public journal: exactly `JOURNAL_FIELDS`, and exactly those.

    ```text
    statementDigest  the canonical commitment to the statement this run was bound to
    imageDigest      which program ran
    claimResult      whether the claim held
    guestVersion     which guest build decided that
    measurements     the public measurements, a dict over MEASUREMENT_NAMES
    ```

    `statementDigest` is where checkpoint 1 gets used: commit to `encode_statement(statement)`
    under `STATEMENT_COMMITMENT_DOMAIN`. Everything the statement says is inside that one
    field, which is what makes the next checkpoint possible.

    The three fields after it are a convenience for a reader who has the journal and not the
    statement. They are not the evidence, and the difference matters in exactly one direction:
    writing them down costs nothing, and *believing* them costs everything.

    The measurement is the part worth arguing about. There is one, and it is one a reader could
    already compute from the public image — that is the test a public measurement has to pass,
    not "is it small" and not "is it just a number". A cycle count that varies with the witness
    is not a measurement, it is the witness at lower resolution, and it will be in every
    receipt forever.

    A journal is also defined by what is not in it. The witness is not in it. The execution
    trace is not in it. What the search tried is not in it. None of those three is ever a
    debugging convenience that can be added later and removed before release, because a journal
    is the one artifact that outlives the run.

    Raise `ValueError` for a statement that is not one, for a `run` that is not a `RUN_FIELDS`
    record, and for a run whose `imageDigest` is not the statement's. That last one seals a
    journal that is internally consistent and about two different things.
    """
    return {}


# ---------------------------------------------------------------------------
# 6. Offering it against something else
# ---------------------------------------------------------------------------


def accept_receipt(receipt: object, statement: object) -> bool:
    """Whether this receipt is evidence for this statement. A receipt is `{"journal": ...}`.

    A real receipt carries a seal as well, and checking a seal is precisely the part that
    cryptography already does for you. What it does not do is notice that a perfectly valid
    seal is being shown to you next to a statement it was never about.

    `replay_cases(seed, label)` re-offers receipts against things one field away from what
    sealed them: another program, another claim, another integer width, another overflow
    behaviour, another protocol version, another guest build. Two of the rows are honest.

    One row is the reason checkpoint 1 exists. `other-params` is the colliding pair, offered
    against each other. Under a length-free encoding that row verifies — and then a valid
    receipt is a valid proof that an account nobody has touched is over its budget. Nothing
    is forged; the statement simply did not say what everyone read it as saying.

    Three rows are receipts nobody replayed, which have had a field edited after sealing: the
    digest still matches, and the journal now says something the statement does not. A journal
    field a verifier *reads* is a journal field an attacker *writes*.

    And the last one: a receipt whose `claimResult` is `False` is a correct journal about a run
    that proves nothing. Accepting it as evidence for the claim is the quietest way in of all.

    This function never raises. It is the verifier — it is called on whatever a prover sends,
    and one that crashes on a malformed receipt has turned a decision it owed its caller into
    an exception whose handling is no part of the proof system.
    """
    return False


# ---------------------------------------------------------------------------
# 7. What a run gave away
# ---------------------------------------------------------------------------


def leak_report(disclosure, statement: dict, image: dict) -> tuple[tuple[str, str], ...]:
    """Every `(channel, field name)` this run put in front of somebody outside the policy.

    Sorted, no duplicates. The channels are `CHANNELS`:

    ```text
    journal  the sealed journal itself
    stdout   what the run wrote to its output
    stderr   what it wrote to its error output
    error    the record a failed run left, or None
    trace    the execution trace it kept for debugging
    temp     the temporary artifacts it left on disk
    ```

    A correctness test reads the first one. Six of the ten runs in `disclosures(seed, label)`
    are spotless there and are not spotless. Every one of the ten produced the same journal
    claim, and every one of them is correct.

    Channels other than `journal` and `error` are tuples of `{"label", "values"}` records, and
    `error` is `{"message", "values"}`. The label and the message are free text and are not
    policed; the names inside `values` are, because a name is something a policy can be written
    against and a formatted string is not. A `values` entry that is itself a dict has published
    the names inside it too.

    `PUBLIC_NAMES` is every name a run may disclose, and it is one half of the policy.
    Everything on it is either public before the run started or is the claim the run exists to
    publish. Everything else is witness-derived, and "derived" is doing real work here: the
    price is public and the modulus is a power of two, so a machine cost is a quantity with one
    modular inverse still to apply, and a machine total is the same thing one subtraction
    further back.

    The other half of the policy is that an approved name is not an approved value.

    * A name in `PARAM_NAMES` may carry that parameter's own public value and nothing else. One
      of the runs publishes `spent` — squarely on the allowlist — carrying the machine's own
      total. A scan that only looks at names finds nothing there.
    * A name in `MEASUREMENT_NAMES` may carry only what the public image already implies, which
      is the number of steps `decode_program` finds in it. One of the runs reports how many
      quantities its search tried, under the same approved name.

    Two of the ten disclose nothing that gives the witness away, and one of those two is loud:
    it fills every channel with numbers. Reporting a leak against either of them is exactly as
    wrong as missing one against the other eight — an audit that always finds something has not
    read anything.
    """
    return ()
