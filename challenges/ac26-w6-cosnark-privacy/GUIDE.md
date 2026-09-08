## Before you start

Use addition, multiplication, division remainders and beginner Python: variables, if, for, functions, lists and dictionaries. Cryptographic terms and every required rule are explained below.

## First action

You audit programs that calculate with secret inputs. All eight return the right answer; some expose the working. Start with **Inspect evidence → compare the allowed output with the records → edit `prover.py` → Run public tests**. Select **Start** first if the environment is not running.

Begin with `classify`: implement the free classification table below and submit that checkpoint. All eight checkpoints grade the same file; there are no direct-answer fields. A public-test PASS checks the return shape; a correct checkpoint submission completes that property. Wrong submissions cost 15 points. Each hint costs 2 points: 24 hints cost 48 total.

```text
Split secret inputs → calculate correctly → what was read or disclosed?
                                              ↓ audit records
                                      report violations → repair
```

## Mechanism and vocabulary

- **Secret sharing** splits a secret among parties. A **share** is one party's data; a **sharing** contains one share per party for one secret. Here, add their numbers and take the remainder after dividing by the prime `p`. Example: `p=7`, shares 2,4,3 give `9→2`. A share's numeric value is different from its string identifier.
- A **party** is a participant program. **MPC** means joint computation with private inputs. **ZK** means proving a claim without revealing its secret. A **co-SNARK** lets several parties jointly produce a proof from distributed secrets. This exercise models its computation and records; it does not produce a real SNARK proof or establish cryptographic security.
- The **witness** is the secret input list `w`. The **relation** describes the calculation using public coefficient lists `a,b`: multiply matching positions and add to obtain A and B, then C=A×B. Keep remainders after division by p. Example: `w=[2,1], a=[1,2], b=[2,1], p=7`: A=4, B=5, C=20→6. That computation is supplied.
- A **mask** is a randomly selected hiding number. A **triple** is a one-use shared set x,y,z with z=x×y. Supplied `beaver_product` opens d=A−x and e=B−y and builds C using one communication round. **Open** means making a shared number readable to all parties; a **round** groups openings and is named by `round_id_for(row)`.
- d alone does not determine A without x. With both, **A=(d+x) % p**, where `%` means Python's remainder. Example A=3,x=5,p=7: d=−2→5; disclosure of d and x gives 5+5=10→3. Checkpoint 6 applies this recovery.
- A **specimen** is one runnable target S1–S8; a **probe** runs it once. The **runtime** provides computation and records. A **capability** is an operation kind: open, reconstruct (recover a shared number), or peek (read a share).
- A **channel** is one of four exits: artifact (output for the next stage), log (work records), metrics (named measurements), error (failure record). A **disclosure** contains those four exits; **evidence** adds operation records; a **policy** defines allowed field names and value shapes.

A `tuple` is a sequence, e.g. `("peek",)`; `None` means no result. `ValueError` signals invalid input and `TripleMisuse` signals triple reuse. Raise an exception with a line such as `raise ValueError("check input")`.

## Free API and record guide

The starter imports the supplied functions. Inspect records rather than specimen source or private `_value` attributes. You do not need to implement the supplied operations.

| Name | Input → result |
|---|---|
| `probe(id)` | One fresh run → evidence |
| `probe(id, malformed_row(evidence.row))` | Run with inconsistent declared row width → failure-path evidence |
| `evidence.runtime.reached()` | In call order: capability, party, operands. Party is the share's owner; operands are identifiers, never values |
| `evidence.runtime.openings()` | In opening order: roundId, shareIds, maskedBy. maskedBy lists reserved mask identifiers |
| `evidence.row`, `evidence.setting` | Row and configuration; setting p is the divisor, parties is the participant count |
| `evidence.disclosure` | artifact and metrics are dictionaries; log is a sequence of records; error is one record or None |
| `serialized(disclosure)` | Replace sharings with opaque string identifiers for an external recipient |
| `is_sharing(value, parties)` | Does the live value contain the specified number of Share objects? |
| `beaver_product(runtime,row,halves,triple)` | Shared A/B plus an unused triple → dictionary with shared A/B/C, d/e and tripleId/roundId |
| `clean_artifact(row,proof)` | Build the output dictionary; this does not publish it |
| `sink.publish(artifact)` | Publish output; other exits use sink.emit(event, **values), sink.metric(name,value), sink.fail(message, **values) |

A log record has `{"event": heading, "values": dictionary}`; an error record has `{"message": heading, "values": dictionary}`. Audit the fields inside values. Heading prose is outside this model's policy.

Inspect shows your setting, row, allowed names, example descriptors and a clean run. Add `print(entry)` or `print(evidence.runtime.reached())` in your function and run public tests to see the actual inputs. Every submission sends the current `prover.py`.

## Checkpoints 1–4: implement the record rules

