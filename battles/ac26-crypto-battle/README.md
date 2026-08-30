# PROVE / LEAK / HUNT -- Advanced Cryptography Battle

> Japanese version: [README.ja.md](./README.ja.md)

| Field          | Value                        |
| -------------- | ----------------------------- |
| Category       | Battle (real-time PvP)        |
| Difficulty     | 4 / 5 (advanced)              |
| Estimated time | 120 min                       |
| status         | `draft`                       |

Your team holds a `secret`, split via **Shamir (t, n) threshold secret
sharing** into `shareCount` shares. Over the course of the match, Contracts
arrive addressed to your team. Every move you make -- reveal a share, attack
another team's exposure, or refresh your own secret -- is a real cryptographic
operation, not a simulated one. Cryptographic correctness is never left to
luck: only a computation that actually checks out moves the score.

## The core loop

- **LEAK** -- complete a Contract by revealing the share(s) it asks for. You
  score immediately. The revealed value is published to the **Public
  Ledger**, permanently, for every team to see. LEAK itself is never
  penalized -- the cost of leaking is not paid now, it is paid *later*, if
  someone collects enough of your shares to reconstruct your secret.
- **HUNT** -- collect `threshold` of another team's shares from the Public
  Ledger, reconstruct their secret via **Lagrange interpolation**, and submit
  the recovered value. If it matches their actual secret exactly, you score
  and they take a penalty. If it does not match -- because you are short a
  share, guessed, or the shares you collected span two different secret
  generations -- nothing happens. There is no partial credit for a plausible
  guess.
- **ROTATE** -- advance your own secret to a new generation. Every share you
  leaked before this point becomes worthless for reconstructing your
  *current* secret: the new generation is an independent, freshly-derived
  polynomial, so mixing old and new shares in a HUNT does not reconstruct
  anything real. ROTATE has a cooldown, so you cannot spam it as a blanket
  defense.
- **PROVE** -- score by demonstrating knowledge of your secret without
  revealing it at all: a non-interactive Schnorr proof, not a direct
  disclosure. It pays exactly what LEAKing the same Contract would. Unlike
  LEAK, nothing that could reconstruct your secret ever goes public -- but
  the proof itself is still posted to the Public Ledger, for audit, so
  anyone can independently replay the check and confirm it actually holds.

## The three lanes

- **Contract Queue** -- the LEAK requests addressed to your team right now.
  Each names which share index(es) it wants revealed, how many points it is
  worth, and a deadline. Miss the deadline and it expires unclaimed.
- **My Vault** -- your team's current secret, this generation's shares, your
  score, and how long until your ROTATE cooldown clears. Nobody else can see
  any of this.
- **Public Ledger** -- every share every team has ever LEAKed, and every
  proof transcript every team has ever PROVEn, in the open, forever. This is
  where a HUNT starts: watch it for another team crossing the threshold of
  exposed shares for their current generation. A PROVE entry, by contrast,
  never carries anything that helps reconstruct a secret.

## Orders and their conditions

