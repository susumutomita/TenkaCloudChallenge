"""The only file you edit.

A co-SNARK proves a statement about a witness that **no single prover holds**. The witness is
secret-shared across parties, and the prover computation runs on top of MPC. This problem is
the half of that computation which costs nothing:

```text
A = sum_j a_j * w_j        B = sum_j b_j * w_j        (mod p)
```

`a` and `b` are public. `w` is shared. You never see `w`, you never assemble `w`, and the
result never stops being shared -- `[A]` and `[B]` come out as sharings, one share per party,
because the next stage of a real prover consumes them that way.

## Why this costs zero rounds

An additive sharing of `w_j` is a set of party-held values summing to `w_j`. So

```text
sum_j a_j * [w_j]_party  =  [sum_j a_j * w_j]_party
```

holds for each party **independently**. Scaling by a public constant and adding two shares
held by the same party are both things one party does alone. Nobody sends anything. The next
problem is multiplication, where that stops being true, and the difference between the two is
the reason a co-SNARK's cost is dominated by its multiplications.

## What you are handed

`runtime` is a `ParticipantRuntime`. It has:

```text
runtime.setting              {"p", "parties", "width", "fieldId", "settingId"}
runtime.party_scope(party)   a context manager: inside it, you are that party
runtime.value_of(share)      that party's own value; another party's is refused and recorded
runtime.add(x, y)            [x] + [y], same party
runtime.mul_public(x, c)     c * [x] for public c
runtime.zero()               a share of zero for the current party
runtime.events()             the log: op, party, operand ids, result id -- never a value
runtime.violations()         every refused read, in order
runtime.ancestry(share)      every operand id a result was built from, transitively
runtime.issued(share)        whether this runtime produced that share
```

It does **not** have `reconstruct`. That is the point: the shortcut is missing from the object
rather than discouraged in a comment.

A `Share` carries `party`, `field` and `id` as ordinary public metadata -- read them freely,
they are what a trace is allowed to name. Its value is not metadata.

Run `make inspect` first.
"""

from __future__ import annotations


# ---------------------------------------------------------------------------
# 1. The relation
# ---------------------------------------------------------------------------


def parse_relation(relation: dict) -> dict:
    """Read one R1CS-shaped row and put it in canonical form, or refuse it.

    `relation` arrives as `{"a", "b", "fieldId", "p", "width", "parties"}` -- as delivered,
    not as it should be stored. Return the same keys with `a` and `b` as tuples of field
    elements, and raise `ValueError` for anything that does not describe a row:

    ```text
    a coefficient vector whose length is not width
    a fieldId that does not name the field of p
    width < 1, parties < 2, a non-integer anywhere
    ```

    The part worth slowing down on is what "field element" means. A coefficient may arrive as
    a negative representative -- `-3` is a perfectly good name for an element of `F_97`, and
    it is not the canonical one. Downstream arithmetic reduces mod `p` anyway, so leaving it
    unreduced still produces the right `A` and `B`; it produces a *stored relation* that does
    not compare equal to the same relation written the other way, which is how two provers
    agree they are proving the same statement.
    """
    return {}


# ---------------------------------------------------------------------------
# 2. The shared witness
# ---------------------------------------------------------------------------


def validate_shared_witness(runtime, relation: dict, shares) -> dict:
    """Check the sharing against the relation, without reading a single value.

    `shares[j][party]` is party `party`'s share of `w_j`. Everything you need is metadata:

    ```text
    len(shares) == width                      one sharing per witness position
    len(shares[j]) == parties                 one share per party
    shares[j][party].party == party           party order is not permuted
    shares[j][party].field == fieldId         all in the field the relation declares
    every share id appears once               no sharing reused at two positions
    ```

    Return `{"width", "parties", "fieldId", "shareIds"}`, where `shareIds[j][party]` is that
    share's id. Raise `ValueError` on anything above.

    Do not call `value_of` here. Not because it would be refused -- inside its own party's
    scope it would succeed -- but because validating a *shape* against *labels* needs no
    values, and a stage that reads them has quietly widened what the prover touches. The
    checkpoint counts reads.
    """
    return {}


# ---------------------------------------------------------------------------
# 3. The linear combination, on shares
# ---------------------------------------------------------------------------


def shared_linear_combination(runtime, coefficients, shares) -> tuple:
    """`[sum_j c_j * w_j]`: one share per party, built only from local operations.

    For each party, open that party's scope, start somewhere, and fold in `c_j * [w_j]`.
    Return a tuple with one result share per party, in party order.

    Two things go wrong here and neither announces itself:

    * **the index.** `c_j` multiplies the sharing at witness position `j`. When most
      coefficients are zero it is tempting to walk the non-zero ones and pair them with
      `shares` by position -- which is the same thing only when nothing was skipped.
    * **the party.** Inside party `p`'s scope you may touch `shares[j][p]` and nothing else.
      The runtime records the attempt if you reach further, so this one does announce itself,
      once you look at `violations()`.

    A coefficient of zero is not a special case to skip. Whether you skip it changes the
    log's length and nothing else, which is worth knowing before checkpoint 6.
    """
    return ()


# ---------------------------------------------------------------------------
# 4. Both halves of the row
# ---------------------------------------------------------------------------


def prove_linear(runtime, relation: dict, shares) -> dict:
    """`{"A": ..., "B": ...}`, each a sharing produced by the combination above.

    Parse the relation, check the witness against it, then build both halves. `A` comes from
    `a` and `B` from `b`; they are different vectors over the same shared witness, and
    building the second from the first vector produces two perfectly valid sharings of the
    same wrong statement.
    """
    return {}


# ---------------------------------------------------------------------------
# 5. What the result can be traced back to
# ---------------------------------------------------------------------------


def no_reconstruction_report(runtime, relation: dict, shares) -> dict:
    """Prove the row on this runtime, then audit the results you produced.

    ```text
    issued                whether every result share was produced by this runtime
    singleParty           whether each party's result descends only from that party's inputs
    violations            how many reads the runtime refused
    reconstructAvailable  whether the runtime you were handed exposes `reconstruct`
    width                 the relation's witness length
    ```

    `ancestry(share)` gives every operand id a result was built from, transitively --
    intermediates included. The ids of the input shares are in `shares`, and each of those
    knows its own `party`. Intersecting the two tells you which parties a result actually
    descends from, which is a stronger statement than "the number came out right".

    Read the writeup afterwards for what this audit does **not** prove. It is a real
    property, and it is narrower than "the witness was never assembled".
    """
    return {}


# ---------------------------------------------------------------------------
# 6. What the log says
# ---------------------------------------------------------------------------


def communication_report(runtime, relation: dict, shares) -> dict:
    """Prove the row on this runtime, then report what its log says.

    ```text
    operations   how many events the log holds
    rounds       events flagged `communication`
    messages     the `messages` field summed over the log
    parties      sorted tuple of every party appearing in the log
    localOnly    whether the log records no communication at all
    ```

    Report what the log says, not what you expect it to say. You know the answer for an
    honest run -- that is the whole lesson of this problem -- and a report that asserts it
    instead of reading it is not a measurement. You will be handed a log that disagrees.

    `rounds` and `messages` are different questions. One round can carry many messages.
    """
    return {}
