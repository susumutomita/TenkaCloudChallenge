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
  revealing it at all -- a zero-knowledge-style claim, rather than a direct
  disclosure. Unlike LEAK, a successful PROVE never touches the Public
  Ledger.

## The three lanes

- **Contract Queue** -- the LEAK requests addressed to your team right now.
  Each names which share index(es) it wants revealed, how many points it is
  worth, and a deadline. Miss the deadline and it expires unclaimed.
- **My Vault** -- your team's current secret, this generation's shares, your
  score, and how long until your ROTATE cooldown clears. Nobody else can see
  any of this.
- **Public Ledger** -- every share every team has ever LEAKed, in the open,
  forever. This is where a HUNT starts: watch it for another team crossing
  the threshold of exposed shares for their current generation.

## Scoring, in one sentence

LEAK pays out on completion; HUNT only pays out on an exact, verified
reconstruction; ROTATE costs a cooldown but retroactively devalues every
share you leaked before it. The team that plays the tempo between "score now
with LEAK" and "stay safe with ROTATE" while reading the Public Ledger for
the other team's exposure wins.

## Learning goals

- Apply Shamir (t, n) threshold secret sharing and Lagrange interpolation
  from both the attacking (HUNT) and defending (ROTATE) sides.
- Understand that revealing a share (LEAK) costs nothing immediately -- the
  cost arrives later, as HUNT risk.
- Verify, executably, that fewer than the threshold of shares reveal nothing
  about the secret.
- Experience how secret rotation invalidates previously leaked shares.

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
