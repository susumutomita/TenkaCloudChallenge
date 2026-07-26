"""The only file you edit.

The previous problem built the half of a co-SNARK prover's row that costs nothing:

```text
A = sum_j a_j * w_j        B = sum_j b_j * w_j        (mod p)
```

Both sharings are **handed to you already built**. This problem is the other half.

```text
C = A * B        (mod p)
```

`A` and `B` are shared. The product of the sums is not the sum of the products, so no
arrangement of local operations produces `[C]`. One round of communication is the price, and
Beaver's trick is what makes it exactly one.

## The trick

A triple is `[x]`, `[y]`, `[z]` with `z = x * y`, drawn before anyone knows what will be
multiplied. Then

```text
[d] = [A] - [x]        [e] = [B] - [y]        both local
d, e opened                                   one round, two values
[C] = [z] + d*[y] + e*[x] + d*e
```

Substituting `A = d + x` and `B = e + y` into `A * B` and expanding is worth doing on paper
once; the four terms above are what comes out.

`d` and `e` are `A` and `B` masked by uniform values nobody chose, so opening them reveals
nothing about either — **provided the mask is used once**. That sentence is the whole security
of the step, which is why `reserve_triple` refuses to hand the same triple out twice.

## What you are handed

`runtime` is a `ParticipantRuntime`. Everything the previous problem gave you, plus three:

```text
runtime.reserve_triple(triple)   check a triple and spend it; a second call raises
runtime.open(round_id, sharing)  reveal one shared value. The only thing here that talks
runtime.openings()               every opening: {"roundId", "shareIds", "maskedBy"}
runtime.consumed_triples()       the triple ids spent so far
```

and the ones you already know:

```text
runtime.setting / party_scope / value_of / add / sub / mul_public / add_public / zero
runtime.events() / violations() / ancestry(share) / issued(share)
```

There is still no `reconstruct`.

A `Triple` carries `id`, `fieldId`, `parties`, and the three sharings `x`, `y`, `z`.

Run `make inspect` first.
"""

from __future__ import annotations


# ---------------------------------------------------------------------------
# 1. The plan
# ---------------------------------------------------------------------------


def multiplication_plan(relation: dict, products: int = 1) -> dict:
    """Cost out the online phase before writing it, and refuse a relation that is not one.

    `products` is how many **independent** multiplications sit in the layer you are planning.
    This problem computes one, which is the default; the checkpoint asks you to plan others.

    ```text
    products    the layer's width, as given
    triples     fresh triples the layer spends
    opens       shared values opened
    rounds      rounds of communication
    messages    shares sent, summed over the layer
    local       the local operation names one multiplication needs, sorted
    fieldId     from the relation
    relationId  from the relation
    ```

    Two of those are the reason this checkpoint exists.

    `rounds` is not the number of opened values, and it is not one per multiplication either.
    Independent multiplications in a layer do not wait for each other: every `d` and every `e`
    in the layer is already computable, so they all go out together. What `rounds` counts is
    how many times the parties have to stop and wait — which for a layer of any width is the
    same number, and for a layer of no width is a different one.

    `local` is the operation names, not a count, and `open` does not belong in it. Write out
    the four terms of `[C]` and read off which runtime call builds each one.

    Raise `ValueError` for a relation that does not describe a field (a `fieldId` that does not
    name `p`, fewer than two parties, a non-integer anywhere) or for a negative layer width.
    """
    return {}


# ---------------------------------------------------------------------------
# 2. The triple
# ---------------------------------------------------------------------------


def reserve_fresh_triple(runtime, relation: dict, triple) -> dict:
    """Check the triple against the statement, spend it, and report what the runtime says.

    Return `{"tripleId", "fieldId", "parties", "consumed"}`, where `consumed` is every triple
    id spent on this runtime so far — asked, not assumed.

    The runtime already refuses a triple that is not a triple: reused, malformed, `z != x*y`,
    or drawn for another *setting*. Let those refusals through rather than catching them; a
    prover that continues past a broken triple produces a `C` that is simply wrong, and one
    that continues past a **reused** triple produces a perfectly correct `C` while handing
    away the mask twice.

    There is one check the runtime cannot make for you. It compares a triple against the
    setting it was constructed with. You are holding something it has never seen — the
    relation — and a triple drawn for a different one of those is not a triple for this
    statement. Raise `ValueError` when they disagree.
    """
    return {}


# ---------------------------------------------------------------------------
# 3. The masks
# ---------------------------------------------------------------------------


def masked_operands(runtime, triple, halves: dict) -> dict:
    """`[d]` and `[e]`: the two sharings that are about to be opened. Both local.

    `halves` is `{"A": sharing, "B": sharing}` as the previous problem produced them, one
    share per party. Return `{"d": sharing, "e": sharing}` in the same form.

    Nothing here communicates. Each party subtracts one share it holds from another share it
    holds, which is why this stage is free and why the round count in your plan does not
    depend on it.

    Which mask goes with which half matters, and so does which way round the subtraction goes.
    Both mistakes produce two perfectly well-formed sharings, and neither is visible until the
    product comes out wrong four stages later — so it is worth deriving `[d]` from the
    substitution rather than remembering it.
    """
    return {}


