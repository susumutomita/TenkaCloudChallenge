"""The only file you edit. Free contract and definitions:

## Before you start

Use signed arithmetic, multiplication, division remainders and Python functions, lists and dicts. Cryptographic components are supplied; the terms and required formulas are defined below.

## First, build the answer table

You are connecting finished encryption components in `pipeline.py`. **Press Start → implement lookup_accumulator using the formula below → submit lut.** A correct submission becomes Solved. Earn this checkpoint first; the full public test run also calls unfinished functions and need not pass yet. Wrong submissions incur the displayed penalty.

## What is being built?

A ciphertext is a group of numbers hiding a message; a secret key recovers it. Your pipeline receives no secret keys. Programmable bootstrapping (PBS) applies a public answer table f to an encrypted bit m and produces an encryption of f(m) with a refreshed error bound. NAND outputs0 only for inputs1,1; otherwise it outputs1. Combining NAND gates builds logic circuits. These small teaching parameters do not establish practical cryptographic security.

```text
input ciphertext → rotation units ────────┐
answer table → coefficient array → hidden rotation
                                      ↓ extract coefficient0
output ciphertext ← switch to input key
```

## Numbers and supplied components

params is a dict: modulus=q is the divisor, degree=N the coefficient count, dimension=n the input mask length, base=B and levels=L give q=B**L, delta=q//8, plaintext_modulus=2. parameterSetId and encodingId name the settings and encoding. Supplied settings have N divisible by4 and q divisible by8. x%q means the remainder0..q−1; // is integer division.

Encoding represents1 as+q/8 and0 as−q/8. At q=8:1→1,0→−1→remainder7. centered rewrites a remainder into the interval from−q/2 inclusive to q/2 exclusive:7 becomes−1. Positive decodes to1; otherwise0.

An LWE ciphertext has mask (a list of numbers) and body (one number). Its phase is body minus the sum of products of corresponding mask and secret-key entries, reduced by q. Example:5−2×1−1×1=2. Phase contains the encoded message plus a small error, called noise. Your functions cannot calculate the phase because they receive no key.

RLWE uses coefficient arrays a,b. [2,3] represents2+3X. The ring is the arithmetic rule X**N=−1: moving a coefficient N positions changes its sign;2N returns it. A mask is the number part used to hide the message. A public answer table can have an all-zero mask: it has no private input of its own.

CMUX selects under encryption: cmux(params,rgsw,ct0,ct1) produces the same message as ct0 for selector0, ct1 for selector1. It need not produce identical ciphertext bytes. bootstrap_key[i] is an RGSW ciphertext encoding key bit i for this selection.

Already imported from participant.fhe: encode(params,bit); normalize(params,coefficients), which makes N reduced coefficients; rotate_ciphertext(params,ciphertext,exponent); extract_sample(params,ciphertext,index); key_switch(params,switching_key,sample); blind_rotation_noise(params); key_switch_noise(params). The last two return bounds on added error.

## Eight checkpoints: free implementation contracts

### 1. lut

lookup_accumulator(params,table,ring_key_id) receives table={0:f(0),1:f(1)} with bit outputs. Return a as N zeros; b has encode(params,table[1]) in the first half and encode(params,1-table[0]) in the second, reduced with normalize. At N=4,q=8,table={0:1,1:1}, b=[1,1,7,7]. The second-half sign is reversed again when read by rotation. Accumulator means this rotating table.



At N=4, the reading positions explain the layout:

```text
bit1 → phase +q/8 → rotation position N/4=1 → read  b[1]
bit0 → phase −q/8 → rotation position7N/4=7 → read −b[3]
                                                 ↑7−N=3
```

Position7 crosses N and therefore negates the stored coefficient. Storing encode(1−f(0)) at b[3] makes its negation encode(f(0)).

### 2. domain

to_rotation_domain applies ((x%q)*(2*N)+q//2)//q%(2*N) to each mask value and body. Halfway ties round upward, then wrap to one full revolution; Python round has different tie behavior. Unit-conversion example:q=8,2N=4,x=3 gives1.5→2.

Each of n+1 roundings contributes at most0.5 rotation unit. Report the integer ceiling noiseBound=(n+2)//2: at n=4,2.5→3. This is the rounding contribution, not a measurement of all input noise.

### 3. rotate

blind_rotate starts current=rotate_ciphertext(params,accumulator,-rotated["body"]). For i in increasing mask-index order: candidate=rotate_ciphertext(params,current,rotated["mask"][i]); current=cmux(params,bootstrap_key[i],current,candidate). Explanation-only key[1,0], mask[2,1], body3 gives total rotation−3+2=−1. Code uses the supplied encrypted selection, never that key.

### 4. relabel

extract returns extract_sample(params,rotated,0)'s mask/body, labelled with rotated's keyId, dimension N and unchanged noiseBound. Rotation deliberately brought the desired coefficient to index0.

switch calls key_switch after compatibility checks. Raise ValueError if sourceDimension differs from len(sample["mask"]), targetDimension differs from params["dimension"], modulus/base/levels differ from params, or sample has a non-None keyId different from sourceKeyId. Omitted/None keyId needs no key-id comparison. For example, a sample labelled keyA cannot use a switch from keyB.

switching_key entries[j][l] encrypt old_key[j]*B**(L−1−l) under the new key, most-significant digit first. Target label and length are targetKeyId/targetDimension. An incompatible key does not guarantee correct decryption.

### 5. evaluate

bootstrap creates the accumulator with ring_key_id=sourceKeyId, converts the input to rotation units, calls blind_rotate, extract, then switch. Supplied keys connect input key→ring key→original input key. The ciphertext is fresh; the output key is the input key. Example:table={0:1,1:0} changes a hidden0 into a hidden1.

### 6. refresh

Every stage returns its numbers with kind (format), keyId (key name), dimension (mask length), modulus (divisor for its units), parameterSetId (params' field) and noiseBound (bound). Let R=blind_rotation_noise(params), K=key_switch_noise(params).

| stage | kind / keyId / dimension / modulus | noiseBound | carriesMessage / messageIs / located |
|---|---|---|---|
| input (trace only) | lwe / targetKeyId / n / q | C | True / m / whole |
| rotation-domain | lwe / input keyId / n / 2N | (n+2)//2 | True / m / whole |
| accumulator | rlwe / ring_key_id / N / q |0| False / None / None |
| blind-rotation | rlwe / accumulator keyId / N / q | R | True / f(m) / coefficient-0 |
| extraction | lwe / rotated keyId / N / q | rotated noiseBound | True / f(m) / whole |
| key-switch | lwe / targetKeyId / targetDimension / q | sample noiseBound+K | True / f(m) / whole |

pipeline_trace returns these six rows in a tuple, with stage strings exactly as above. messageIs and located are the listed strings, except None is Python None. A digest is a fingerprint of the actual intermediate artifact: lwe_digest(sample) or rlwe_digest(params,ciphertext). Execute intermediate stages to record them. Ordinary stage ciphertexts need not contain the trace-only columns or digest.

Without error, bit1 reads the center N/4 of its interval and bit0 reads7N/4. Each lies N/4 rotation units from the nearest interval boundary.

```text
boundary0 ── N/4 ── read position N/4 ── N/4 ── boundary N/2
```

Subtract the maximum rounding displacement(n+1)/2 from that distance. Multiply the remaining distance by q/(2N), the size of one rotation unit in original units. This yields C below.

output_noise_bound(params)=R+K. correctness_bound(params) returns C=int((N/4−(n+1)/2)*q/(2*N)); int discards the fractional part. The bracket is positive for supplied viable settings. Use the original half-unit rounding bound here, not its displayed integer ceiling. A unit-arithmetic example N=8,n=1,q=8 gives int((2−1)*8/16)=0; this tiny example is not a viable circuit setting.

refresh_report returns inputNoise=input_noise, correctnessBound=C, outputNoiseBound=R+K, withinContract=abs(input_noise)<=C, secondPassFits=2*(R+K)<=C. abs removes the sign. The factor2 reserves room for adding two ciphertext errors in the next NAND. Example:C=5,R+K=2 gives2*2<=5, so it fits.

Although the output bound has no input-noise term, input noise still affects the selected position. Outside the contract correctness is not guaranteed; the result does not necessarily flip. Reuse needs matching keys/dimensions AND sufficient error budget.

### 7. nand

nand_combine returns corresponding mask entries(-left-right)%q and body=(delta-left["body"]-right["body"])%q. Different keyId values raise ValueError; input dimensions/settings are supplied matched. Labels: lwe, left keyId, n, q, params' parameterSetId; noiseBound is the sum of input bounds (default0 when omitted).

In units q/8 the phase is1−left−right:

| bits | phase arithmetic | NAND |
|---|---|---|
|0,0|1−(−1)−(−1)=3|1|
|0,1|1−(−1)−1=1|1|
|1,0|1−1−(−1)=1|1|
|1,1|1−1−1=−1|0|

homomorphic_nand passes nand_combine's result through bootstrap with table={0:0,1:1}. The table re-encodes the bit already determined by the sign. Omitting the constant makes0,1 and1,0 land on phase0, where error can change the result.

### 8. transfer

The same pipeline.py must handle new N,n,q,B,L and tables, and implement rounding_counterexample below. Do not hardcode Inspect's values. The public tests' particular table cannot establish all sign, rounding and four-input cases. Compare all four unary tables and all four NAND rows before submitting transfer. Completion means all eight checkpoints are Solved.


## Finish transfer with a counterexample to a wrong bound

A faulty implementation floors its rounding bound to(n+1)//2. Implement rounding_counterexample(params), constructing test numbers whose phase rounding error exceeds it. If n is odd,(n+1)/2 is already an integer, so no such counterexample exists: return None. For even n return a dict with mask/body/secret.

mask and the synthetic binary test key secret have n entries; mask/body are integer remainders0..q-1 and secret entries are integer0/1. These are your own test data, not a stolen key. Supplied settings guarantee n>=1 and q/(2N)>2(n+1), leaving room to construct an even-dimension example.

Compare errors using integers. u(x)=((x%q)*2*N+q//2)//q is rounding BEFORE the final remainder modulo2N. r(x)=q*u(x)-2N*x is the rounding error multiplied by q. Let E be r(body) minus the sum of r(mask[i])*secret[i]. A witness satisfies abs(E)>q*((n+1)//2). Grading computes this independently of your to_rotation_domain.

Example:N=4,n=2,q=64,body=4,mask=[3,3],secret=[1,1]. Body rounds0.5→1; each mask rounds0.375→0. Phase error is+0.5-(-0.375)-(-0.375)=1.25, exceeding the wrong bound1. After multiplication by q,E=80 compared with64. This fixed array cannot handle new dimensions. Construct values from the supplied n,N,q whose errors accumulate in the same direction.

"""

