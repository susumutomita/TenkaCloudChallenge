# Authoring template — Advanced Cryptography 2026 companion track

Every challenge in this track has the same shape, so a learner relearns the
mathematics and never the tooling. This file is the contract: what the shape is,
what each part has to guarantee, and the order to build it in.

The reference implementation is
[`challenges/ac26-bridge-experiment`](../../../challenges/ac26-bridge-experiment/).
It is a real, complete challenge — read it alongside this file rather than
starting from a blank directory.

Governance (what may be reused from the course) is
[`GOVERNANCE.md`](./GOVERNANCE.md). What counts as evidence of understanding is
[`ASSESSMENT.md`](./ASSESSMENT.md). Where a challenge sits in the curriculum is
[`curriculum.md`](./curriculum.md).

## Scaffolding

```bash
bun run new-course-challenge advanced-cryptography-2026 ac26-w3-field-inverse \
  --week 3 --role mechanism --order 310 --chapter "Week 3 / 有限体と逆元"
```

That copies the reference challenge and renumbers the four things a hand-copy
always gets wrong: the published ports, `track.order` / `chapter`,
`courseAlignment.week` / `role`, and the compose service name plus the Makefile's
`SERVICE`. It leaves a skeleton that passes `bun run validate` immediately — so a
failing validate afterwards is about your content, never the wiring.

What it deliberately does **not** copy:

- **`courseAlignment.sources`.** A pin records "somebody read this version". Copying
  a pin claims a reading that did not happen. Add it after you read the material.
- **checkpoints, fixtures prose, writeup.** They are the design work. A copied
  writeup under a new id reads as authored and is worse than an empty one.