# ---------------------------------------------------------------------------
# 4. The round
# ---------------------------------------------------------------------------


def open_masks(runtime, round_id: str, masked: dict) -> dict:
    """Open both masked values, and report what the opening records say.

    ```text
    d           the opened value of [d]
    e           the opened value of [e]
    roundId     the id you opened under
    openings    how many openings this runtime has recorded
    rounds      how many distinct rounds those openings fall into
    ```

    A round is not an opened value. The runtime stamps every opening with the `round_id` you
    passed, and openings that carry the same one happened together — that is what batching
    *is*. Two values in one round and two values in two rounds are different protocols with
    identical output, and the difference is the only thing distinguishing this from a
    two-round schedule that would double the latency of every layer in a real prover.

    Both numbers come from `runtime.openings()`. You know what they should be on an honest run
    of your own code, which is exactly why reporting them from memory is worth nothing: this
    checkpoint will hand you a runtime that has already opened something.
    """
    return {}


# ---------------------------------------------------------------------------
# 5. The product
# ---------------------------------------------------------------------------


def shared_product(runtime, triple, d: int, e: int) -> tuple:
    """`[C]` from the reserved triple and the two opened values. One share per party.

    ```text
    [C] = [z] + d*[y] + e*[x] + d*e
    ```

    The first three terms are a shared value scaled by a public constant, or added to another
    shared value: every party does all three, on its own shares.

    The fourth is not like the others. `d*e` is a number everybody already knows — there is no
    `[d*e]` to add. Adding a public constant `k` to every party's share gives a sharing of
    `value + parties*k`, which is Week 2's lesson arriving with consequences: at two parties it
    is wrong by exactly `k`, and reconstructing a sharing you built that way still returns
    *something*, just not `A*B`. `add_public` folds into the current party's share and does
    what it is told.
    """
    return ()


# ---------------------------------------------------------------------------
# 6. The whole step
# ---------------------------------------------------------------------------


def prove_product(runtime, relation: dict, halves: dict, triple) -> dict:
    """Reserve, mask, open, multiply — the four stages above, wired together.

    Return `{"A", "B", "C", "d", "e", "tripleId", "roundId", "rounds"}`. `A` and `B` are the
    halves you were handed, unchanged and still shared; `C` is the sharing you just built.

    You choose the round id. Both openings go under the same one, and it should name the
    relation rather than being a constant — two multiplications in the same layer batch
    together, two provers proving different rows do not.
    """
    return {}


# ---------------------------------------------------------------------------
# 7. The artifact
# ---------------------------------------------------------------------------


def proof_artifact(runtime, relation: dict, halves: dict, triple) -> dict:
    """Run the step, and put the result in the shape a next stage would consume.

    ```text
    relationId  which statement this is about
    fieldId     which field its elements live in
    parties     how many shares each sharing holds
    A, B, C     the three sharings, as sharings
    tripleId    which triple was spent
    roundId     which round the openings went out in
    ```

    Those keys and no others.

    The interesting constraint is on `C`. You are one `open` away from a plain integer that
    satisfies `C = A * B` and would look like a perfectly good proof artifact — and publishing
    it hands out a value derived from the witness for no reason, because the next stage of a
    real prover consumes a *sharing*. `d` and `e` are public and belong in the transcript;
    they are not part of the artifact either.

    Metadata is not decoration here. An artifact that does not say which relation, which field
    and how many parties it is for cannot be checked against anything, and a `C` labelled with
    the wrong relation is a valid proof of a statement nobody made.
    """
    return {}


# ---------------------------------------------------------------------------
# 8. The audit
# ---------------------------------------------------------------------------


def privacy_audit(runtime, relation: dict, halves: dict, triple) -> dict:
    """Run the step on this runtime, then report what it recorded.

    ```text
    opened               how many openings happened
    rounds               how many distinct rounds they fall into
    unmasked             openings with no reserved triple mask behind them
    violations           how many violations the runtime recorded
    triplesConsumed      the triple ids spent, in order
    reconstructAvailable whether the runtime you were handed exposes `reconstruct`
    ```

    `unmasked` is the one worth slowing down on. Each opening record carries `maskedBy`: the
    reserved triple shares the runtime found in that opening's ancestry. An empty one means a
    value was published that nothing was hiding.

    There is a shortcut this problem exists to make visible. Open `[A]` and `[B]` directly, and
    you can compute `C` in the clear and re-share it — the result is correct on every seed and
    every shape, and it is the whole witness-hiding property thrown away. The runtime does not
    refuse it. It records it, and it records it here.

    Read the writeup afterwards for what this audit does **not** prove.
    """
    return {}