from __future__ import annotations

from participant.fhe import (  # noqa: F401 - the supplied Week 5 stack
    blind_rotation_noise,
    cmux,
    encode,
    extract_sample,
    key_switch,
    key_switch_noise,
    lwe_digest,
    normalize,
    rlwe_digest,
    rotate_ciphertext,
)


# ---------------------------------------------------------------------------
# 1. The lookup table, as an accumulator
# ---------------------------------------------------------------------------


def lookup_accumulator(params: dict, table: dict, ring_key_id: str) -> dict:
    """Build the public table. First half encode(params,table[1]); second half encode(params,1-table[0]); a is N zeros. Attach the accumulator labels from the free statement."""
    return {}


# ---------------------------------------------------------------------------
# 2. The input, in rotation units
# ---------------------------------------------------------------------------


def to_rotation_domain(params: dict, sample: dict) -> dict:
    """Apply ((x%q)*(2*N)+q//2)//q%(2*N) to mask and body. Preserve the key. Report modulus2N and the integer rounding-error ceiling (n+2)//2."""
    return {}


# ---------------------------------------------------------------------------
# 3. Blind rotation
# ---------------------------------------------------------------------------


def blind_rotate(params: dict, bootstrap_key, rotated: dict, accumulator: dict) -> dict:
    """Start rotate_ciphertext(params,accumulator,-body). In index order select current versus rotate_ciphertext(params,current,mask[i]) with bootstrap_key[i]. CMUX preserves the selected message, not identical bytes. Return RLWE labels and blind_rotation_noise(params)."""
    return {}


