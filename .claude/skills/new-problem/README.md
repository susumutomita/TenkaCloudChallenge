# new-problem skill

A [Claude Code](https://github.com/anthropics/claude-code) slash-command skill that scaffolds a brand-new TenkaCloudChallenge problem — copying the closest starter, filling in `metadata.json`, writing `template.yaml` with the required IAM baseline / tags / URL-registration gate, validating, and opening a PR.

> **Two files, two audiences.** [`SKILL.md`](./SKILL.md) is the **agent-facing** instruction sheet (Claude reads it when the skill runs). This README is the **human-facing** usage guide. The README points at `SKILL.md`; it does not duplicate it — `SKILL.md` stays the single source of truth for the authoring contract.

## What it does

Given a category (Challenge or Battle) and a scoring kind, the skill walks the 6-step authoring flow and leaves you with a validated problem directory plus a draft PR. It bakes in the things that have broken problems before — the `ParticipantViewerRole` access baseline, the `TenkaCloud:NamePrefix` tag on every EC2 resource, the empty-URL Outputs that stop a bare deploy from auto-scoring, and `publicHint: false` so the portal timeline does not leak spoilers.

It is for **new** problems only. To edit an existing problem, read [`AGENT.md`](../../../AGENT.md) and edit the files directly — do not invoke this skill.

## How to invoke it (Claude Code)

| Command | What happens |
| --- | --- |
| `/new-problem challenge` | Category is fixed to **Challenge** (self-paced, single flag). Scoring kind defaults to `flag`; the skill asks you to confirm. |
| `/new-problem battle` | Category is fixed to **Battle** (real-time PvP / continuous scoring). The skill then asks which scoring kind — `uptime-flat`, `uptime-multi`, `phased-polling`, or `attack-detection`. |
| `/new-problem` | No argument — the skill asks "Challenge or Battle?" first, then continues as above. |

Natural-language requests behave like the no-argument form: "add a new problem", "create a new Battle", "scaffold a Challenge" all trigger the skill and start by asking the category.

After the category and scoring kind are settled, the skill gathers the rest interactively (slug, concept, difficulty, estimated duration), generates the scaffold, and helps you open the PR.

## Without Claude Code

The skill is a convenience wrapper around a procedure that is fully documented in prose — you do not need Claude Code to author a problem.

- **Manual path.** Follow the 6 steps yourself. They are written out in two places: the **"The 6 steps (manual / non-Claude-Code path)"** section of [`AGENT.md`](../../../AGENT.md), and in more detail under *Step 0 – Step 6* of [`SKILL.md`](./SKILL.md). Start by copying the closest starter (`challenges/hello-world` for a `flag` Challenge, `battles/hello-world-battle` for an `uptime-flat` Battle), then edit `metadata.json` and `template.yaml`.
- **Codex CLI (or another agent).** [`AGENT.md`](../../../AGENT.md) is the shared contract for any agent, not just Claude Code. Hand it a plain natural-language task ("scaffold a new uptime-flat Battle about …") — the `/new-problem` slash form is Claude-Code-specific and invisible to Codex, but the underlying steps are the same.

Either way, finish with `bun run validate` and one problem per PR.

## Scope and boundaries

- ✅ Scaffolding a **new** problem directory under `challenges/` or `battles/`.
- ❌ Editing an **existing** problem — read [`AGENT.md`](../../../AGENT.md) and edit in place instead.
- ❌ Platform changes (new scoring kinds, new portal slots) — those live in the [TenkaCloud platform repo](https://github.com/susumutomita/TenkaCloud); discuss them in an Issue first.

## Related

- [`SKILL.md`](./SKILL.md) — the agent-facing authoring contract (design bar, 6 steps, footguns).
- [`AGENT.md`](../../../AGENT.md) — repo invariants the validator enforces, plus the manual 6-step path.
- [`SCHEMA.json`](../../../SCHEMA.json) — JSON Schema for `metadata.json`.
- [`challenges/net-evo-01-reachability`](../../../challenges/net-evo-01-reachability/) — reference implementation (Internet Evolution Ep01): discovered flag, fix-by-settings, cheap real resources.
- `bun run validate` — run before every PR; it rejects missing tags, missing IAM baseline, and metadata/Output mismatches.
