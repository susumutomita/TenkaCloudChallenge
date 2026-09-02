# The response vanished. Do not create the payment again

**Track:** `cs-foundations` · **Order:** 50 · **Chapter:** 5. HTTP/TLS protocol boundaries ·
**Time:** 45–75 minutes · **Points:** 200 · **Runtime:** Python standard library + SQLite

## Why this matters

An HTTP timeout does not say that the server did nothing. It says only that the client did not
receive a response in time. The server may have committed the charge and then lost the response.
Blindly retrying can therefore turn one purchase into two charges.

This lab starts with one question the evidence has to answer: what a client holding nothing but a
timeout is entitled to say about the server.

You will repair one synchronous HTTP operation. This is not exactly-once transport: requests and
responses may still be delivered zero, one, or several times. The narrower guarantee is that all
valid attempts for one logical operation produce an **at-most-once business effect**, and retries can
recover the stored result.

```mermaid
sequenceDiagram
    participant C as Client
    participant H as HTTP handler
    participant D as SQLite
    C->>H: POST + Idempotency-Key K
    H->>D: transaction: ledger row + receipt(K, fingerprint, status, body)
    D-->>H: commit
    H--xC: response disappears
    C->>H: same K + same request
    H->>D: read durable receipt K
    D-->>H: original status and body
    H-->>C: exact replay; no new ledger row
```

## Evidence and worked example

The deployment trace records this order for attempt 1:

1. the request arrived;
2. a ledger row committed;
3. the response disappeared before the client received it.

The broken gateway retries the same key and request, commits another row, and returns the second
charge. The trace also records what the client observed at step 3 — a timeout, the only thing the
client had at that moment; steps 1–2 are the server's record, examined afterwards. The `uncertain`
checkpoint asks what the client was entitled to assert from its own observation. The ledger shown
for `audit` lists the same two commits, with the same charge ids as the trace, in commit order
among unrelated rows.

Suppose the first request is key `pay:example` and body
`{"account":"acct-7","amount":4200,"memo":"book"}`. A correct first call might return:

```json
{"status":201,"body":{"chargeId":"ch_1","account":"acct-7","amount":4200,"memo":"book"}}
```

A retry with the same key and the same logical body returns that exact status and body, including
`ch_1`. A retry with key `pay:example` and `amount: 4300` returns:

```json
{"status":409,"body":{"error":"idempotency_conflict"}}
```

Neither retry adds a ledger row.

## Participant-visible contract

Edit `idempotency.py`. It must define:

```python
handle_request(db_path, idempotency_key, request) -> {"status": int, "body": dict}
```

The contract is complete and ordered:

1. `idempotency_key` must be a non-empty string of at most 64 characters using only ASCII letters,
   digits, `.`, `_`, `:`, or `-`. Otherwise return status 400 and
   `{"error":"invalid_idempotency_key"}`.
2. `request` must be an object containing only `account`, `amount`, and optional `memo`.
   `account` is a non-empty string up to 80 characters. `amount` is an integer (not a boolean) from
   1 through 1,000,000. `memo` defaults to `""` and is a string up to 120 characters. Otherwise
   return status 400 and `{"error":"invalid_request"}`.
3. Validate before reserving a key. A 400 response must not create a ledger row or receipt, so a
   later valid request may use that key.
4. Normalize the valid request to exactly `account`, `amount`, `memo`, encode it as compact JSON
   with sorted keys and UTF-8, then use its SHA-256 hex digest as the request fingerprint. Python
   has all required modules in the standard library.
5. For a key with no receipt, one SQLite transaction must create the ledger row and durable receipt.
   The receipt stores the key, fingerprint, response status, and serialized response body.
6. The valid first call returns status 201. Its body has exactly `chargeId`, `account`, `amount`, and
   `memo`. The charge id is stable because it is part of the stored body.
7. The same key and same fingerprint returns the originally stored status and body exactly. It does
   not add a ledger row.
8. The same key and a different valid fingerprint returns status 409 and
   `{"error":"idempotency_conflict"}`. It does not change the ledger or receipt.
9. Concurrent first attempts for the same key and fingerprint must serialize into one ledger row
   and one receipt. A check followed later by an insert is not atomic, and attempts may be handled
   by different copies (workers) of the program, so an in-process lock or dictionary is not a
   serialization either. The statement gives both tools: take the write turn with `BEGIN IMMEDIATE`
   before the receipt read, or let a `PRIMARY KEY` on the key column raise `sqlite3.IntegrityError`
   for the loser, which then rolls back its own transaction and re-reads.
10. The receipt must survive handler/module recreation. A module-level dictionary is not durable.

Expected decision order is invalid key → invalid request → existing key comparison → create. SQLite
operational failures may raise; they must not be converted into a successful receipt or a second
business effect.

## The intentionally incomplete public tests

