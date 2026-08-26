# The signature checked out. That is not the same as the request being allowed

**Track:** `cs-foundations` · **Order:** 10 · **Chapter:** 1. Where trust ends · **Time:** 45–75
minutes · **Points:** 200 · **Required first:** nothing

## The story

An API gateway has been in production for months. It refuses expired tokens. It refuses tokens
whose payload was edited. It refuses actions a token does not carry. Nobody has complained.

Last week, someone in one company opened a document belonging to another company. The request
was logged. The gateway allowed it.

You are handed the gateway's decision log, its signing keys, and its `authorize.py`.

## What a signature check answers

One thing:

> Was this byte string produced by someone holding this key?

That is all. The step from there to "so this request may proceed" is not something the check
said — it is something the reader added. And the moment it is added, the claims **inside** the
token pass unexamined against the facts **outside** it. Such as who owns this document.

The gateway you are auditing passes its public tests and serves ordinary production traffic. Its
authorization decisions can still be wrong.

## The gateway contract

`authorize.py` has to enforce all of these rules:

- A token has exactly three non-empty base64url segments; its header and payload are JSON objects.
- The gateway fixes verification to HMAC-SHA256. The token being verified does not choose a method.
- `kid` selects the same-named entry in `keys`. During rotation, a token made with either held key is genuine.
- Time is valid only for `nbf <= now < exp`, and time claims are integers.
- `action` has to be present in `scope`.
- The token's `tenant` has to exactly match the requested `resource["tenant"]`.
- Unreadable input is denied rather than raised, using the reason order in `authorize.py`'s docstring.

Audit how much of that contract the decision log and starter actually enforce. The list above is
the specification, not the result of the audit.

## The public tests pass the starter

That is not an accident, and it is not a gap to be fixed. It is the exercise.

The public tests cover representative accepted and refused requests; they do not ask every
combination of conditions in the contract. Green means one thing: **nothing is broken within
what the test's author considered.**

Reading code an AI wrote, and reading tests an AI wrote, comes down to the same single question —
what is this test not asking?

## The token

Three base64url segments joined by dots.

```text
<header>.<payload>.<signature>

header   {"alg": "hs256", "kid": "k-417"}
payload  {"sub": "u-3391", "tenant": "t-208",
          "scope": ["read:doc"], "nbf": 1000042, "exp": 1000431}
```

The signature is HMAC-SHA256 over the exact text `"<header>.<payload>"` — the two segments as
they appear in the token, still encoded, with the dot — keyed by the gateway secret named by
`kid`.

`nbf` is the first instant the token is usable. `exp` is when it stops being usable. Those two
sentences do not use the same comparison, and one checkpoint is about which one each gets.

## Participant Portal workflow

1. Start the problem in Participant Portal; the problem editor appears on the same page.
2. Select **Inspect evidence** to read this deployment's token, claims, signing keys and log.
3. Edit `authorize.py` in the Portal editor.
4. Select **Run public tests** and fill the direct-answer fields from the evidence.
5. Submit each checkpoint directly. Portal prepares and sends the current files and answers.

Everything is derived from this deployment's seed. Indices worked out on somebody else's run do
not carry.

## Local workflow

```bash
make build            # build the participant image
make inspect          # this deployment's token, keys and decision log
make test             # the public tests -- which pass the starter
make test-one ID=...  # one public test by name substring
make reset            # restore starter/ to its shipped state
```

Authors and CI only:

```bash
make reference-test   # the hidden suite and the mutation suite, inside the image
```

## Checkpoints

| id | what it asks |
| --- | --- |
| `environment` | the pass phrase the Portal editor prints |
| `window` | the first and last `now` the shown token is accepted at, as `[first, last]` |
| `audit` | the log indices the gateway allowed and should have refused, ascending |
| `verify` | an `authorize.py` that can tell whether this gateway issued the token |
| `isolate` | an `authorize.py` that decides, given a genuine token, whether the request proceeds |
| `generalize` | the finished `authorize.py` |

`verify`, `isolate` and `generalize` all submit the same file. They are separate checkpoints
because they are scored against different hidden phases, not because they take different input.

## Assurance scope

Local mode is **self-paced, honor-system verification**. Someone who owns the Docker daemon and
every container in the compose stack cannot be prevented from inspecting hidden material. The
boundary here is misdelivery, not confidentiality against that person: the Workbench container
you build and run carries the starter and the public tests only — no fixtures, no hidden tests,
no reference solution, no verifier. Those live only in a second, unpublished container the
Workbench reaches over the compose network, and in the author-only image `make reference-test`
builds.

What the verifier does guarantee is narrower and real: a submission cannot hang or crash it,
a checkpoint can only credit the id it echoes, results do not leak expected values, and the
fixtures come from this deployment's seed so a memorized answer does not carry.

That supports self-study and honest practice. It does **not** support competition ranking,
examination, or completion certification — those need a verifier the participant does not
administer, tracked in [#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271).

## What this leads to

"The check passed, therefore it is allowed" recurs through this track in other clothes. A
committed transaction does not mean the state a reader saw was correct. A cache hit does not mean
the value is still true. Same shape of mistake, green tests every time.
