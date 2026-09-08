"""Edit only this file. Start with parse_relation, then submit relation.

Use supplied objects only within the current call, through the documented public API.
Do not retain them for another call or access private share/runtime state.

A witness is a list of secret values w[j]. A party is one holder, numbered from 0.
Secret sharing splits each value into shares whose sum, after division by prime p,
has remainder w[j]. Python writes that remainder as %. A field is the collection
of numbers used with this remainder arithmetic; its name here is "F" + str(p).

A co-SNARK lets several holders jointly construct a short, checkable proof without
one prover holding the whole witness. This exercise implements its linear preparation
only, not an actual SNARK proof. Linear means multiply by public numbers and add:

    A = (a[0]*w[0] + a[1]*w[1] + ...) % p
    B = (b[0]*w[0] + b[1]*w[1] + ...) % p

Each holder calculates on its own shares. Distributivity c*(x+y)=c*x+c*y explains
why their answers add up correctly. With p=7, shares (5,6,0) represent 4; multiplying
by public 3 gives (1,4,0), representing 5, also (3*4)%7. Share preparation is supplied
and outside this stage's communication count. Return result shares, not their sum.

runtime is the supplied calculation tool:
    runtime.setting             dict: p, parties, width, fieldId, settingId
    with runtime.party_scope(party):  run indented lines as this holder
    runtime.zero()              this holder's share of zero
    runtime.mul_public(share,c) multiply by public c, including the remainder
    runtime.add(left,right)     add same-holder shares, including the remainder
    runtime.events()            all operation dictionaries so far (the log)
    runtime.violations()        refused value-read records
    runtime.issued(result)      whether this tool issued the result
    runtime.ancestry(result)    input/intermediate ids used to build the result

Share.party, .field, .id are labels and may be read freely. No submitted function
needs runtime.value_of, which reads a value and refuses another holder's share.
The normal runtime has no reconstruct method. This is an instrument for checking
recorded computation, not proof that a person never read secrets through another route.
Inspect evidence prints labels and a public operation example, not share values;
public tests use separate public practice values.

Each checkpoint submits the current whole file. A pass shows Solved; a failure
reports a property to fix. Public tests are partial checks, and unfinished later
functions may still fail while the first checkpoint is already Solved.
"""

from __future__ import annotations

# Supplied helper, not part of your implementation: field_id(7) is "F7".
from participant.mpc import field_id


def parse_relation(relation: dict) -> dict:
    """Return the same six keys: a, b, fieldId, p, width, parties.

    p/width/parties and every coefficient must be integers, not bools. Require
    p >= 2, width >= 1, parties >= 2, fieldId == field_id(p). A supplied integer
    p >= 2 is prime; no primality algorithm is required. a and b must be lists
    or tuples of length width. Raise ValueError for a violation of these rules.

    Store each coefficient as c % p in a tuple: this is canonical form, the common
    spelling in 0..p-1. Example p=7: [-1,9] becomes (6,2). Negative or large
    coefficients are valid inputs; strings and True/False are not coefficients.
    """
    return {}


def validate_shared_witness(runtime, relation: dict, shares) -> dict:
    """Check labels only, on a canonical relation; raise ValueError on a mismatch.

    shares[j][party] is witness position j, holder party. Outer/inner containers
    must be lists or tuples with lengths width/parties. Each share's .party
    equals its inner position; .field equals fieldId; every .id is unique across
    all positions. Input Share objects supply these labels. For width=2,
    parties=2, ((u0,u1),(v0,v1)) has four distinct ids, but reusing (u0,u1)
    in both rows is invalid even though its shape is 2 by 2.

    Return width, parties, fieldId, shareIds. shareIds is a tuple of tuples in
    original order. Do not read values or do arithmetic: the read count and
    operation-log length must stay unchanged.
    """
    return {}


def shared_linear_combination(runtime, coefficients, shares) -> tuple:
    """Return one result share per holder, in holder order.

    For party in range(runtime.setting['parties']), enter
    with runtime.party_scope(party): and start total = runtime.zero().
    For each original position j, use runtime.mul_public(shares[j][party],
    coefficients[j]), then runtime.add(total, scaled) to update total.
    Return the holders' results as a tuple. The arithmetic tools take remainders.

    Zero coefficients may be skipped only while preserving original j. All zeros
    must still return a zero share per holder. Do not compact coefficients then
    pair them with shares at the compacted positions. Use local operations only.
    """
    return ()


def prove_linear(runtime, relation: dict, shares) -> dict:
    """Parse, validate labels, then compute separate sharings for A and B.

    Use parse_relation, then validate_shared_witness. Apply
    shared_linear_combination to parsed['a'] for A and parsed['b'] for B.
    Return {'A': A_shares, 'B': B_shares}. Example w=[3,4], a=[1,0], b=[0,1]
    means A represents 3 and B represents 4; they are not interchangeable.
    """
    return {}


def no_reconstruction_report(runtime, relation: dict, shares) -> dict:
    """Run prove_linear, then report these five fields from the actual results.

    issued: all A/B result shares were issued by runtime.issued(result).
    singleParty: for issued results, no ancestor input belongs to another holder.
    violations: len(runtime.violations()), including earlier refused reads.
    reconstructAvailable: hasattr(runtime, 'reconstruct'); do not call it.
    width: the parsed relation's width.

    Map input .id to .party, then match runtime.ancestry(result) against those
    ids, ignoring intermediate-result ids. A party-0 result using u0 (owner 0)
    and intermediate t1 is fine; also using v1 (owner 1) makes singleParty False.
    No input ancestors is valid for a zero combination. An unissued result sets
    issued False and is excluded from singleParty's ancestry test.

    hasattr(obj, name) checks whether a named attribute exists. The report proves
    recorded origin only, not that nobody ever assembled the witness elsewhere.
    """
    return {}


def communication_report(runtime, relation: dict, shares) -> dict:
    """Run prove_linear, then count the whole runtime.events() log, including old rows.

    operations: number of rows.
    rounds: number of rows with communication=True (one round per flagged row).
    messages: sum of each row's messages, default 0 when the field is absent.
    parties: tuple of distinct party values in the log, in increasing order.
    localOnly: no row has communication=True.

    A log is a record; each dictionary row is an event. Example rows ordered as
    (communication,messages,party): (False,0,0),(True,3,1),(True,0,1) give
    operations=3, rounds=2, messages=3, parties=(0,1), localOnly=False.
    A flagged round with zero messages still counts. Read actual records rather
    than returning the expected zero-communication answer for local arithmetic.
    """
    return {}


def sparse_counterexample(p: int, width: int) -> dict:
    """Construct a public counterexample for transfer; no secret input is used.

    A counterexample is an input that makes a claimed-correct method fail.
    Given prime p >= 5 and width >= 2, return {'a': ..., 'w': ...}, each a list
    or tuple of width integers in 0..p-1 (not bools). At least one zero in a
    must occur before a nonzero coefficient.

    Correct: sum(a[j] * w[j] for j in range(width)) % p.
    Faulty: remove zeros from a, call the result compact, then compute
    sum(compact[k] * w[k] for k in range(len(compact))) % p.
    Your two results must differ. The fault shifts only coefficients, not w.

    Example p=7, a=[1,0], w=[2,4] gives 2 either way, so is NOT a counterexample.
    Choose positions and values that expose the shift; make both lengths follow
    width. The earlier functions must also pass in unseen settings for transfer.
    """
    return {}
