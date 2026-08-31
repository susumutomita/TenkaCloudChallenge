# PROVE / LEAK / HUNT — Cryptography Battle

A real-time Battle about choosing whether to reveal a secret fragment for immediate points or protect it through computation.

## Your first three minutes

1. Pick one blue **ORDER** card.
2. Choose **LEAK** or **PROVE**.
3. After submitting, see what appeared in the Public Ledger.

- **LEAK**: score without computing, but for less -- and publish one secret share.
- **PROVE**: compute it yourself for more; publish no share.
- **Neither**: the Order expires and costs you points. Ignoring one is the worst
  outcome available.

The order is: **do nothing < LEAK and get hunted < LEAK and get away with it <
PROVE**. Every Order card shows both rates side by side, so you can compare them
before you commit.

You do not need every rule up front. The Portal's Practice and help section contains an optional, no-score tutorial with small numbers.

## Goal

Each team's secret is split into five shares. Three distinct shares from the same generation reconstruct it.

- When another team exposes three distinct shares, compute a **HUNT**.
- When your own exposure becomes risky, **ROTATE** into a new generation.
- Score while preventing reconstruction of your current generation.

Repeating one share index still counts as one distinct share. Shares from different generations cannot be mixed.

## Orders arrive six at a time, every five minutes

A batch of six Orders arrives every five minutes and expires after five. **There
is no stockpiling** -- you cannot take next batch's work early, and you cannot
carry this batch's leftovers forward.

More arrive than a team can compute. Which ones you compute, which you pass on,
and what you do with the time left over -- that is the game.

## ORDER types

| What the card asks for | What you do |
| --- | --- |
| reveal a share | choose LEAK or PROVE |
| encrypt with your key | shift each symbol forward by your key (CIPHER), or LEAK |
| encrypted addition | add both pairs component by component, remainder p |
| masked subtotal | compute my number + received masks - sent masks, remainder p |

Every card shows its deadline, points, task, and accepted methods. A method absent from the card cannot perform the task or violates its disclosure condition.

## Moves

| Move | Meaning |
| --- | --- |
| LEAK | let the system answer the ORDER. What becomes public depends on the ORDER |
| PROVE | complete it with a Schnorr proof and publish no share |
| CIPHER | encrypt the symbols with your key and submit. Nothing is published |
| FHE | add ciphertexts without decrypting |
| MPC | submit one subtotal while each office's input stays private |
| HUNT | submit a secret, a reused-nonce key, or a cipher key recovered from public records |
| ROTATE | replace your secret and shares with a fresh generation |

## The cipher ladder

"Encrypt with your key" Orders sit on a **rung**. Exactly one thing changes from
rung to rung: **how many published pairs give your key away.**

| Rung | Pairs that recover the key | The break |
| --- | --- | --- |
| Caesar | 1 | ciphertext − plaintext. One subtraction |

The method is printed on the Order. That is deliberate, and it is how real
cryptography works: the algorithm is public and **only the key is secret**. Every
team knows how every cipher works, and the teams that keep their key are the
teams that survive.

LEAK publishes the symbols **next to** their encrypted form. On the Caesar rung
that single pair is the key. The public record shows how many pairs a team has
out against how many its rung survives, so whether an opponent is already broken
is something you can read off the board.

ROTATE moves your key to a new generation too, and every pair published before it
stops being worth anything.

The complete Portal reference contains the formulas, constants, and runnable Python for PROVE and HUNT. PROVE matches `ac26-w3-schnorr`; share reconstruction matches `ac26-w2-secret-sharing`.

## Reading the screen

1. **Order Belt** — requests you can act on now
2. **MAKE A MOVE** — the action for your selected request
3. **My Vault** — your generation and shares
4. **Public Ledger** — records everyone chose to publish
5. **Next tactic from the public record** — opens only when material exists
6. **Practice and help** — open only when needed

HUNT, reused-nonce HUNT, and ROTATE stay off the fresh first screen until relevant public material exists.

## Data boundary

- The match secret and complete match state stay on TenkaCloud's trusted side.
- The browser receives only `projectForTeam` output.
- A team's vault and Orders are visible only to that team.
- Opponent secrets, un-leaked shares, and the match secret are never projected.
- The Public Ledger contains only artifacts participants chose to publish.

Production hidden values derive from the server-only `matchSecret`, never the public `eventId`. Local-only runs use the explicit non-secret marker `local-play-not-secret:<eventId>`.

## Local UI check

```bash
cd battles/ac26-crypto-battle/dev
bun install --frozen-lockfile
bun test
bun run typecheck
bun run dev                 # http://localhost:5644
```

The harness uses the real reducer and Portal components but fake authentication and persistence. It is useful for UI checks, not evidence of tenant isolation or real AWS E2E.

Game checks:

```bash
cd ../game
bun install --frozen-lockfile
bun test
bun run typecheck
```

## Completion boundary

The release gate is the game/dev test and typecheck suites plus the browser harness running the real Portal components. The harness checks the first move, interaction, and result using participant-visible inputs only. A real-AWS walkthrough and an independent third-party playtest are optional pre-event rehearsals; not running them does not block development or merge.

## Files

- `game/src/reducer.ts` — rules, validation, team projection
- `game/src/types.ts` — state / op / projection
- `coordination/crypto-battle.ts` — platform adapter
- `portal/` — participant UI
- `dev/` — local UI harness
- `OPERATOR.md` — current operating boundary and checks
