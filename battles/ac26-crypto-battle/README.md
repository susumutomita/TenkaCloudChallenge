# Cryptography Battle

For hint-assisted play, finish one selected Order before opening the next Order's hints. The Caesar ladder and share procedure are kept to that route; the normal five-minute deadline and hint costs are unchanged. See [the reading check](dev/HINT-READING.md) for its measured scope and limitations.

Four optional entries appear above the game: “How to play”, “Cryptography in diagrams and formulas”, “One-digit practice”, and “Rules reference”. They open on a separate scroll surface. Closing returns to the original Order, unfinished answer and page position. An ongoing match keeps running. Practice connects remainders, sharing, reconstruction, publication risk, MPC, ZK, FHE, Caesar and commit-reveal with small numbers. Reading without answering is allowed.
Guided scenes first show a short instruction, calculation and one hole. Steps and reasons are available in a collapsed explanation; answer feedback is one sentence.

The focused workspace groups the current Order, answer methods, scores, disclosure costs and inputs. MPC shows received-mask total, sent-mask total, the expression using the player's input and the remainder step with actual numbers. Results appear above the answer area. Hints, exposure details, records and the vault expand on demand.

The Order list stays visible while answering, with the pending count, task, deadline and selection. Cards appear in deadline order and can be selected directly by click or Tab and Enter / Space. New Orders receive a short arrival notice and a New badge without changing the selected Order or unfinished input. Due soon, Expired and Completed also appear as text. Recent results remain below the list, including earned points for answers confirmed in this screen. Narrow screens and larger queues scroll within the list.

“Cryptography in diagrams and formulas” explanations cover remainders, secret shares, MPC, ZK, FHE, and Caesar shifts in four or five steps: purpose, mechanism, a one-digit worked example, and the live inputs. Each calculation form also opens its relevant explanation locally; the last step copies the current Order’s operands into an unsolved expression. Reading never changes scores or match state and can be closed at any step.

HUNT starts with one card per opponent, showing waiting, ready, completed, or exhausted status for each method. A ready method opens public evidence, formulas and diagrams, answer input, and the attack confirmation. Shares use distinct current-generation indices; sudoku opens a worksheet for reused public tags, leaving the solution to the participant; Caesar uses the rung's pair threshold; RPS needs reuse across two past duels and a current sealed target. ROTATE appears separately as a defence, with the affected open-Order count beside its control. RPS explicitly distinguishes waiting for the opponent to seal from ready to open, disabling the opening button while waiting.

## What is going on

Solve Orders for points and compete for the highest final total. Each Order shows its inputs, accepted methods, points and deadline. Orders requesting a share or encryption also offer an instant answer that publishes information.

A share is an index-and-value pair used in secret sharing. This game creates five shares of a secret; three distinct shares from one generation reconstruct it. Two alone cannot identify it. A generation groups shares made from the same secret.

## The moves

| | What it does | What it costs |
| --- | --- | --- |
| **LEAK** | Publish a share, or an original/encrypted pair, to answer instantly | Public records can supply an opponent's attack |
| **PROVE** | Relabel a sudoku grid and fill four cells | Requires calculation; wrong submissions cost points |
| **HUNT** | Recover a secret, key or hand from public information and attack | Secret, sudoku and hand misses cost points and attempts; an incorrect cipher key is rejected without a charge |
| **ROTATE** | Replace the secret and key with a new generation | Unanswered secret-bound Orders become void and cost points; rock-paper-scissors continues |
| **HINT** | Open one more step of how to solve the Order you have selected | Costs points — and they do not come back if you never solve it |

An ordinary correct calculation earns +30, LEAK earns +10, and expiry costs −15. Check each card for its accepted methods and actual points.

## Cryptographic techniques and the calculation taught here

| Order | Technique | Part explored in this model |
| --- | --- | --- |
| add without decrypting | **Homomorphic encryption** | How ciphertext addition relates to the decrypted result |
| masked subtotal | **Secure computation (MPC)** | Adding masks to private inputs and cancelling them in the total |
| PROVE | **Zero-knowledge proofs (ZK)** | Sudoku relabelling and properties demonstrated by partial checks |

ZK demonstrates correctness while hiding a secret answer. Sudoku is a teaching example; this game's trusted judge knows the original solution. FHE supports computations built from addition and multiplication. This Order explores addition using small numbers. The diagram-and-formula explanations describe the difference from practical systems.

## Goal

Each team's secret is split into five shares. Three distinct shares from the same generation reconstruct it.

- When another team exposes three distinct shares, compute a **HUNT**.
- When your own exposure becomes risky, **ROTATE** into a new generation.
- Score while preventing reconstruction of your current generation.

Repeating one share index still counts as one distinct share. Shares from different generations cannot be mixed.

## Orders arrive six at a time, every five minutes

