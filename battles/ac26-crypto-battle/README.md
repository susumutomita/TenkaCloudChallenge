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
