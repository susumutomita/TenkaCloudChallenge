# The response vanished. Do not create the payment again

**Track:** `cs-foundations` · **Order:** 50 · **Chapter:** 5. HTTP/TLS protocol boundaries ·
**Time:** 45–75 minutes · **Points:** 200 · **Runtime:** Python standard library + SQLite

## Why this matters

An HTTP timeout does not say that the server did nothing. It says only that the client did not
receive a response in time. The server may have committed the charge and then lost the response.
Blindly retrying can therefore turn one purchase into two charges.

This lab makes one leap visible:

> “I did not receive the response” does **not** imply “the operation did not happen.”

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
charge. Immediately after step 3, the client-visible state is **unknown**: created and not-created
are both compatible with a timeout.

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
   and one receipt. A check followed later by an insert is not atomic.
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
- `generalize`: concurrent first attempts and a recreated handler still give one effect and one
  exact stored response.

This public/hidden gap is the exercise: green example tests do not prove a protocol invariant.

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
make reference-test   # reference + hidden properties + six killed mutations
```

## Checkpoints

| id | points | asks |
| --- | ---: | --- |
| `environment` | 15 | copy this deployment's Workbench pass phrase |
| `uncertain` | 20 | give `[requestId, "unknown"]` for the timed-out first attempt |
| `audit` | 30 | list the later ledger indices that duplicated a logical operation |
| `replay` | 35 | implement durable same-key/same-request exact replay |
| `bind` | 40 | bind the key to a fingerprint and reject another request with 409 |
| `generalize` | 60 | keep one effect under concurrency and handler recreation |

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