**1. classify(entry,row) → one class string.** origin is relation/witness/triple/runtime; form is metadata (identifiers), element (integer), share or sharing; audience is everyone/participant/party/verifier (checker). Raise ValueError for vocabulary outside these lists, or opened that is neither None nor a dictionary. Apply the following rules top to bottom; return the first matching class.

| Condition, highest priority first | Class |
|---|---|
| audience is verifier | verifier-only |
| opened exists and satisfies both authorized-opening conditions below | allowed-open |
| origin is relation OR form is metadata | public-input |
| form is share | secret-share |
| form is sharing AND audience is participant | participant-artifact |
| Everything else | secret-intermediate |

**Authorized opening:** maskedBy is nonempty **and** roundId equals `round_id_for(row)`. If the allowed round is `r:mul`, a record with that round and maskedBy=["x"] passes; the same round with maskedBy=[] fails. This is the model's record policy, not a general cryptographic security proof.

**2. capability_audit(probe,id) → tuple of names.** Probe a normal row, then a malformed_row made from its evidence.row. Collect operation names from both runs, remove `PROTOCOL_CAPABILITIES` (only open), deduplicate and sort. Example open,peek,peek → ("peek",).

**3. open_set_audit(evidence) → tuple of dictionaries.** Return every unauthorized opening in original order. Each dictionary has roundId, shareIds converted to a tuple, and masked, a boolean saying whether maskedBy is nonempty. Return () for no violations. Publication itself is not permission.

**4. cross_party_audit(evidence) → {peeks,parties,crossed}.** Count peek records, deduplicate and sort owner IDs, and set crossed when at least two distinct owners appear. Owners 1,0,0 give peeks=3, parties=(0,1), crossed=True. False does not establish that all reads were private; it only reports what this owner-count check can establish.

## Checkpoints 5–6: audit what left the computation

**5. leakage_audit(evidence) → tuple of (channel,field) pairs.** Check all four exits. Report fields not in ALLOWED_NAMES, and fields in SHARING_ONLY_NAMES (A/B/C) whose values fail is_sharing. Deduplicate and sort; no violations gives (). An integer C in artifact yields (("artifact","C"),). Inspect and the supplied constants list the allowed names.

**6. leakage_evidence(disclosure,setting) → {value,from} or None.** This input is already serialized, but is still an object with four attributes `.artifact`, `.log`, `.metrics`, `.error`, not a dictionary. Only the Share entries inside sharings become opaque identifier strings. Visit artifact, log, metrics, error in that order, retaining each dictionary's field order. Return the first violation from which a secret can be recovered. from is its (channel,field) pair. Skip strings and opaque identifier lists.

| Violating value | Recovery, then remainder after division by p | One-digit example, p=7 |
|---|---|---|
| Nonempty list of integers | Add all entries | [2,4,3]→9→2 |
| Integer with integer d in the same record | Value+d | 5 with d=5→10→3 |
| Integer with no integer d in the same record | The integer | 3→3 |

The second case's integer is a mask in this exercise's data. Apply the table from top to bottom. Booleans are not numeric secrets. For serialized A/B/C, a nonempty sequence of string identifiers is the allowed shape. Do not recover from policy-allowed fields. Return None if no violating field yields a secret.

Example with `p=7`: the function receives a `disclosure` with these attributes.

```python
disclosure.artifact  # {"C": ("share:0", "share:1")}
disclosure.log      # ({"event": "working", "values": {"d": 5, "mask": 5}},)
disclosure.metrics  # {}
disclosure.error    # None
```

C is an identifier sequence, so do not recover from it. d is an allowed name. mask is not, and has integer d in the same `disclosure.log[0]["values"]`, so `(5+5) % 7 = 3`. Return `{"value": 3, "from": ("log", "mask")}`. “Same record” means the artifact/metrics dictionary, or the individual log/error record's values dictionary. Never use d from another log entry.

## Checkpoints 7–8: repair and combine the cases

**7. private_prover(runtime,row,halves,triple,sink).** Run the supplied calculation once, return its proof, and publish clean_artifact(row,proof) through the sink. Returned A/B/C and the artifact must describe the same current computation; C must recover to A×B. Identifiers come from the supplied row, triple and round. Exactly d/e are opened in one authorized round; no reconstruct or peek. Optional logs/metrics must obey checkpoint 5. **For an already consumed triple, propagate TripleMisuse and add nothing to any of the four channels.**

**8. transfer.** No new function is needed. Apply your existing audits to unseen implementations combining several documented defects in one execution, on normal and malformed inputs. Only leakage_evidence returns the first recoverable violation; every other audit must return all entries its contract promises. IDs, party count, p, coefficients and violating field names change.

## Scope

Publishing no artifact is not a repair: the next stage still needs usable output. Correct output alone does not establish that operations or failure paths kept inputs private. This model covers recorded operations and the four channels, not unrecorded attribute reads, timing or secrets written into heading prose.
