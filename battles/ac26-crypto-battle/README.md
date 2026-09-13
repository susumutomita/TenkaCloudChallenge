# Cryptography Battle

[日本語](README.ja.md) · [Try one mission](FIRST-EXPERIENCE.md) · [Operator guide](OPERATOR.md) · [Local preview](dev/README.md)

Solve small cryptography puzzles by hand, then use an opponent's public clues to recover a secret. Choose between calculating an answer and publishing information for an immediate reward. Published information can also help an opponent attack. The highest final score wins.

Bring a browser, paper and a pen. Start with addition, subtraction, multiplication and division remainders; each Order supplies its formulas and examples. The game is designed around four-person teams. The default match lasts 90 minutes, with at most three open Orders per team and three minutes per Order.

## Try it before the match

Open **Try your first mission** on the problem page. Combine two encrypted packages without opening them, and complete one delivery. This practice has no deadline, points or penalties. No cryptography, programming or AWS knowledge is required.

Join an organizer-provided event, or use the [local preview](dev/README.md). This repository is not a hosted public demo. Practice before pressing Ready: an already-running match continues while you read or practise.

## Play one Order

1. Press **I'M READY**. Normally, play starts when every team is ready; the waiting room also offers an explicit start-without-everyone action.
2. Select an **Order card**. Read its task, remaining time and reward; use the formula and inputs in that card.
3. **Calculate, enter the answer and submit.** Check the result and score, then select another Order.

**Missing a deadline normally costs 15 points. Scores never fall below zero.** Explanations and hints do not pause the clock. New Orders arrive at varying intervals; they do not replace an unfinished answer. If three Orders are already open, additional arrivals are skipped until there is room.

The board can switch between **Orders** and **HUNT**, or show them side by side or stacked. Switching preserves unfinished inputs, and the Order list keeps deadlines visible.

![Game flow](diagram.en.svg)

## Calculate or publish

The available actions depend on the Order. Shares are one type of evidence, not the rule for every cryptographic problem.

| Action | Result |
| --- | --- |
| Calculate and submit | Usually +30; some Orders award +45. The card shows the actual reward. |
| **LEAK — publish to answer** | Usually +10 without calculation. The specified information becomes public. Publication-required Orders award their displayed full reward. |
| Open an Order hint | Three steps: mechanism, a small example, then your own numbers. Standard costs are −2, −4 and −8. |
| Miss the deadline | Normally −15, applied once; an unanswered Order does not publish anything. |

Wrong-answer handling varies by method. Read the deduction and retry rule next to the input: some cipher Orders forfeit their later calculation reward after a wrong answer. Reading the free explanations or opening your vault does not cost points or publish data.

## Turn a public clue into a HUNT

**LEAK supplies evidence. HUNT asks for a value you recover from it.** For example, if a Caesar cipher turns 2 into 5 without wrapping, subtract 2 from 5 and submit the recovered shift key, 3. Copying the visible ciphertext is not the attack.

Open **HUNT**, choose an opponent and a method with available evidence, then calculate using the displayed worksheet. Different methods ask for different answers:

| Public evidence | HUNT answer |
| --- | --- |
| Three distinct shares from one team and generation | The original secret |
| A Caesar original/encrypted pair | The shift key |
| Vigenère, which repeats three shift keys: pairs covering all three positions | The three key values |
| Rotor, which uses two moving wiring wheels: original/encrypted pairs | The two initial wheel positions |
| RSA, which encrypts using multiplication and remainders: the public divisor n | Its two distinct prime factors; no LEAK is needed |
| Past reused hiding numbers and a currently sealed RPS hand | The predicted hand |

A share is an index-and-value pair used to distribute a secret. The standard game makes five shares; three different indices from the same secret's group, called a **generation**, reconstruct it. Repeating one index does not count twice.

The HUNT form shows the reward, deduction and remaining attempts for that method. A successful attack can also deduct points from its target; a breach notice tells the target what was recovered. Public records and your private vault are available on demand. The current play area has no ROTATE control.

