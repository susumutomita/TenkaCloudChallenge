# PROVE / LEAK / HUNT — Cryptography Battle

## What is going on

Your team holds one secret. It is split into five pieces, and **any three of
them rebuild it. Two tell you nothing.**

Work (Orders) arrives six at a time every five minutes, and ignoring one costs
you points. There are two ways to finish one — **hand over a piece and answer
instantly**, or **compute, and keep the piece**. Hand over three and someone
rebuilds your secret.

That is the whole bet.

## The moves

| | What it does | What it costs |
| --- | --- | --- |
| **LEAK** | Hand over one piece and answer instantly | Fast — but the piece never comes back |
| **PROVE** | Compute, and answer without handing anything over | The piece stays safe — but it costs a calculation |
| **HUNT** | When someone has three pieces exposed, take their points | A wrong secret costs points and one of a few attempts per team and generation |
| **ROTATE** | Remake your pieces. Everything published stops counting | — |
| **HINT** | Open one more step of how to solve the Order you have selected | Costs points — and they do not come back if you never solve it |

The order is **do nothing < LEAK and get hunted < LEAK and get away with it <
PROVE**. Every Order card shows both rates side by side, so you compare before
you commit.

## These are real things

| Order | Technique | Where it runs |
| --- | --- | --- |
| add without decrypting | **Homomorphic encryption** | confidential smart contracts, sealed-bid voting |
| masked subtotal | **Secure computation (MPC)** | MPC wallets, threshold signatures |
| PROVE | **Zero-knowledge proofs** | zkRollups, private transfers |

You will have performed all three by hand by the time the match ends. Caesar
shows up too, but as the way in — **meeting a breakable cipher first is what
makes an unbreakable one worth something.**

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
| show it without showing it | PROVE: relabel your sudoku solution with an unused table and open the line asked for |
| encrypt with your key | shift each symbol forward by your key (CIPHER), or LEAK |
| encrypted addition | add both pairs component by component, remainder p |
| masked subtotal | compute my number + received masks - sent masks, remainder p |

Every card shows its deadline, points, task, and accepted methods. A method absent from the card cannot perform the task or violates its disclosure condition.

## Moves

| Move | Meaning |
| --- | --- |
| LEAK | let the system answer the ORDER. What becomes public depends on the ORDER |
| PROVE | rewrite your 4x4 sudoku solution with a fresh digit-relabelling table and open one line; no share is published |
| CIPHER | encrypt the symbols with your key and submit. Nothing is published |
| FHE | add ciphertexts without decrypting |
| MPC | submit one subtotal while each office's input stays private |
| HUNT | submit a secret, a sudoku solution recovered from a reused relabelling, or a cipher key recovered from public records |
| ROTATE | replace your secret and shares with a fresh generation |
| HINT | open the next step of the selected ORDER's hint ladder. Nothing is published |

## Stuck? — HINT

Every ORDER carries **three hints**. The first says where to look, the second
gives the rule, the third walks the first step. Even after the third, the
calculation is still yours to do.

Each one costs points, and they get more expensive as you climb (**-2 / -4 /
-8**). The price is printed on the button, so you compare before you press.

**Buying all three and then computing the Order still beats passing on it.** But
the charge does not come back if you never answer — the worst hint to buy is one
on an Order you were going to abandon.

Hints never reach the public record. Nobody can see that you bought one.

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

The complete Portal reference contains the formulas, constants, and runnable Python for PROVE and HUNT. PROVE is the 4x4 sudoku relabelling the drawer walks through by hand; share reconstruction matches `ac26-w2-secret-sharing`.

## Reading the screen

1. **Order Belt** — requests you can act on now
2. **MAKE A MOVE** — the action for your selected request
3. **My Vault** — your generation and shares
4. **Public Ledger** — records everyone chose to publish
5. **Next tactic from the public record** — opens only when material exists
6. **Practice and help** — open only when needed

HUNT, reused-relabelling HUNT, and ROTATE stay off the fresh first screen until relevant public material exists.

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