The shipped starter passes all public tests. They cover one successful request, malformed input,
two different keys, and the output shape. They deliberately do not retry the same key.

The hidden phases add one property at a time:

- `replay`: same key + canonical-equivalent body gives exact replay and one effect;
- `bind`: a different valid body gives 409, and validation does not consume a key;
- `generalize`: concurrent first attempts — 8 threads over 2 copies of the module, driven through a
  deterministic interleave (next section) — a round that mixes in a second key, and a recreated
  handler still give one effect per key and one exact stored response.

This public/hidden gap is the exercise: green example tests do not prove a protocol invariant.

## How the concurrency check works

Previously the `generalize` phase started eight threads behind a barrier and left the interleaving
to the operating system. It never happened: a plain check-then-insert finished its read and its
insert in well under a millisecond and passed on every run, so the anti-pattern rule 9 warns about
was not actually exercised by grading.

The hidden checker now installs a hook around `sqlite3.connect` before the submission is imported
(so `from sqlite3 import connect` is covered too). During a concurrent round every participant
thread parks right after it fetches the result of a SELECT — the moment a check-then-insert has
decided "absent" — and the parked threads are released together once every thread that can still
arrive has arrived, or after a 50 ms stall when the others are blocked inside SQLite. A correct
`BEGIN IMMEDIATE` therefore pays one stall per serialized read and nothing else; a
check-then-insert sees all eight threads read "absent" and then insert. The attempts are spread
over two independent copies of the participant module (`importlib` re-execution of the same file),
the way a gateway spreads requests over worker processes, so a module-level `threading.Lock` does
not serialize them. A second round interleaves two keys, and the restart round re-executes the
module before the retry. Failure messages name the property (one row per key, identical responses,
one receipt, no exception) and echo only the exception's class name; they never contain the hidden
key or payload.

Verified on the author's checkout, ten runs each, both in-process and through the verifier
subprocess: the reference, a textbook `BEGIN IMMEDIATE` in the starter's legacy isolation mode, a
`PRIMARY KEY` + `IntegrityError` route, and a `with connection:` variant pass 10/10; a plain
check-then-insert, an in-process lock, `BEGIN IMMEDIATE` placed after the read, a deferred `BEGIN`,
a constraint whose loser leaks its ledger row, and a constraint without handling fail 10/10. The
same runs were repeated with four suites in parallel to load the CPU. Like everything else in local
mode this is honor-system: the hook lives in the verifier image, and a participant who administers
Docker can read it.

## Participant Portal workflow

1. Start the problem; the editor and evidence controls appear on the problem page.
2. Select **Inspect evidence**. Read the first-attempt trace before editing code.
3. Run the public tests and inspect `idempotency.py`.
4. Fill the direct-answer fields from this deployment's evidence.
5. Submit each checkpoint. Portal sends the current editor file through `/api/prepare` and `/verify`.

The Workbench and hidden verifier are different containers. Only the Workbench is published, on
`127.0.0.1:18350`; it forwards verification over a Compose-internal network.

## Local workflow

These commands require a host terminal with Docker:

```bash
make inspect          # seed-derived response-drop trace and ledger
make test             # public tests; the starter passes
make test-one ID=...  # one public test by name substring
make up               # Workbench on http://127.0.0.1:18350
make down
```

Authors and CI only:

```bash
make reference-test   # reference + hidden properties + 13 killed mutations + verifier near-miss checks
```

## Checkpoints

| id | points | asks |
| --- | ---: | --- |
| `environment` | 15 | copy this deployment's Workbench pass phrase |
| `uncertain` | 20 | give `[requestId, "unknown"]` for the timed-out first attempt |
| `audit` | 30 | list the later ledger indices that duplicated a logical operation |
| `replay` | 35 | implement durable same-key/same-request exact replay |
| `bind` | 40 | bind the key to a fingerprint and reject another request with 409 |
| `generalize` | 60 | keep one effect per key under interleaved concurrent attempts spread over two program copies, and under handler recreation |

## Assurance scope

Local mode is self-paced, honor-system verification. The participant owns the machine, the Docker
daemon, and the image. The normal participant image does not
contain hidden tests, the reference, or mutations; the hidden verifier is a separate image. A
person who controls Docker can still build author stages and inspect them. The separation prevents
accidental delivery, not a malicious host owner. Submissions run with time, memory, process, and
output caps; containers run non-root, read-only, without privileges, and without a masqueraded
outbound network.

It does **not** support competition ranking, examination, or completion certification. Those uses
need a verifier the participant does not administer, tracked in
[#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271).

## What you proved

You did not make HTTP exactly once. You made one logical operation recoverable: after a valid first
commit, a retry either replays its durable receipt or exposes a key/payload conflict. That is a
precise, useful guarantee—and no larger than the evidence supports.
