# The proof was valid. It was a proof about a different account

> An independent, unofficial companion to the Advanced Cryptography Program 2026, not affiliated with or endorsed by its operators. Statements, code and data are independently written.

**Week 6 · 60–90 minutes · 300 points · Prerequisite: ac26-w6-zkvm-exploit-predicate**

## Before you start

Use addition, multiplication, division remainders and beginner Python: variables, if, for, functions, lists and dictionaries. The cryptographic vocabulary and required APIs are introduced below.

## First action and goal

You build a program reporting “I know an input that breaks this account's budget.” Prevent a record about a different account from being used as evidence by binding the inputs to the output.

**Start → Inspect evidence → compare the two collisionPair accounts → edit guest.py/encode_statement → Run public tests → submit encoding.** All eight checkpoints grade the same file; there are no direct-answer fields. Public tests cover shapes and basic behavior; a correct checkpoint verdict completes that item. Wrong answers cost 15 points. Hints cost 2 each: eight checkpoints × three hints = 48.

```text
Public: account, program, arithmetic rules, claim ─┐
Private: the quantity used in the attack ─────────┤ execute independently
                                                ↓
                                Bind public output to all target conditions
                                                ↓
                                  Compare with the expected statement
```

## Real zkVMs and this model

A **zkVM** proves program execution. Its **guest** is the program being run; the **host** supplies its inputs from outside. Real verification checks a proof against an expected program identity: zkVM does not mean an unidentified program. Applications also bind the account and intended claim into public data. [RISC Zero Receipt specification](https://docs.rs/risc0-zkvm/latest/risc0_zkvm/struct.Receipt.html)

Here you implement only the input/output contract in Python. No cryptographic proof is generated or verified. A model receipt is an editable dictionary and must not be trusted as a real proof.

## Vocabulary and data

| Term | Meaning here |
|---|---|
| statement | Public claim with the six fields below |
| witness | Private dictionary: quantity, aux (advisory arithmetic results), search (quantities tried) |
| image | Executable body bytes plus external labels |
| digest / commit | A short deterministic identifier and the supplied function producing it |
| journal | Public output of the guest, designed in checkpoint 5 |
| receipt | {"journal": ...}; this model omits the cryptographic proof |
| profile / semantics | Integer width and overflow behavior |
| transcript / disclosure | Public input records / contents of six output channels |
| canonical encoding | One representation for equal data that distinguishes different data |

bytes is a sequence of numbers 0–255. `text.encode("utf-8")` converts text using the shared UTF-8 rule. `b""` is empty, + concatenates and len(payload) counts bytes. `n.to_bytes(width,"big")` writes an integer in the requested byte count, largest place first: `(3).to_bytes(2,"big")` gives [0,3]. A tuple is a sequence, None means absent, and `raise ValueError("reason")` refuses malformed input.

### Free statement contract

Use exactly STATEMENT_FIELDS in this order: domain, guestVersion, imageDigest, semantics, claim, params.

- domain names the protocol (DOMAINS); guestVersion names the guest version (GUEST_VERSIONS).
- semantics is a SEMANTICS key; claim is in CLAIMS and names budget overflow at multiplication mul or addition add. These fields are strings.
- imageDigest is a string of DIGEST_HEX_LENGTH characters, each in 0123456789abcdef.
- params has exactly PARAM_NAMES: price, spent, budget. All are integers excluding booleans, with `0 < price <= max` and `0 <= spent < budget <= max`, using this statement's own profile.

`SEMANTICS[statement["semantics"]]` contains width, modulus=`2**width`, max=modulus−1 and overflow. A bit is a digit holding 0 or 1; three bits hold 0–7 and wrap at 8. Three bits are only the worked example; read actual widths from the supplied profile.

A small witness shape example follows. aux is advisory: checkpoint 4 recomputes from quantity. search may be a list or tuple. Every integer is in 0..profile.max, excluding booleans.

```python
{"quantity": 3, "aux": {"machineCost": 1, "machineTotal": 2}, "search": [2, 3]}
```

image.body accepts bytes or bytearray (mutable bytes). Normalize either with bytes(body) before hashing. The supplied loader converts hexadecimal JSON strings to bytes before calling your functions.

## Supplied APIs

Imports are already at the top of guest.py. Use named constants instead of copying current values.

| API | Purpose |
|---|---|
| commit(payload,domain) | Digest bytes under a named purpose; image and statement purpose constants differ |
| decode_program(image["body"]) | Tuple of instruction names; ValueError for malformed body |
| is_well_formed(witness,profile) | Supplied check of the witness's three fields and numeric ranges |
| claim_site(statement["claim"]) | Required wrap site, mul or add |
| env.public(name,value) / env.public_inputs() | Supply / read public input fields |
| env.write_private(witness) / env.read_private() | Write the whole private input once / read it |
| env.transcript() / env.writes() | Public input records / private write count |
| env.variable, env.note | Recorded environment variables and notes; never put secrets here |
| env.hints() | Host advice, not trusted execution results |

Inspect shows the current statement, profile, image variants, colliding accounts and allowed public names. Public tests pass them to your functions. Add print(statement) and run public tests to inspect actual input shapes.

## 1–3: name the target and separate inputs

**1. encoding — encode_statement(statement) → bytes**

"1"+"23" and "12"+"3" both give "123". Losing boundaries merges different accounts. Use this exact format:

```text
frame(payload) = len(payload).to_bytes(LENGTH_PREFIX_BYTES, BYTE_ORDER) + payload
text(s)        = frame(s.encode("utf-8"))
integer(n)     = frame(n.to_bytes(INTEGER_BYTES, BYTE_ORDER))
params         = frame(concatenate text(name)+integer(value), in PARAM_NAMES order)
statement      = concatenate in STATEMENT_FIELDS order: the params block, otherwise text(value)
```

frame/text/integer name the format; you may implement them as helpers. The constants specify four length bytes, eight integer bytes, big order. frame(b"ab") yields [0,0,0,2,97,98]. Frame the entire params block as well as each inner name/value. Use the declared order, not dictionary insertion order. Raise ValueError for malformed statements.

**2. identity — image_digest(image) → str**

Decode body to confirm it is executable, then return `commit(bytes(body),IMAGE_COMMITMENT_DOMAIN)`. Ignore external imageId/sourcePath/buildId labels. In this model the body includes a build stamp, so changing stamp bytes changes the digest; changing only an external path does not. This is not a universal description of real zkVM image formats. Refuse a missing or malformed body with ValueError.

**3. ingestion — guest_input(env,statement,witness) → None**

Validate the statement and is_well_formed(witness,profile) first. Supply all six statement fields unchanged as public input. Send all three witness fields together through write_private once. Quantity 3 belongs in private input; recording 3 with env.note leaks it. aux and search are private too. Refuse malformed input with ValueError before writing anything.

## 4: execute without trusting the host's answer

**reexec — run_guest(image,env) → dict**. Read and validate statement and witness. Refuse an image_digest different from statement.imageDigest before execution. Decode instructions from body.

| Instruction | Operation on accumulator, the working number |
|---|---|
| load-quantity | Load quantity |
| mul-price | Multiply the current number by price |
| add-spent | Add spent to the current number |
| guard-le / guard-lt | Set accepted according to current number <= / < budget |

At each arithmetic result above max: wrapping takes the remainder by modulus and records its site; saturating clamps to max; checked sets trapped=True and stops. The failed checked instruction does not count toward steps. Other instructions, including load and guard, each count once. Addition uses the already processed multiplication result.

Example: three bits, price 3, spent 1, budget 4, quantity 3. Multiplication 9 wraps to 1, then 1+1=2 passes the machine guard. Ordinary integer arithmetic gives 1+3×3=10>4.

```text
violated    = spent + price * quantity > budget       # no remainder
claimResult = accepted AND violated AND claimed site belongs to wrapped
```

Return exactly the eight RUN_FIELDS: imageDigest, steps (completed instructions), programSteps (total body instructions), accepted, violated, wrapped (sorted distinct tuple of site names), trapped, claimResult. Four decisions are booleans and two counts are integers excluding booleans. The example gives steps=programSteps=4 and wrapped=("mul",); the mul claim is True. checked stops at steps 1 but programSteps stays 4. Never use aux, search or host hints as computed answers.

## 5–6: bind the output and reject reuse for another target

**5. journal — seal_journal(statement,run) → dict**. Return exactly five fields.

| Field | Value |
|---|---|
| statementDigest | commit(encode_statement(statement),STATEMENT_COMMITMENT_DOMAIN) |
| imageDigest / guestVersion | The statement's matching field |
| claimResult | The run's boolean unchanged |
| measurements | {"steps": run["programSteps"]} |

Publish the total program length: 4 for both wrapping and checked in the example. How far execution progressed depends on private quantity and is not public.

Raise ValueError for malformed statement, missing/extra run fields, nonboolean decisions, noninteger counts, counts violating `0 <= steps <= programSteps`, programSteps<1, wrapped not a sorted distinct sequence of allowed sites, or mismatched imageDigest. The run is an internal record produced by checkpoint 4.

**6. replay — accept_receipt(receipt,statement) → bool**. Return False, never an exception, for malformed input.

The receipt has only journal. The journal has the five fields above. measurements has exactly steps, an integer>=1 excluding bool. Validate statement; recompute statementDigest from the whole statement; match imageDigest and guestVersion; require claimResult to be exactly True. Changing only an account's price changes the statement digest and must be refused.

This function checks no cryptographic seal. Real systems separately verify binding to the expected program and public output. Without an image argument, this function alone also cannot authenticate the actual program length in steps.

## 7–8: audit disclosure and compose the stages

**7. privacy — leak_report(disclosure,statement,image) → tuple**. disclosure is an object with attributes:

| Attribute | Shape |
|---|---|
| .journal | Dictionary of names and values |
| .stdout, .stderr, .trace, .temp | Sequences of {"label":heading,"values":dictionary}: output, error output, execution trace, temporary files |
| .error | None or {"message":heading,"values":dictionary} |

Check journal and each values dictionary. If a value is itself a dictionary, also inspect its immediate child fields in the same channel—one level only. Heading prose is outside the policy. A field violates policy if its name is outside PUBLIC_NAMES; a PARAM_NAMES value differs in integer type or value from the statement; or a MEASUREMENT_NAMES value differs in integer type or value from len(decode_program(body)). Return all (channel,name) pairs sorted and deduplicated, or () for no violations.

Example: public spent 1, stdout.values={"spent":3} → (("stdout","spent"),). An approved name cannot carry a private computed result. This does not certify arbitrarily deep nesting, heading prose or timing as safe.

**8. transfer.** No new function. Check the same seven functions under changed widths, accounts, claims, programs and versions, then connect input→execution→journal→acceptance. Passing individually is insufficient if the handoff shapes or targets differ. Accept the same target, reject another target and keep secrets out of output on failure without fixing IDs or numbers to examples.

## Scoring and operation

| Checkpoint | Points |
|---|---:|
| encoding | 45 |
| identity | 30 |
| ingestion | 35 |
| reexec | 45 |
| journal | 35 |
| replay | 50 |
| privacy | 35 |
| transfer | 25 |

Wrong submissions cost 15 points. The 24 hints cost 2 each, 48 in total. Grading checks behavior and values, not a particular implementation style. Failure messages identify documented properties without disclosing hidden expected values.

The runtime is local Docker Compose. The Participant Workbench holds public materials, starter and public tests, forwarding `/verify` to an internal verifier. Its image does not contain fixtures, hidden tests, reference answers or mutation tests (deliberately broken implementations). Public data is read from the verifier's `/public`. The verifier keeps its checker in the parent process. A restricted Linux worker returns function values and requests Env operations; the parent records the actual input observations and computes the verdict. A worker printing a success record is not grading evidence. A local learner controlling Docker can inspect their own containers; this is a self-study boundary, not secrecy from that owner.

The toy receipt has no cryptographic seal. Real zkVM proof generation/verification, arbitrary output confidentiality, and side channels including timing are out of scope. The changed journal policy tests that private stopping positions do not disclose quantity through this field; it does not prove general program privacy.

No cloud account, AWS resources or Region are used. Local Docker CPU and disk are the resources. `make verifier-down` stops and removes Compose services; locally built images remain.

## Author verification

```sh
make inspect
make test                         # an unfinished starter is expected to fail
make reference-test               # correct answer and deliberately broken implementations
make verifier-down
```

Run `make install && make agent-gate` from the catalog root. [ACCEPTANCE.md](ACCEPTANCE.md) records the actual boundary: real Workbench HTTP routes, native Python, Docker author tests and catalog validation. After the worker boundary migration, Docker `make reference-test` passed 65 logic mutations, three grading probes and twelve execution-boundary tests, including normal reference answers for all eight checkpoints. The migrated nonroot Linux image also passed the real Workbench HTTP first edit, 11 public tests, all eight prepare/proxy submissions and forged-verdict rejection. Each hidden evaluation has a 12-second total budget, below the 15-second upstream request timeout. Rendered browser, Compose deployment and AWS redeployment checks were not run. An API smoke test is not a complete visual playtest.

## Course and note alignment

`courseAlignment` pins `week6/README.md` and `week6/problems/zkvm-exploit/README.md` in `zk-tokyo/advanced-cryptography-2026` to `a3aa4b56fa88fbe803b57d320fbc87c1a203b480`. The borrowed theme is binding initial conditions, the target program and the public claim around execution verification. Numbers, image format, Python APIs and grading are independent work, not copied assignment solutions.

The user's `advanced-cryptography-note/week6/index.html` was also checked for its guest/public-claim and initial-state/output boundaries. Its distinction that a real proof is not implemented is preserved here. As a real-system example, [RISC Zero Receipt::verify](https://docs.rs/risc0-zkvm/latest/risc0_zkvm/struct.Receipt.html) checks the expected image ID and proven journal. It would be incorrect to generalize that a zkVM does not prove which program ran.

### Supported computation imports / 計算用の標準ライブラリ

Supported computation imports / 計算用に使える標準ライブラリ:
array, base64, binascii, bisect, collections, contextlib, copy, dataclasses, decimal, enum, fractions, functools, hashlib, heapq, hmac, itertools, json, math, operator, random, re, statistics, string, struct, time, typing.
Other imports and file/network access are not supported in grading.
採点時は、この一覧以外のimportとファイル・通信操作には対応しません。