- **shared graph nodes** (`concept.*`, `misconception.*`, `audience.*`). See
  [Education graph](#education-graph).

## Directory shape

```text
challenges/<id>/
├── metadata.json          # single source of truth for scoring, graph, prose
├── README.md              # English, primary
├── README.ja.md           # Japanese mirror (CI enforces the pair)
└── local/
    ├── docker-compose.yml
    ├── Dockerfile         # runs selftest.py + mutations.py at build time
    ├── .dockerignore
    ├── Makefile           # the participant contract
    ├── solution/          # the ONLY thing the participant edits (read-only mount)
    └── app/
        ├── fixtures.py    # seed-derived parameters; public, predict, hidden cases
        ├── harness.py     # `make test` / `make inspect`
        ├── participant.py # loads and runs the submission without trusting it
        ├── verifier.py    # challenge surface + loopback /verify
        ├── selftest.py    # author-side: fixtures well-formed for EVERY seed
        └── mutations.py   # author-side: hidden cases kill every wrong implementation
```

## Participant contract

The same four targets mean the same thing in every challenge in this track:

```bash
make test      # public tests — what you run while iterating
make inspect   # intermediate values and any published trace
make reset     # restore solution/ to its starting state
make shell     # a shell inside the lab container
```

There is no `make reference-test`. The reference lives inside the image and is
never unpacked onto the host.

Two properties are load-bearing:

1. **`make test` must run before anything is implemented**, printing the
   environment marker. That is what separates "the lab is broken" from "I have not
   written it yet". A learner who cannot tell those apart is stuck on the wrong
   problem.
2. **A participant failure is a message, never a traceback.** The submission runs
   from a private temporary copy, so a stack trace points at a path the learner
   cannot open. Route every call through `participant.call_advance`-style
   normalization.

## Ports

```text
challenge surface = 18300 + track.order
/verify           = challenge surface + 1
```

`track.order` values in this track are multiples of ten, so the pair can never
overlap with a neighbour, and the ports are derivable from metadata rather than
looked up in a list somebody has to maintain. `18300` clears `18080/18081`,
`18100/18101`, and `18200/18201`, which existing challenges already use.

The scaffold applies this. If you change `track.order`, change both ports and
`runtime.verifyUrl` with it.

## Networking

One bridge network. **Do not** put a service that publishes a port on an
`internal: true` network — a published port is DNAT'd through a routable network,
so on an internal-only network `127.0.0.1:<port>` silently refuses the connection
and the challenge is unsolvable while looking correctly configured.

If a lab has several services and only a front door needs host access, add a
second `internal: true` network and put the back-end services on that one alone.

Do not claim a submission "cannot phone home" while it sits on a bridge. It can.
What contains a submission is the subprocess timeout, `spawn` isolation, and the
container hardening — say that instead.

## `/verify` contract

```text
POST {"checkpointId": "...", "submission": "..."}
->   {"checkpointId": "...", "correct": bool, "message": "..."}
```

- `checkpointId` is required and is **echoed back**, so a typo is visible instead
  of being scored as a wrong answer.
- An unknown `checkpointId` lists the valid ones. It is a mistake, not a failure.
- A malformed body, a huge body, or a submission that raises must produce a
  `correct: false` response — **never** take the verifier process down. One
  participant's bad input must not end everyone's session.
- The submission runs in a **spawned** subprocess with a hard wall-clock kill.
  `fork` would let the child read the expected values out of the parent's imported
  fixtures.
- The submission is copied into a private temp directory before import, so
  verification never writes to the source tree and a mid-run edit cannot change
  what was executed.
- A failure message may name the *shape* that broke ("this case has a negative
  step"). It must not print the parameters, the expected value, a hidden case, or
  a reference result. A message that narrows the answer turns the checkpoint into
  a guessing game.

## Fixtures and the seed

Everything a participant sees derives from `FLAG_SEED`, injected per deployment.
Hard-coding a value that passed once therefore fails elsewhere, which is the whole
point of the generality checkpoint.

Rules:

- Keep parameters **small enough to reproduce by hand**. A learner who fails a
  hidden case must be able to work it out on paper. These are observability
  parameters; state plainly that they carry no security meaning.
- The predict case must use **different parameters from the public case**, or
  "run it first and copy" defeats the checkpoint.
- If a checkpoint needs a fixture with a specific property (an observable
  divergence, a non-trivial inverse, an overflowing round), **search
  deterministically from the seed for one that has it**, and assert in
  `selftest.py` that the search succeeds across thousands of seeds. A challenge
  that is well-formed for *most* seeds ships a checkpoint with no answer to the
  unlucky remainder, and nobody finds out until a learner is stuck on it.

## Checkpoints

Use `scoring.kind = "multi-verify"`, 2–8 checkpoints, each closable
independently. One checkpoint = one observable outcome. `finish-week3` is not a
checkpoint; `field-inverse` and `group-law-edge-cases` are.

Cover at least **three** of the evidence kinds in `ASSESSMENT.md` — `observe`,
`predict`, `construct`, `counterexample`, `repair`, `transfer`, `misconception`.
An `assignment-companion` challenge must include at least one `predict` or
`counterexample`: those are the two a copied solution cannot satisfy.

Checkpoint labels name **what the learner observes**, never the answer or the
vulnerability. Hints go in three steps — approach, then narrowing, then the
concrete answer as a last resort with the largest penalty. Never write the answer
above the deepest hint.

## Tests, and what each layer is for

| Layer | Runs where | Job |
| --- | --- | --- |
| Public (`make test`) | participant's terminal | Show the API and the minimal happy path. Enough to know what to build; not enough to pass by fitting one value |
| Hidden (`/verify`) | inside the container | Vary the parameters. Include boundaries, degenerate cases, and negatives. Reject anything fitted to the public example |
| Mutations (`mutations.py`) | image build + CI | Prove the hidden cases actually catch the bugs they claim to |
| Selftest (`selftest.py`) | image build + CI | Prove the fixtures are well-formed for every seed, not just this one |

`mutations.py` must assert **both** directions:

1. every wrong implementation is killed by the hidden cases; and
2. **at least one** wrong implementation still passes the public case. If none
   does, the hidden cases are carrying no weight and the challenge does not
   actually test generality.

Both suites run in the `Dockerfile`, so a hole in the hidden cases fails the image
build instead of shipping a checkpoint that hands out points for a broken
implementation.

## Education graph

Node ids are registered **once for the whole catalog** and relations resolve
against that catalog-wide registry (`scripts/knowledge-graph.ts`). This decides
how sharing works, and it is the single easiest thing to get wrong:

| Node kind | Scope | Rule |
| --- | --- | --- |
| `lo.<problemId>.*` | per problem | Always declared locally |
| `assessment.<problemId>.*` | per problem | Always declared locally |
| `concept.*` | catalog-global | **Declared by the challenge that introduces it.** Every later challenge *references* it in a relation and must not re-declare it |
| `misconception.*` | catalog-global | Same as concepts |
| `audience.*` | catalog-global | Same as concepts |

So `concept.beaver-triple` is declared once, by `ac26-w2-beaver-mul`.
`ac26-w6-cosnark-beaver` points at it with a `requires` relation and declares
nothing. Re-declaring it fails `bun run validate` with "node id is duplicated".

Concept ids come from the registry in [`curriculum.md`](./curriculum.md). Adding a
concept means adding it there in the same pull request.

Relation shapes the schema allows:

```text
teaches     problem.<id>  -> lo.<id>.*
covers      problem.<id>  -> concept.*
requires    problem|lo|concept -> problem|lo|concept
assesses    problem.<id>  -> assessment.<id>.*
related_to  any educational node -> any educational node
```

To record which learning objective a criterion evaluates, use `related_to` from
the assessment criterion to the objective — `assesses` is fixed to
`problem -> assessment`.

## Spoiler boundary

`description` is **operator-facing** and may contain spoilers — it is where the
design intent per checkpoint belongs. `instructions` and `shortDescription` are
**participant-facing** and must not spoil anything; CI checks this. Do not delete
detail from `description` to make it "safe"; that is the field where the detail
is supposed to live.

Both languages are required: `metadata.json` carries Japanese, `i18n.en` mirrors
it, and `README.md` (English) / `README.ja.md` (Japanese) are both mandatory.

Every participant-facing surface that names the course carries the disclaimer in
`GOVERNANCE.md` §4.

## Before you open the pull request

- [ ] `bun run validate` passes
- [ ] The container builds — which means `selftest.py` and `mutations.py` passed
- [ ] **Starter state**: `make test` fails with a message, not a traceback, and at
      least one checkpoint cannot be closed
- [ ] **Reference state**: every checkpoint closes through `/verify` from the host
- [ ] A wrong answer, an unknown `checkpointId`, and a malformed body all return
      `correct: false` and leave the verifier alive
- [ ] Changing `FLAG_SEED` changes the fixtures
- [ ] No hidden case, expected value, or reference result appears in any `/verify`
      message, in `make test`, or in `make inspect`
- [ ] Ports follow `18300 + track.order` and match `runtime.verifyUrl`
- [ ] The row is added to `curriculum.md`, and any new concept id to its registry
- [ ] `courseAlignment.sources` reflects material you actually read — or is absent.
      For an unpublished week, pin the placeholder with `kind: "placeholder"` so
      publication is detected (see [`SYNC.md`](./SYNC.md))
- [ ] `status` stays `"draft"` until every checkpoint is closable
