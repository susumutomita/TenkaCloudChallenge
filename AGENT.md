# AGENT.md — Authoring guide for TenkaCloudChallenge

> Audience: anyone (human or AI agent) writing a new problem or modifying an existing one. Read this once before opening your first PR.

This repo is the OSS catalog for the [TenkaCloud](https://github.com/susumutomita/TenkaCloud) platform. One directory under `battles/` or `challenges/` = one problem. The platform mounts this repo as a submodule, bundles each problem's `template.yaml` into a CloudFormation deploy, and renders the rest (scoring, portal UI, disruption scheduling) generically from each problem's `metadata.json`.

You can ship a new problem with a PR to **this repo alone** — no platform-repo changes. But the platform trusts the catalog to follow a small set of invariants. Break them and the participant experience breaks silently. This document is those invariants.

## Before anything: the design bar (fun, not a drill)

A competition problem is only worth shipping if a player would call it *fun*, not homework. Aim for four properties: a **discovered flag** (a random per-deploy value earned by performing the intended AWS operation, never a concept name typed from memory), **fix-by-settings** (the template deploys a broken resource and the solve *modifies* it — players never create top-level resources, so `delete-stack` leaves no orphans), a **real "aha"** (a production skill felt viscerally, like `curl` that hangs vs refuses), and **story with stakes**. Full rationale + two worked archetypes are in the [`new-problem`](./.claude/skills/new-problem/SKILL.md) skill; the reference implementation is [`challenges/net-evo-01-reachability`](./challenges/net-evo-01-reachability/) (Internet Evolution Ep01). The invariants below are the floor; the design bar is the target.

## The 60-second mental model

```
metadata.json   ── source of truth: catalog UI, scoring engine, portal wiring
template.yaml   ── single-page CFn deployed into each team's AWS account
portal/*.tsx    ── optional: problem-specific dashboard panel plugins
services/       ── optional: docker-compose / Lambda code your template pulls
README.md       ── human-facing (English primary, README.ja.md mirror)
```

Each team gets their own CFn stack with a `NamePrefix` like `tc-<problemSlug>-<teamSlug>`. **Every per-team resource carries that prefix** in its name and in a tag, so the participant's read-only IAM role can find their own stuff (and only their own stuff) inside a shared AWS account.

## Required invariants — enforced by `bun run validate`

These are not style preferences. The validator rejects PRs that break them.

### 1. `metadata.json` matches [`SCHEMA.json`](./SCHEMA.json)

JSON Schema validation. The schema's `description` fields explain each property; read them. Keep top-level fields in Japanese and put English under `i18n.en` (the platform's locale fallback chain is `en → ja → top-level`).

### 2. CFn Outputs referenced by `metadata.json` actually exist

`scoring.flagOutputKey`, `scoring.statsOutputKey`, every `endpoints[].default.key` must appear as a key under `Outputs:` in `template.yaml`. Typos here look fine until the scoring engine silently produces zero points.

### 3. `dashboard.slots.*` files exist

If you declare `dashboard.slots.StatusPanel: portal/StatusPanel.tsx`, that file must actually be in the problem directory.

### 4. `ParticipantViewerRole` carries the participant access baseline

Every problem ships an IAM role named `${NamePrefix}-participant-viewer` that the platform AssumeRoles into for each team. That role **must** include:

- `arn:aws:iam::aws:policy/SignInLocalDevelopmentAccess` in `ManagedPolicyArns` — without it, the `aws login` (2025-11) OAuth2 flow returns HTTP 400.
- An inline policy statement granting these 7 CloudShell actions on `Resource: "*"`:
  `cloudshell:CreateEnvironment`, `cloudshell:CreateSession`, `cloudshell:GetEnvironmentStatus`, `cloudshell:StartEnvironment`, `cloudshell:StopEnvironment`, `cloudshell:DeleteEnvironment`, `cloudshell:PutCredentials`.

`Resource: "*"` is unavoidable for CloudShell because environments are per-identity; the 7-action allow-list is the least-privilege equivalent of `cloudshell:*`. Both items have an anchor comment in each template — do not move or remove them.