# ---------------------------------------------------------------------------
# 4. Sample extraction
# ---------------------------------------------------------------------------


def extract(params: dict, rotated: dict) -> dict:
    """Call extract_sample(params,rotated,0). Return mask/body under rotated keyId, dimension N, with unchanged noiseBound."""
    return {}


# ---------------------------------------------------------------------------
# 5. Key switching
# ---------------------------------------------------------------------------


def switch(params: dict, switching_key: dict, sample: dict) -> dict:
    """Reject mismatched sourceDimension, targetDimension versus params["dimension"], modulus/base/levels or a present non-None sample keyId that differs from sourceKeyId, using ValueError. Call key_switch, label targetKeyId/targetDimension, and add key_switch_noise(params). Entries use weights B**(L-1-l), most significant first."""
    return {}


# ---------------------------------------------------------------------------
# 6. The whole thing
# ---------------------------------------------------------------------------


def bootstrap(
    params: dict, bootstrap_key, switching_key: dict, sample: dict, table: dict
) -> dict:
    """Build the accumulator with switching_key sourceKeyId; convert input units; blind_rotate; extract; switch. Provided keys return to the input key. No secret key is supplied to this function."""
    return {}


# ---------------------------------------------------------------------------
# 7. What the pipeline did, and what it refreshed
# ---------------------------------------------------------------------------


