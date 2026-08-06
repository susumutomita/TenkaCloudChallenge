# validate-problem skill

A [Claude Code](https://github.com/anthropics/claude-code) slash-command skill that play-tests an authored TenkaCloudChallenge problem **from the participant's side of the screen** before its PR — verifying that a solution actually exists on every seed, that the initial visible state does not give the answer away, and that a participant can reach an accepted submission using only the surface the platform really gives them.

> **Two files, two audiences.** [`SKILL.md`](./SKILL.md) is the **agent-facing** validation contract (Claude reads it when the skill runs). This README is the **human-facing** usage guide. The README points at `SKILL.md`; it does not duplicate it.

## Why it exists

"I can solve it in my own shell" and "a participant can solve it from the portal" are different claims, and a problem has shipped where the first was true and the second was not — with every author-side check green. Beyond ordinary code correctness, a *problem* has its own validity conditions: 解が存在するか (a solution exists), 初期状態で答えが見えていないか (the answer is not visible in the initial state), 画面上の操作だけで最後まで解けるか (it is solvable end-to-end from the participant surface). This skill turns those into a runnable checklist: the parts a script can decide are delegated to the existing deterministic gates (`bun run validate`, the solvability audit, `reference-test`, the catalog-wide structural guards), and the part no script can decide — *would a participant who does not know the answer actually get through?* — is run as a spoiler-firewalled blind playthrough by a fresh agent that is forbidden from reading anything the platform would not show a participant.

## How to invoke it (Claude Code)

| Command | What happens |
| --- | --- |
| `/validate-problem <problemId>` | Validates that one problem (`challenges/<id>` or `battles/<id>`): deterministic gates → blind playthrough → leak probe → verdict table. |
| `/validate-problem` | No argument — the skill infers the target from the problem directories changed on your branch, and asks if that is ambiguous. |

Natural-language requests ("play-test my problem", "問題が成立しているか検証して") behave the same way.

The output is a verdict table (E — solution exists / L — no initial-state leak / R — reachable from the participant surface / S — submission path works) with evidence, findings, and an explicit "not verified" list. Paste it into the PR body's Validation section.

## Without Claude Code

The contract is prose, not magic. Run the deterministic half yourself (`bun run validate`, `bun run scripts/solvability-audit.ts --problem <id>`, `make -C challenges/<id> reference-test` where it exists), then have **someone who has not seen the solution** play the problem through `make local PROBLEM=<id>` in a [platform checkout](https://github.com/susumutomita/TenkaCloud) — under the same firewall `SKILL.md` §2b spells out (no `description` field, no `local/app` or verifier source, no `docker exec`). The firewall list is the transferable part: it defines what "playing blind" means precisely enough that any second agent or teammate can do it.

## Scope and boundaries

- ✅ Validating one authored or edited problem before its PR.
- ❌ Scaffolding a new problem — that is [`/new-problem`](../new-problem/README.md).
- ❌ Replacing `make agent-gate` — the gate stays the deterministic completion contract; this skill is the play-test on top of it.

## Related

- [`SKILL.md`](./SKILL.md) — the agent-facing validation contract (phases, spoiler firewall, verdict format).
- [`AGENT.md`](../../../AGENT.md) — §16 (solvability), §10/§12 (player-visible surfaces), the teaching-problem checklist this skill automates the running of.
- `make solvability` / `make solvability-sweep` — the statistical half of "does every checkpoint have an answer".
- [`/new-problem`](../new-problem/README.md) — scaffolds the problem this skill then validates.