Participant-facing copy calls a job an **Order** (Issue #645). The internal
TypeScript type is still `Contract` -- deliberately, so a rename does not churn
every reducer test at the same time as the model grows -- but nothing a
participant reads says "Contract" any more: the word invited a CloudFormation /
smart-contract reading that has nothing to do with this game.

An Order carries a **task** (what it asks for, plus the public payload that
needs), a deadline, a reward, a **privacy constraint**, and the **methods that
satisfy both**.

There are three tasks, and `tick()` rotates them deterministically on a
four-Order cycle rather than rolling for them -- #645's learning progression
only works if a participant actually meets an FHE Order and an MPC Order, and a
probabilistic schedule can leave a short match with neither.

| Task | What it asks | Methods that can serve it |
| --- | --- | --- |
| `reveal-share` | account for this share index | LEAK, PROVE |
| `homomorphic-sum` | add these two ciphertexts without decrypting | FHE |
| `masked-total` | publish your masked subtotal | MPC |

The privacy constraint then narrows that set:

| Constraint | Methods accepted | What the client is saying |
| --- | --- | --- |
| `none` | LEAK, PROVE | Handle it however you like. |
| `no-raw-disclosure` | PROVE / FHE / MPC, per task | Do not publish the underlying value. |

`allowedMethods` is "methods that can perform this task" ∩ "methods that satisfy
this rule". The two-step is deliberate, because it changes what the game can
tell a participant: "this Order does not accept LEAK" is a **rule**, and "LEAK
cannot do this job" is a **fact**, and learning to tell those apart is the point
of #645.

Roughly one share Order in four is `no-raw-disclosure`, derived from the match
seed like every other Order property, so the mix is deterministic and
replayable. FHE and MPC Orders always carry it, and not as a policy choice:
neither method has any way to publish the underlying value, so stating anything
weaker would describe an Order that does not exist. The
constraint is shown on the Order card **before** the method choice, and LEAK is
disabled with a stated reason rather than hidden -- an Order that only revealed
its rule by rejecting a submission would spend the participant's time to teach
them something the card could have said.

`game/src/methods.ts` is the registry the model is built on. `allowedMethods` is
always derived, never authored, so a method added later is offered on exactly
the Orders it legitimately satisfies and excluded from the ones it does not.

`order-mix.test.ts` measures the belt a real match issues rather than asserting
the mix exists: every task kind appears, each within the first handful of
Orders, every Order is fulfillable by at least one method, and both shapes that
teach the contrast are present -- free-choice Orders where LEAK and PROVE are
both reasonable, and constrained Orders where the rule leaves exactly one.

## How FHE Orders work (Phase 2)

`game/src/fhe.ts` is an additively homomorphic cipher over the same prime field
the rest of the Battle uses, with a secret key `k_i` per input:

```text
Enc_i(m; r) = (r, m + k_i*r mod p)      r != 0   (one key per input)
Dec_i(r, y) = y - k_i*r mod p
```

Adding two ciphertexts componentwise gives an encryption of the sum of the
plaintexts. That componentwise addition is the entire participant-facing
operation, and it stays inside §12b's arithmetic (add, multiply, remainder).

**What it hides.** Given `(r, y)` with `r != 0` and no knowledge of `k`, every
candidate plaintext `m'` is consistent -- take `k' = (y - m') * r^-1`, which
exists because `p` is prime and `r != 0`. One ciphertext therefore carries no
information about its plaintext, information-theoretically rather than under a
hardness assumption.

**One key per input, and that is load-bearing.** An earlier revision of this PR
used a single key for both of an Order's inputs and claimed the pair was still
perfectly hiding ("two equations, three unknowns"). That was wrong: with a
shared `k`, anyone can compute `r2*y1 - r1*y2 = r2*m1 - r1*m2`, which pins
`(m1, m2)` to a line -- `p` pairs out of `p^2`. It leaked a relation rather than
a value and never made the Order forgeable, but "looks hidden, is not" is
precisely what this problem teaches people to spot, so the scheme does not ship
with it. With independent `k1`, `k2` the same quantity also carries
`r1*r2*(k1-k2)` and pins nothing.

`fhe.test.ts` now executes the JOINT statement, not only the single-ciphertext
one -- the weaker test is what let the original claim stand -- and asserts the
shared-key relation holds for the old construction and fails for the shipped
one, so the difference is demonstrated rather than described.

Keys are bound to the Order as well as the input index, so nothing a participant
learns about one Order unlocks another.

**Why not a real FHE library.** #645's non-goals rule out competing on FHE/MPC
library performance. What is in scope is computing on data you cannot read with
the judge, not the participant, deciding whether the answer is right. A BFV/CKKS
dependency would add megabytes, a noise-growth failure mode with nothing to
teach at this level, and numbers no participant could check by hand. **This is
not fully homomorphic** -- there is no ciphertext-ciphertext multiplication, and
the participant-facing copy says "add without decrypting", never that FHE can do
anything.

**Why a participant cannot fake an answer.** The judge checks **both**
components: first that the submitted first component is the sum of the Order's
two first components, then it decrypts with the Order's combined mask and
compares against the hidden total (#645's decrypt-and-compare requirement).
The first check is not redundant -- the mask is fixed per Order, so exactly one
`y` is ever accepted, which left `r` free until it was checked, and `(0, y1+y2)`
passed with half the componentwise addition done. Someone who KNEW the expected sum
could submit it directly -- and cannot, because the plaintexts are full field
elements derived from the match seed, making the sum one value out of ~2^61.
Any other route needs the keys.

**One caveat this section cannot claim away.** Everything above assumes the
match seed is unguessable. It is not: `initialState` sets `seed: ctx.eventId`,
`CoordinationContext` offers nothing else, and `eventId` reaches the
participant browser. Since this repository is public, every derivation here is
reproducible by anyone who knows it — the FHE plaintexts and keys included, and
also (predating this work) every team's secret via `deriveTeamGeneration`.
Fixing it needs a server-only per-match secret injected by the platform:
TenkaCloudChallenge#652, blocked on TenkaCloud#3133. Until that lands, treat
the hiding arguments in this file as statements about the *scheme*, not about
the deployed match.

## How MPC Orders work (Phase 3)

`game/src/mpc.ts` is masked secure summation. Three offices share a mask
`m[i][j]` for each ordered pair, and each office publishes

```text
partial[j] = x[j] + SUM(masks received) - SUM(masks sent)   mod p
```

Every mask appears exactly twice -- added by one office, subtracted by another --
so they cancel and the three partials sum to the total. The client learns the
total; no office's number is ever published.

A published partial is consistent with every possible input, because the masks
are uniform and not public, so it carries no information about the input.
`mpc.test.ts` executes that too.

The team's confidential material (its number and its four masks) is derived by
`projectForTeam` **only for the Order's owner** and is never stored, so it
cannot appear on the Public Ledger or in another team's projection by
construction rather than by remembering to redact it.

Scope is summation only -- no Beaver triples. #645 lists Beaver as a candidate;
addition is the vertical slice that carries the idea (compute on data nobody may
see) with arithmetic a first-time participant can follow, and multiplication
would need a new task payload but no change to the Order model.

## The nonce-reuse HUNT (Phase 5)

#645's rule for HUNT is that it punishes misuse, not correct use. The
nonce-reuse HUNT is exactly that shape.

Two of a team's proof transcripts in the same generation sharing a commitment
`R` mean one nonce answered two challenges, which solves for the witness:

```text
z1 = k + e1*w,  z2 = k + e2*w   ->   w = (z1 - z2) / (e1 - e2)   mod q
```

The attacker derives it from the Public Ledger alone (`buildNonceReuseHuntOp`
reads nothing else), and the judge checks `g^w == Y` against the target's public
commitment.

**A human has to be able to do this too, and at first could not.** Each `e` is
`H(domain, teamId, contractId, generation, R, Y)`, and two of those six inputs
reached no participant surface: the ledger row dropped the Order id, and `Y`
was rendered nowhere at all. The maths was documented and the values were not,
so the HUNT was implementable but unplayable. The ledger now carries an Order
column, the Status panel lists every team's `Y`, and the statement names which
column supplies each input. `hunt-playability.test.ts` is the guard: it scrapes
the five values out of the rendered HTML, recomputes both challenges from the
rule the Help Drawer publishes -- re-implemented from that text rather than
imported, so the test also catches the documentation drifting from the code --
solves for `w`, and submits it. `nonce-reuse.test.ts` calls the shipped
helpers and so can never notice this class of gap; §12c says as much.

The prover this Battle ships **cannot** produce that: `schnorr-prover.ts` binds
the nonce to the contract id. So a team using the provided tooling is not
exposed -- and `validateOp` requires the reuse to be on the ledger before it
accepts the hunt at all, so even an attacker who obtained a correct witness by
other means cannot spend it against a team that did nothing wrong.
`nonce-reuse.test.ts` pins both halves.

## How PROVE works

PROVE is a real cryptographic protocol, not a flavor-text alternative to
LEAK -- it is a non-interactive **Schnorr proof of knowledge**, the same
construction taught in `ac26-w3-schnorr`. Completing a Contract with PROVE
instead of LEAK follows three steps:

1. **Derive your witness.** Your team's actual `secret` is never used as an
   exponent directly -- it lives in too small a space for that to be safe
   (see `game/src/schnorr-witness.ts`'s doc comment for why). Instead, hash
   your secret together with your team id and current generation into a
   witness `w` over a 2048-bit group (RFC 3526 Group 14).
2. **Build a proof.** From `w`, construct a Schnorr commitment/response pair
   bound to the specific Contract you are completing -- `game/src/schnorr-prover.ts`'s
   `createProof(secret, generation, teamId, contractId)` does exactly this,
   deterministically (no randomness to leak).
3. **Submit it.** Submitting a valid proof for an open Contract addressed to
   you scores exactly what LEAKing that same Contract would. The proof
   transcript is posted to the Public Ledger so anyone can independently
   re-check it -- but the transcript alone gives an observer nothing they
   could use to reconstruct your secret or a share.

Because the proof is bound to one specific Contract id, it cannot be
replayed against a different Contract; because your witness changes on every
ROTATE, a proof built before a ROTATE stops verifying after one.

## Scoring, in one sentence

LEAK and PROVE pay identically for completing the same Contract -- PROVE is
never worth more just for being the harder path; HUNT only pays out on an
exact, verified reconstruction; ROTATE costs a cooldown but retroactively
devalues every share you leaked before it. The team that plays the tempo
between "score now with LEAK", "score safely with PROVE", and "stay safe
with ROTATE" while reading the Public Ledger for the other team's exposure
wins.

## Learning goals

- Apply Shamir (t, n) threshold secret sharing and Lagrange interpolation
  from both the attacking (HUNT) and defending (ROTATE) sides.
- Understand that revealing a share (LEAK) costs nothing immediately -- the
  cost arrives later, as HUNT risk.
- Verify, executably, that fewer than the threshold of shares reveal nothing
  about the secret.
- Experience how secret rotation invalidates previously leaked shares.
- Build and check a non-interactive Schnorr proof of knowledge (PROVE), and
  see first-hand why it is Fiat-Shamir-bound to one specific Contract and one
  specific secret generation.

## Using the Portal

Once your team is deployed, the Participant Portal shows this Battle through
three panels:

- **Status** -- your Score / Time left / Phase, then the three lanes above
  (Contract Queue / My Vault / Public Ledger), refreshed every 30 seconds.
  The Public Ledger shown there is raw data only -- team id, generation,
  share index and value for a LEAK, or the commitment/response transcript
  for a PROVE -- never a computed "you can reconstruct this now" verdict.
  Reading it is on you.
- **Submit a move** -- one form per move.
  - **LEAK** just needs picking one of your open contracts from a list.
  - **PROVE** needs a `{ commitment, response }` proof, and **HUNT** needs a
    recovered secret. Build both **locally, before you open the form** --
    this repo's `game/src/schnorr-prover.ts`'s `createProof` and
    `game/src/shamir.ts`'s `reconstruct` are the reference implementations
    of that math (see "How PROVE works" above for PROVE's steps). The
    portal never computes either one for you: that local computation is the
    move's actual cost, not busywork the UI could shortcut.
  - **ROTATE** asks for a confirmation before it fires, since it voids every
    currently-open contract addressed to you.
  - A rejected submission shows the reason (e.g. "contract already
    completed", "proof failed verification") -- that is different from an
    infrastructure hiccup, which shows a generic retry message instead.
- **Help** -- the rules above, condensed to one screen inside the portal
  itself, for a quick refresher mid-match.

## After the match: replay and debrief

The match does not end when the clock hits zero. Every LEAK, PROVE, HUNT
success, and ROTATE your team made is still there afterward, in order, with
real timestamps -- a facilitator can walk through it during the debrief
window and point at exactly where things turned: which LEAK is the one that
finally crossed the threshold and made your secret reconstructable, and how
many of your leaked shares a ROTATE actually invalidated. This replay is
built entirely from what already happened during the match -- it does not
show anything that was not already true, and it never reveals a secret or
share value your team did not already leak yourselves. It is a *debrief*
tool, not a live one: it is generated after the fact, not exposed anywhere
in the Portal while the match is running.

## Related files

- [`metadata.json`](./metadata.json) -- problem metadata (source of truth for
  UI / scoring engine)
- [`template.yaml`](./template.yaml) -- the one-page CFn template deployed
  into the competitor account (participant access baseline only -- see
  `OPERATOR.md` for why match state is not per-team AWS infrastructure)
- [`game/`](./game/) -- the pure game model (state / reducer / Shamir
  implementation) this Battle runs on
- [`OPERATOR.md`](./OPERATOR.md) -- organizer-facing architecture and
  implementation roadmap
