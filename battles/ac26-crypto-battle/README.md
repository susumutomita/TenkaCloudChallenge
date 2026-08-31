# PROVE / LEAK / HUNT — Cryptography Battle

A real-time Battle about choosing whether to reveal a secret fragment for immediate points or protect it through computation.

## Your first three minutes

1. Pick one blue **ORDER** card.
2. Choose **LEAK** or **PROVE**.
3. After submitting, see what appeared in the Public Ledger.

- **LEAK**: score without computation, but publish one secret share.
- **PROVE**: compute a proof for the same score; publish no share.

You do not need every rule up front. The Portal's Practice and help section contains an optional, no-score tutorial with small numbers.

## Goal

Each team's secret is split into five shares. Three distinct shares from the same generation reconstruct it.

- When another team exposes three distinct shares, compute a **HUNT**.
- When your own exposure becomes risky, **ROTATE** into a new generation.
- Score while preventing reconstruction of your current generation.

Repeating one share index still counts as one distinct share. Shares from different generations cannot be mixed.

## ORDER types

| What the card asks for | What you do |
| --- | --- |
| reveal a share | choose LEAK or PROVE |
| encrypted addition | add both pairs component by component, remainder p |
| masked subtotal | compute my number + received masks - sent masks, remainder p |

Every card shows its deadline, points, task, and accepted methods. A method absent from the card cannot perform the task or violates its disclosure condition.

## Six moves

| Move | Meaning |
| --- | --- |
| LEAK | publish the requested share and complete the ORDER |
| PROVE | complete it with a Schnorr proof and publish no share |
| FHE | add ciphertexts without decrypting |
| MPC | submit one subtotal while each office's input stays private |
| HUNT | submit a secret or reused-nonce key recovered from public records |
| ROTATE | replace your secret and shares with a fresh generation |

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