### 5. EC2 network resources carry `TenkaCloud:NamePrefix` tags

Every `AWS::EC2::{VPC,Subnet,InternetGateway,RouteTable,SecurityGroup,Instance}` resource must include this tag in its `Tags:` list:

```yaml
- Key: TenkaCloud:NamePrefix
  Value: !Ref NamePrefix
```

The participant role's `ec2:Describe*` is scoped by `Condition: aws:ResourceTag/TenkaCloud:NamePrefix == ${NamePrefix}`. Missing the tag means **the competitor cannot see their own resource in Console**. Cross-tenant access stays blocked either way, so the symptom is "where did my VPC go?", not a leak.

The validator's `checkResourceTagging` runs a line-anchored regex; a commented-out `# - Key: TenkaCloud:NamePrefix` will NOT satisfy it.

## Required invariants — not enforced, but expected

The validator can't catch these. Reviewers will.

### 6. IAM `Resource` ARNs must be NamePrefix-scoped (with a Console-UX carve-out)

Per ADR-021, the participant role's **write / modify / delete** actions never grant broad-resource scoping. Use one of:

- `arn:aws:<service>:...:<resource>/${NamePrefix}*` (prefix match)
- `arn:aws:<service>:...:<resource>/${SomeResource}` (per-stack logical-id reference)
- `Resource: "*"` **only with** a tag-based `Condition` (for actions that don't accept resource ARNs like `ec2:Describe*`) **or** for per-identity actions (CloudShell, `sts:GetCallerIdentity`).

Write-side list-actions (`ssm:DescribeParameters` that returns the parameter store, etc.) on `Resource: "*"` are still forbidden if the leaked metadata enables modification of other teams' resources.

**Console-UX carve-out for read-only `List*` / `Describe*` actions**: when a problem requires players to use the AWS Console to deploy onto Lambda / ECS / App Runner / Cognito / CloudFront / CloudTrail / Athena / etc., grant the corresponding `service:List*` actions on `Resource: "*"`. The Console opens with list views; empty lists break the workflow. Cross-tenant resource NAMES become visible, but cross-tenant resource ACCESS stays blocked by the ARN-scoped write grants. Team identities are already public via the leaderboard, so the marginal privacy cost is small. See `battles/microservice-migration-battle/template.yaml` and `battles/stackstack/template.yaml` for the worked pattern (`ConsoleList*` Sids).

### 7. AWS Console deep links use literal slashes, not URL-encoded slashes

For SSM Parameter Store specifically:

- ✗ `/systems-manager/parameters/%2F${NamePrefix}%2Fhello/description?…` — returns HTTP 400.
- ✓ `/systems-manager/parameters/${NamePrefix}/hello/description?region=${AWS::Region}&tab=Table` — works.

The Console router expects the parameter name with the leading `/` dropped and internal slashes left literal. Other services may have their own deep-link quirks; test before shipping.

### 8. `publicHint` controls whether `phases[]` / `disruptions[]` show to the player

If you declare a phase or disruption with `publicHint: true`, the participant portal renders its name, timing, and description as a countdown. That's a spoiler for surprise mechanics. Default to `publicHint: false` and only flip it when the timing genuinely is the gameplay (= rare).

### 9. Battle uptime problems need a participant-action gate

If you ship a Battle that auto-fills working URLs into endpoint `default` and the score engine starts probing immediately, the deploy alone earns points and there is no "battle." Required pattern:

- Set the URL `Outputs` (`FrontendUrl`, `ApiUrl`, etc.) to empty string `""` in `template.yaml`.
- Add a helper Output (e.g. `Ec2HostHint: !GetAtt Ec2.PublicDnsName`) so the competitor knows what to paste.
- Set `endpoints[].overridable: true` in `metadata.json`.
- Use `scoring.kind: "uptime-flat"` with `endpoints[].slot` binding (not the legacy `outputKey` form) so the scoring engine resolves effective URL as `override ?? default` and skips the empty default.

See `battles/hello-world-battle/` for the working reference.

### 10. Player-visible strings don't leak surprise mechanics

The fields a competitor sees in the portal are:

- `shortDescription` (rendered on the problem card and detail page).
- `instructions` (rendered on the problem detail page as the player-facing "Getting started"; see §12).
- `description` is **author/admin-only** — the portal does **not** show it to competitors (it holds scoring rules / hardened state / spoilers). Put player-facing guidance in `instructions` / `shortDescription`, not here.
- `endpoints[].label` and `endpoints[].description` (rendered in the registration panel).
- `scoring.hints[].content` (revealed at penalty).
- `phases[].description`, `disruptions[].name` / `description` — but only when `publicHint: true`.

Goal-style content is fine: "split the monolith into Lambda / ECS / App Runner" is the point of the problem. Surprise mechanics — exact scoring numbers, when disruptions fire, the existence of planted slow code paths — are not. Compare `battles/microservice-migration-battle/metadata.json` (de-spoilered) against an earlier revision for a worked example.

### 11. Disruptions ship their delivery mechanism — and never promise more

A `disruptions[]` entry whose `description` claims an outcome must declare the machinery that produces it. Three delivery models exist:

- **`effect`** (ADR-033) — scoring-side penalty, no cloud fault. May only claim score pressure. Penalties apply unconditionally once fired; "only hurts teams still on EC2" is operator targeting discipline, documented in `OPERATOR.md` / `redteam/README.md`, not an engine guarantee.
- **`action`** (ADR-031) — real fault injection via the platform executor (`ssm-run-command` / `lambda-invoke` / `cfn-stack-update`). `targetRef` must be a `template.yaml` Output (validated); `revert` is mandatory (ADR-029: nothing is permanent). Score damage arrives via the probe failing (`failurePenalty`) — do **not** stack an `effect` on the same event; it double-charges and hits teams that already migrated off the attacked host.
- **HTTP attack probes** — `redteam/probes/*.sh` invoked by the operator-side attacker (see `battles/security-battle-royale/redteam/`).

Explain the red team operator-side. A single self-explanatory `action` (like `battles/hello-world-battle`'s `frontend-down`) can live entirely in the disruption's `description`. Anything bigger — multiple disruptions, mixed delivery models, or attack scripts — ships an operator-facing **`redteam/README.md`**: catalog table (id / delivery model / what actually happens), player recovery path, targeting rules, and a pre-event smoke test for real faults. Worked examples: `battles/stackstack/redteam/` (mixed `effect` + `action`), `battles/security-battle-royale/redteam/` (probe catalog).

### 12. Every problem ships player-facing `instructions` (and ideally a `diagram.svg`)

The portal hides `description` from competitors (fairness contract), so authored steps reach players **only** through `instructions`. A problem without `instructions` gives the player a one-line `shortDescription` and nothing else — the #1 playtest complaint ("誘導がなさすぎ / 何をやればいいかわからない"). So **every problem must set `instructions`** (top-level JA + `i18n.en.instructions`).

- Shape: Markdown with `## はじめに` (one-line framing) → `## 最初の一手` (the concrete first command — `aws ssm start-session …`, read the briefing param, register the URL) → `## ゴール` (what success looks like). Keep it short.
- **Non-spoiler, same as §10**: no scoring numbers, hardened state, or surprise mechanics — those stay in `description` / penalty-gated `hints`. The first move and the goal are not spoilers.
- Images render: the portal renders `instructions` through the web-kit Markdown allowlist, so `![alt](https://…)` works.
- **`diagram.svg`** (optional, recommended for multi-resource problems): drop a `diagram.svg` in the problem directory and the portal renders it as the architecture image on the problem page (globbed by the participant portal; keyed by directory name). Use it to show the "全体像" — the services and the flow. Keep it simple and non-spoiler.

Worked examples: every problem under `challenges/` and `battles/` now carries `instructions`; mirror their JA/EN shape.

## Voice for `shortDescription` / `instructions` / `description`

The catalog leans into SRE-day-in-the-life narration: the previous SRE (the predecessor who abruptly resigned), the CTO (gives vague but high-stakes orders), competitor as "the new hire" inheriting a mess. Players engage 2-3× better with story than with dry mechanics. Examples:

- `challenges/hello-world` — first-day, single SSM parameter as the smoking gun.
- `battles/hello-world-battle` — day two, inherited monolith, other teams already moving.
- `battles/microservice-migration-battle` — month one, CTO orders the split.

Two paragraphs of setup, then a clear "what you do" line. Avoid stamping the migration target or scoring numbers into `shortDescription`.

## How to add a problem

### TL;DR — Claude Code users

Type one of these slash commands and follow the prompts:

- **`/new-problem challenge`** — scaffold a self-paced, single-flag problem (= Challenge).
- **`/new-problem battle`** — scaffold a real-time PvP / uptime-scoring problem (= Battle); the skill asks which scoring kind next.
- **`/new-problem`** — no argument; the skill asks Challenge or Battle first.

The skill (`.claude/skills/new-problem/SKILL.md`) walks the 6 steps below, dropping in the IAM baseline, the required tags, and the URL-registration gate boilerplate so you don't reconstruct them from scratch. Not using Claude Code? The [skill usage guide](./.claude/skills/new-problem/README.md) explains how to invoke it and the manual / Codex-CLI paths.

### The 6 steps (manual / non-Claude-Code path)

1. **Pick a starter.** Copy the closest existing problem directory:
   - Challenge (`flag` scoring) → `challenges/hello-world`
   - Battle, uptime-flat → `battles/hello-world-battle`
   - Battle, phased-polling → `battles/microservice-migration-battle` or `battles/stackstack`
   - Battle, uptime-multi + attack-detection → `battles/security-battle-royale`

   `cp -r <starter> <category>/<your-slug>`. Slug is kebab-case, lowercase, alphanumeric + hyphens.

2. **Edit `metadata.json`.** Change `id`, `name`, `shortDescription`, `instructions` (player-facing getting-started — required, see §12), `description` (author/admin-only), `tags`, `scoring`, `endpoints`. Keep the JP top-level + `i18n.en` override pattern. Optionally add a `diagram.svg` in the problem directory (architecture image, §12). Re-read the invariants above before touching `phases` / `disruptions` / `endpoints[].overridable`.

3. **Edit `template.yaml`.** Add your problem-specific resources. **Do not remove**: `ParticipantViewerRole`'s baseline (managed policy + 7 CloudShell actions), `TenkaCloud:NamePrefix` tags on every EC2 resource, the comment anchors that point back at `scripts/validate-problems.ts`.

4. **Write `README.md` + `README.ja.md`.** Story → "What gets deployed" → "How to play / solve" → "Scoring" → "Cost". Mirror EN ↔ JA. The story carries the problem; don't skip it.

5. **Run `bun run validate`.** Pass before committing. Common failures and their fixes:
   - `... missing TenkaCloud:NamePrefix tag` → add the tag block to the named resource.
   - `ParticipantViewerRole is missing CloudShell baseline actions` → restore the 7-action statement.
   - `scoring.flagOutputKey="X" not found` → typo between metadata and the `Outputs:` key in the template.

6. **Open a PR.** One problem per PR. Conventional commits: `feat(<slug>): add <name> Challenge` or `Battle`. The PR triggers schema + cross-ref CI; merge after it passes.

## Extending the platform contract

Anything outside what's documented here — a new `scoring.kind`, a new `dashboard.slot` name, a new `phases[].effect` field — requires a parallel change in the [platform repo](https://github.com/susumutomita/TenkaCloud) (`SCHEMA.json` is shared between the two). Open an issue describing the new mechanic before writing the problem; otherwise the validator and the scoring engine will diverge.

## Where to file things

- New problem → PR to this repo.
- New scoring kind / portal slot / disruption effect → issue here, then PR to both this repo and the platform repo.
- Spoiler-bearing private problems → separate private repo via the ADR-008 S3 path (do not push spoilers to this repo).
- Validator footgun catches → extend `scripts/validate-problems.ts` and document the rule in §"Required invariants" above.