The opening has one Order. The first batch of six arrives one minute later; further batches arrive every five minutes. Ordinary Orders expire after five minutes and rush Orders after two and a half. Choose which calculations, disclosures and attacks to attempt before their deadlines.

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

The complete Portal reference contains the formulas, constants, and runnable Python for PROVE and HUNT. PROVE is the 4x4 sudoku relabelling the drawer walks through by hand; share reconstruction uses Shamir threshold sharing (distinct from the additive sharing exercise in `ac26-w2-secret-sharing`).

## Reading the screen

Press “I'M READY”. The match starts and Orders arrive when every team is ready.

1. **Current Order** — the request and its remaining time
2. **Answer methods and inputs** — compare score and disclosure cost, then answer in the same card
3. **Result** — score and outcome above the answer area
4. **Exposure, records and vault** — read the summary and expand what you need
5. **Play, diagrams and formulas, practice, rules** — choose one purpose above the board

HUNT always shows each opponent’s public evidence and attack status. A ready method opens its worksheet, with formulas, diagrams and public values for the player to calculate and submit an answer. ROTATE is a separate defence control.

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

## Seal a hand, then play rock-paper-scissors

Choose hand m (1=rock, 2=scissors, 3=paper) and draw a fresh hiding number r
uniformly from 0–10, including zero. Write both down. Read the remainders of 4^m and 9^r after division by 23 from the
free on-screen tables, multiply, and enter the **remainder after division by 23**
in Sealed number. For m=1, r=1: 4×9=36; 36−23=13.

Once both numbers arrive, submit m and r using Give my opening to the judge.
The judge verifies and publishes both openings together. Win +30, draw +10,
loss 0. A mismatched opening can be corrected without a penalty; accepted
commitments and openings cannot be replaced. Work on another Order while waiting.
At the deadline, finishing your required stage earns a forfeit win; an outstanding
required action gets the ordinary expiry penalty. ROTATE does not cancel a duel.

This is a commit-reveal teaching model. Tiny numbers permit alternative openings;
it has no practical binding security. Fairness trusts the judge to withhold both
openings until simultaneous publication. Commit-reveal is not itself a
zero-knowledge proof. Free stepwise explanations and optional fill-in practice
connect the calculation to its purpose.

## Predict an opponent's sealed hand

This tactic becomes available when two different past public rounds show the same
hiding number r. The current RPS answer area shows an optional prediction form beside
your opening control, with those public records, the current sealed c and calculation tables. Assume the same r again,
calculate c for rock, scissors and paper, and submit the matching hand to the judge.
Past repetition does not guarantee the same r in this round. Drawing r uniformly
with replacement can repeat a value by chance. If both hand and r are chosen
independently and uniformly each round, matching a candidate still has only a one-in-three hit rate.

Example: for r=1 the table gives 9. Rock gives 4×9=36→13, scissors
16×9=144→6, and paper 18×9=162→1, taking remainders after division by 23.
For c=6, predict scissors.

Submit once per duel before both hands become public, including while the judge
privately holds only the opponent's opening. You can predict, then give your own
opening; prediction is optional. No held hand or r is shown. Predictions are immutable and private.
After both hands become public, a hit earns 25 points and a miss costs 8 (score floor 0).
The three-attempt limit per opponent generation is shared with share-recovery HUNT.
A timeout without publication cancels the prediction and refunds its attempt.
ROTATE keeps the public RPS history and already submitted predictions.

Confirmed scored Order answers show a short celebration, earned points and the current total; the result remains after the animation ends. Reduced-motion preferences suppress the animation. Incorrect PROVE answers show the penalty. Renaming diagrams connect the selected table to the two sudoku grids; optional concept diagrams distinguish the ZK concept from this trusted-judge teaching model.

### Score history integration

The plugin reports fixed public reason codes for PROVE, CIPHER, LEAK, FHE, MPC, DUEL, HUNT, hints, ROTATE and deadlines. These contain no answers or secrets. With the TenkaCloud #3194 host fix, Score events shows the actual change after applying the zero-point floor. Previously missing history is not reconstructed.

### Endgame hint support (#659 booster)

At the endgame boundary, every team tied for last receives ten minutes without hint penalties. Solo practice does not qualify. The support activates immediately on distribution: later rankings, reloads and ROTATE do not change its recipients or deadline. Defaults distribute it 60 minutes after match start and restore regular penalties at minute 70; an earlier match end also ends the support.

Check “No hint penalty” and its remaining time beside the selected Order's hints, then open a hint and continue the calculation. Order deadlines, issuance and answer scores stay unchanged. If a request arrives after the displayed penalty changes, the hint remains closed and the participant is asked to refresh before opening it.

A legacy match upgraded after the endgame boundary has no saved ranking for that instant. It retains regular hint penalties and displays the reason instead of inventing a past distribution. This increment does not implement lightning or higher cipher rungs.
