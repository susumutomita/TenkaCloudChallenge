---
name: new-problem
description: Scaffold a new TenkaCloudChallenge problem. Invoked via `/new-problem challenge` (self-paced single-flag) or `/new-problem battle` (real-time PvP / uptime). With no argument, the skill asks which category. Also triggers on natural-language requests like "add a new problem", "create a new Battle/Challenge", or "scaffold a new problem". Walks through picking a starter, filling metadata.json, writing template.yaml with the required participant-role baseline and tag-based scoping, validating, and opening a PR. NOT for edits to existing problems — read AGENT.md and edit directly for those.
---

# new-problem — scaffold a TenkaCloudChallenge problem

Use this skill when the user wants to add a brand-new problem. For edits to an existing problem, read `AGENT.md` instead and edit in place.

## Modes (slash-command form)

| Invocation | Behavior |
| --- | --- |
| `/new-problem challenge` | Skip the category question. Use `challenges/hello-world` as the starter. Scoring kind defaults to `flag`; ask the user to confirm. |
| `/new-problem battle` | Skip the category question. Then ask for scoring kind (`uptime-flat` / `uptime-multi` / `phased-polling` / `attack-detection`) before picking the starter. |
| `/new-problem` (no arg) | Ask "Challenge or Battle?" first. Everything else as below. |

Natural-language invocations ("add a new problem", "create a Battle") behave like the no-arg form.

## Step 0 — read the contract

Open `AGENT.md` at the repo root before writing files. The required invariants there are not negotiable; the validator will reject the PR if any are missed.

## Step 1 — gather inputs from the user

If the invocation was `/new-problem challenge` or `/new-problem battle`, **Category is already set** — skip that question. Otherwise ask. Then gather the rest with `AskUserQuestion` when running interactively. Required inputs:

1. **Category** — `challenges/` (self-paced, single submission) or `battles/` (real-time PvP / continuous scoring). Provided as arg or asked.
2. **Slug** — kebab-case, alphanumeric + hyphens, lowercase. Becomes the directory name and the `tc-<slug>-<teamSlug>` resource prefix.
3. **Scoring kind** — one of:
   - `flag` — submit a string, scored once. **Challenge default.**
   - `uptime-flat` — N endpoints probed independently, points per healthy probe.
   - `uptime-multi` — N endpoints, AND condition; one bonus when all are up.
   - `phased-polling` — score rules change at scheduled phase boundaries.
   - `attack-detection` — counter from a stats endpoint converts to points.

   For `challenge` mode default to `flag` and ask only to confirm. For `battle` mode the 4 uptime/polling/attack kinds are the relevant choices — ask which.
4. **Concept** — one or two sentences in the user's own words. The skill weaves this into the story-style `shortDescription` later; raw mechanics are not the player-facing voice.
5. **Difficulty** 1–5 and rough **estimatedDuration** (e.g. "30 分").

## Step 2 — pick the closest starter and copy

| Inputs | Starter directory |
| --- | --- |
| Challenge + `flag` | `challenges/hello-world` |
| Battle + `uptime-flat` | `battles/hello-world-battle` |
| Battle + `phased-polling` | `battles/microservice-migration-battle` or `battles/stackstack` |
| Battle + `uptime-multi` + `attack-detection` | `battles/security-battle-royale` |

```bash
cp -r <starter> <category>/<slug>
cd <category>/<slug>
```

The starter ships with the required IAM baseline, the right tag set, the standard parameters (`NamePrefix`, `TenkaCloudAccountId`, `ExternalId`), and a working `ParticipantViewerRole`. Do **not** delete those — adapt them.

## Step 3 — edit `metadata.json`

Must update:

- `id` — matches the directory name exactly.
- `name` — human-readable, EN-ish.
- `tags` — kebab-case discoverability tags.
- `shortDescription` / `description` — see "Voice" below.
- `learningGoals` — 2–4 bullets, what the player walks away knowing.
- `endpoints[]` — slot per probeable URL. For Battles, **set `overridable: true`** so the player has to register the URL before scoring starts.
- `scoring` — match the kind the user chose; cross-check `flagOutputKey` / `endpoints[].slot` against `template.yaml` Outputs.
- `i18n.en.{name,shortDescription,description,learningGoals}` — mirror EN.

Keep `phases[].publicHint` and `disruptions[].publicHint` set to **`false`** unless the timing is genuinely part of the puzzle. If they default to `true` in the starter, flip them.

## Step 4 — edit `template.yaml`

Replace the starter's problem-specific resources with yours. Preserve:

- `Parameters:` block (`NamePrefix`, `TenkaCloudAccountId`, `ExternalId`).
- `ParticipantViewerRole` with the access baseline:

  ```yaml
        ManagedPolicyArns:
          - arn:aws:iam::aws:policy/SignInLocalDevelopmentAccess
        Policies:
          - PolicyName: ProblemSpecific
            PolicyDocument:
              Version: "2012-10-17"
              Statement:
                - Sid: OpenCloudShellSession
                  Effect: Allow
                  Action:
                    - cloudshell:CreateEnvironment
                    - cloudshell:CreateSession
                    - cloudshell:GetEnvironmentStatus
                    - cloudshell:StartEnvironment
                    - cloudshell:StopEnvironment
                    - cloudshell:DeleteEnvironment
                    - cloudshell:PutCredentials
                  Resource: "*"
                # ... add your problem-specific scoped statements below ...
  ```

- The `- Key: TenkaCloud:NamePrefix / Value: !Ref NamePrefix` tag on **every** `AWS::EC2::{VPC,Subnet,InternetGateway,RouteTable,SecurityGroup,Instance}` you keep or add. Tags template:

  ```yaml
        Tags:
          - Key: Name
            Value: !Sub "${NamePrefix}-<resource-shortname>"
          - Key: TenkaCloud:NamePrefix
            Value: !Ref NamePrefix
  ```

For Battle uptime-flat / uptime-multi problems, emit the URL Outputs as empty strings so deploying alone doesn't score:

```yaml
Outputs:
  FrontendUrl:
    Description: Empty by default; competitors register the URL via the Participant Portal to start scoring.
    Value: ""
  Ec2HostHint:
    Description: Hint for what to paste into the FrontendUrl override.
    Value: !GetAtt Ec2.PublicDnsName
```

For policy `Resource` ARNs, scope by `${NamePrefix}*` or a per-stack resource ID. Never grant list-style actions on `Resource: "*"`.

## Step 5 — write `README.md` and `README.ja.md`

Sections in order: story (lead with this), what-gets-deployed (diagram if non-trivial), how-to-play / how-to-solve, scoring table, cost, learning goals, related files. EN-primary, JA mirror. Same SRE-day-in-the-life voice as `metadata.json` (Kato-san, Sasaki-san CTO).

## Step 6 — validate and PR

```bash
bun run validate
```

Must pass. If it fails:

- *missing TenkaCloud:NamePrefix tag* — add the tag block to the named resource.
- *missing CloudShell baseline actions* — restore the 7-action statement.
- *not found in Outputs* — typo between metadata field and template Output key.

Then:

```bash
git checkout -b feat/<slug>
git add <category>/<slug>/
git commit -m "feat(<slug>): add <name> <Challenge|Battle>"
git push -u origin feat/<slug>
gh pr create --base main --title "feat(<slug>): add <name> <Challenge|Battle>" --body "..."
```

PR body should cover: what the problem teaches, the player's flow, anything that needed a platform-side change (it should be nothing — flag this if not).

## Voice for `shortDescription` / `description`

The catalog uses SRE-day-in-the-life narration:

- **Kato-san** — your predecessor SRE who abruptly resigned and left an undocumented mess.
- **Sasaki-san CTO** — vague high-stakes orders ("そろそろマネージドに分けてくれない?").
- **You** — first day / second day / month one as the new SRE inheriting Kato-san's notes (a single Notion line, a Slack DM history that goes nowhere).

Two paragraphs of setup, then a clear "your job" line. Avoid stamping the migration target, exact scoring numbers, or hidden mechanics into the player-facing text — those are goals/discoveries, not framing.

Working examples to mirror:

- `challenges/hello-world/metadata.json` — first-day, single SSM parameter.
- `battles/hello-world-battle/metadata.json` — day two, inherited monolith, URL-registration gate.
- `battles/microservice-migration-battle/metadata.json` — month one, monolith → managed split, before/after ASCII diagram.

## Footguns this skill prevents

By following the steps above you avoid:

- Deploy auto-earning points (= step 4's empty-URL Outputs pattern).
- Participants unable to see their own resources (= step 4's tag block on every EC2 resource).
- `aws login` returning HTTP 400 (= step 4's `SignInLocalDevelopmentAccess` managed policy).
- CloudShell refusing to open (= step 4's 7 cloudshell actions).
- Cross-tenant leakage via list-style IAM actions (= step 4's per-resource ARN scoping).
- Spoiler in the portal timeline (= step 3's `publicHint: false`).
- AWS Console deep link 400s (= use literal slashes, never `%2F` encoding).
- Dry, non-engaging problem framing (= step 5's SRE-narration voice).

All of the above have happened in this repo before. AGENT.md §"Required invariants" carries the long-form rationale.