def pipeline_trace(
    params: dict, bootstrap_key, switching_key: dict, sample: dict, table: dict
) -> tuple[dict, ...]:
    """Execute and record input, rotation-domain, accumulator, blind-rotation, extraction, key-switch in that order. See the free table for every field. Use lwe_digest(artifact) or rlwe_digest(params,artifact). Input records correctness_bound, not measured input noise."""
    return ()


def output_noise_bound(params: dict) -> int:
    """Return blind_rotation_noise(params)+key_switch_noise(params). An input-independent bound does not make table selection independent of input noise."""
    return 0


def correctness_bound(params: dict) -> int:
    """Return int((N/4-(n+1)/2)*q/(2*N)) at the supplied viable settings. Use the real half-unit rounding bound. Exceeding this contract loses the guarantee; it does not necessarily flip the result."""
    return 0


def refresh_report(params: dict, input_noise: int) -> dict:
    """Return inputNoise, correctnessBound=C, outputNoiseBound=R+K, withinContract=abs(input_noise)<=C, secondPassFits=2*(R+K)<=C. Two outputs are combined by the next NAND."""
    return {}


# ---------------------------------------------------------------------------
# 8. NAND, before the bootstrap
# ---------------------------------------------------------------------------


def nand_combine(params: dict, left: dict, right: dict) -> dict:
    """Reject different keyIds with ValueError. Return mask=(-left-right)%q and body=(delta-left.body-right.body)%q. Add noise bounds (default0). Supplied dimensions/settings match. See the free four-row phase table."""
    return {}


# ---------------------------------------------------------------------------
# 9. HomNAND
# ---------------------------------------------------------------------------


def homomorphic_nand(
    params: dict, bootstrap_key, switching_key: dict, left: dict, right: dict
) -> dict:
    """Call nand_combine, then bootstrap with identity table {0:0,1:1}. The output can feed another gate only when key/dimension and error budget fit."""
    return {}


def rounding_counterexample(params: dict):
    """Construct a synthetic rounding witness as specified in the free contract.

    Odd dimension: return None (no phase error exceeds the floored exact bound).
    Even dimension: return {mask: n remainders, body: remainder, secret: n integer bits}.
    The independently computed absolute phase error must exceed (n+1)//2.
    Settings guarantee n>=1 and q/(2N)>2(n+1). Compare before the final 2N wrap.
    """
    return None