## What you can explore

New matches mix topics after the first two Orders, so RSA and other later techniques need not wait until the end of the match.

- **Encryption and decryption:** shift symbols with Caesar or Vigenère, follow moving wires with Rotor or the Enigma model, and multiply with remainders using RSA. Decryption recovers the original message.
- **Computing with hidden values:** distribute a secret into shares, combine private inputs without revealing them (MPC), and add ciphertexts without decrypting them (homomorphic addition).
- **Proofs:** demonstrate knowledge of a secret number without sending it (Schnorr zero-knowledge proof), or inspect calculation constraints used in SNARK/STARK proof systems.
- **Signatures:** add points satisfying a particular equation (an elliptic curve), then use that operation in ECDSA to make a signature—a mark on data checked with a key that can be shared publicly.
- **Other ideas:** compare programs whose internal workings should be hard to distinguish (indistinguishability obfuscation, iO), hide an extra message inside an ordinary ciphertext (anamorphic encryption), or seal and reveal a rock-paper-scissors hand.

Encryption and decryption are separate Orders. New anamorphic selection, decryption and probability Orders also complete independently. Schnorr's commitment and response are two steps of one proof, not encryption followed by decryption.

These are small-number teaching models, not secure cryptographic implementations. The [model guide](docs/MODELS.md) explains what each exercise demonstrates and what it omits. Saved older matches can retain different rules and combined worksheets.

## Rock-paper-scissors and optional support

Seal your hand with a hiding number, then give the judge the matching hand and number. The judge publishes openings only after accepting both. Normally a win earns +30, a draw +10 and a loss 0. If you have submitted the required action and only the opponent is blocking progress, expiry gives a forfeit win; leaving your own required action unfinished can still incur −15.

Some endgame teams receive hint support or a one-use calculation multiplier. An optional AWS score-steal exercise is disabled by default. Its settings, limits and costs are in the [operator guide](OPERATOR.md).

## Hosting and development

| Need | Guide |
| --- | --- |
| Plan an event, roles and preparation | [Event-host rehearsal](../../challenges/event-host-rehearsal/README.md) |
| Set deadlines, understand scoring, upgrades and cleanup | [Operator guide](OPERATOR.md) |
| Run and check the real game components locally | [Development preview](dev/README.md) |
| Understand the cryptographic models | [Model guide](docs/MODELS.md) |
| Inspect the problem definition | [metadata.json](metadata.json) |

Runtime and scores use TenkaCloud's existing coordination service. No per-team game server is created. The local preview uses in-memory state and fake authentication; it does not verify official score persistence, live AWS permissions or deployed behavior. See the operator guide for resources, cleanup and verification boundaries.

### Local verification

From the repository root, validate the catalog, game and preview:

```bash
make install
make agent-gate
cd battles/ac26-crypto-battle/game
bun install --frozen-lockfile --ignore-scripts
bun test
bun run typecheck
cd ../dev
bun install --frozen-lockfile --ignore-scripts
bun test
bun run typecheck
```

The full game suite includes long capacity traces. For interactive checks, run `bun run dev` from `dev/`; see the [preview guide](dev/README.md) for scenarios and verification limits.

## Resources and cleanup

- Each team deployment creates a participant viewer IAM role. Enabling the optional item also creates one Standard/String Parameter Store parameter per team. The default Region is `ap-northeast-1`; allow 90 minutes of play plus event preparation.
- The existing platform's API/Lambda calls, score/state storage, logs, hosting and network usage can incur costs. The optional item adds no dedicated Lambda, KMS key or S3 bucket. A zero total bill is not guaranteed.
- After the event, delete the problem stacks through TenkaCloud to remove the roles and parameters; remove the match state and its secret through the platform lifecycle when no longer needed. Shared hosting, logs and storage remain until their own retention or teardown removes them and may continue billing. See the [operator guide](OPERATOR.md) for details.
