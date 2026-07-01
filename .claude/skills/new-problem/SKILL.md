---
name: new-problem
description: Scaffold a new TenkaCloudChallenge problem. Invoked via `/new-problem challenge` (self-paced single-flag) or `/new-problem battle` (real-time PvP / uptime). With no argument, the skill asks which category. Also triggers on natural-language requests like "add a new problem", "create a new Battle/Challenge", or "scaffold a new problem". Walks through picking a starter, filling metadata.json, writing template.yaml with the required participant-role baseline and tag-based scoping, validating, and opening a PR. NOT for edits to existing problems — read AGENT.md and edit directly for those.
---

# new-problem — scaffold a TenkaCloudChallenge problem

Use this skill when the user wants to add a brand-new problem. For edits to an existing problem, read `AGENT.md` instead and edit in place.

## The design bar — make it fun, not a drill (read this first)

The catalog's #1 failure mode is the **exam-drill problem**: a corporate-memo wrapper around a flashcard, where the "flag" is a concept name you type from memory (`TC{standard-ia}`, `TC{port-3389}`) and the same "新人入社 / 前任の SRE の負債 / CTO 激怒" template is stamped on every entry. After three of those it is pure repetition — players feel like they are grinding AWS homework, not playing. A problem is only worth shipping if a player would call it *fun*, not *homework*.

Four properties separate a fun problem from a drill. Aim for all four.

1. **Discovered flag, never a memorized one.** The flag must be a value the player can only obtain by *performing the intended AWS operation* — a random per-deploy secret served by a resource they had to reach, a value reconstructed from logs, an Output that only becomes correct once the fix lands. If the flag can be guessed from studying for the exam, the problem is a flashcard. (Reference: `challenges/net-evo-01-reachability` — the flag lives on a private host you can reach only after repairing the network path.)
   - Mechanically: pass a per-deploy secret via `cfnParameters: { FlagSeed: "__RANDOM_PASSWORD__" }`, serve/store it *behind* the puzzle, and echo the same value to the `AnswerFlag` Output for the scorer. Do **not** grant the player `cloudformation:DescribeStacks` — they would read the answer straight off the Output. If the flag is baked into EC2 UserData, also `Deny ec2:DescribeInstanceAttribute` so it cannot be read back.

2. **Fix by settings — players never create top-level resources.** If solving requires the player to *create* a Lambda / ECS service / bucket / DB by hand, those resources are **not under CloudFormation** and survive `delete-stack` as orphaned, billable garbage. Instead: **the template creates every base resource (in a broken / unconfigured / misconfigured state), and the solve is to *modify* an existing resource** — a setting, a config value, a data restore, a re-point. A drifted-but-CFn-owned resource is still deleted cleanly on teardown; an out-of-band-created one is not. This is a hard rule, not a preference.
   - Good solves: add one NACL/SG/route entry; restore data into an existing DB from a pre-staged backup; flip an app config flag; attach a pre-created WAF WebACL; repoint a connection string to a pre-created Aurora.
   - Bad solves: "stand up a Lambda", "create an ALB", "spin up a new bucket". These orphan resources and break teardown.
   - The participant role therefore grants **scoped write to modify** the planted resource (e.g. `ec2:CreateNetworkAclEntry` tag-scoped to `${NamePrefix}`), not create-new permissions.

3. **A real "aha", not recall.** The lesson should be a production skill felt viscerally — `curl` that *hangs* vs *refuses* (stateful SG vs stateless NACL), a path traced across four layers, an incident reconstructed from evidence. Naming the service is not the win; *operating* it is.

4. **Story with stakes, without the stamp.** Keep the shared world (天下クラウド, the previous SRE's leftovers, the CTO) but vary the framing every time — a fresh incident, a specific symptom, a ticking clock. Never reuse the same "day-N / CTO rage" skeleton verbatim. The story gives the operation stakes; it is not a reskin of the same memo.

### How to incorporate the Battle (PvP) element

A fix-by-settings puzzle is single-player by default. Make it a Battle by adding **continuous scoring + an operator red team that re-breaks what you fixed**:

- The score engine probes a target that is healthy only when the player's configuration is correct (`uptime-flat` / `phased-polling`). Fixing it starts the points; the URL-registration gate (AGENT.md invariant #9) keeps the bare deploy from auto-scoring.
- The red team fires **reversible** faults (ADR-031 `action` + ADR-029 mandatory revert) that *re-introduce* the misconfiguration — re-deny the NACL, drop the route, stop the service, wipe the data. The player re-diagnoses and re-fixes under time pressure: the incident-response rhythm.
- **Asymmetry rewards robustness.** A player who hardens beyond the minimum (a redundant path, defense-in-depth, data already on the managed tier) is immune to some attacks — so cumulative uptime, not a single fix, decides the winner. (Reference: `battles/stackstack` — already-migrated slots are untouched by the red team.)
- Still **no orphans**: the red team mutates pre-created resources and the revert restores them; `delete-stack` cleans everything.

### Two worked archetypes

- **"Internet Evolution" series (networking Challenges).** Each episode re-lives one moment in how the internet evolved by making the player *operate* a TCP/IP layer: Ep01 inter-subnet reachability (SG vs NACL), Ep02 DNS (names over numbers), Ep03 NAT / IPv4 exhaustion, Ep04 TLS, Ep05 the edge (anycast / CDN / QUIC). Discovered flag, fix-by-settings, cheap real resources, each episode standalone in the shared world. Start from `challenges/net-evo-01-reachability`.
- **"Vibe to Production" battle (AI-native incident response).** The round **opens with hosting a vibe-coded (AI-generated) app** on pre-created compute, then cascades through AI-native incidents — the AI deleted the database (restore from the pre-staged backup), no auth so bots post garbage (enable a pre-created rate-limit / authorizer), insecure code and a SQLite→Aurora move (re-point to the pre-created Aurora and migrate the data). Every beat is fix-by-settings on CFn-owned resources, scored continuously with a red team. This is the orphan-safe successor to the original `battles/stackstack` mechanic, which wrongly had players *create* managed runtimes by hand (they orphaned on teardown).

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
- `shortDescription` / `description` — see "Voice" below. (`description` is author/admin-only — the portal hides it from players.)
- `instructions` — **required** player-facing getting-started (Markdown): `## はじめに` → `## 最初の一手` (the concrete first command) → `## ゴール`. Non-spoiler (no scoring numbers / hardened state). This is the field the portal renders below `shortDescription`; without it the player has no guidance (AGENT.md §12).
- `learningGoals` — 2–4 bullets, what the player walks away knowing.
- `endpoints[]` — slot per probeable URL. For Battles, **set `overridable: true`** so the player has to register the URL before scoring starts.
- `scoring` — match the kind the user chose; cross-check `flagOutputKey` / `endpoints[].slot` against `template.yaml` Outputs.
- `i18n.en.{name,shortDescription,instructions,description,learningGoals}` — mirror EN.
- Optional: drop a `diagram.svg` in the problem directory — the portal renders it as the architecture image on the problem page (recommended for multi-resource problems; AGENT.md §12).

Keep `phases[].publicHint` and `disruptions[].publicHint` set to **`false`** unless the timing is genuinely part of the puzzle. If they default to `true` in the starter, flip them.

## Step 3.5 — disruptions / red team (Battles only)

Skip for Challenges. For Battles, ask the user: "Should an operator-side red team pressure the players during the round?" If yes, every `disruptions[]` entry must declare **how the pressure is delivered** — a description alone does nothing at runtime. Pick one delivery model per disruption:

| Model | Use when | Declare | Worked example |
| --- | --- | --- | --- |
| **Scoring-side `effect`** (ADR-033) | Narrative/organizational pressure; no cloud fault needed | `effect: { kind: "penalty", points: ≥1, durationSeconds: ≤3600 }` | `battles/stackstack` (`ceo-5000-users`) |
| **Real fault `action`** (ADR-031) | The defender must notice, diagnose, and fix something | `action: { kind: "ssm-run-command" \| "lambda-invoke" \| "cfn-stack-update", targetRef: <Outputs key>, paramTemplate, revert: { afterSeconds: ≤86400, ... } }` | `battles/hello-world-battle` (`frontend-down`), `battles/stackstack` (`env-credential-leak`) |
| **HTTP attack probes** | App-layer attacks (SQLi, floods) against player-patched code | `redteam/probes/*.sh` + `redteam/run-attack-cycle.sh`; disruption `parameters.probe` points at the script | `battles/security-battle-royale` |

Rules the validator and/or reviewers enforce:

- **Never describe a fault the entry doesn't deliver.** "The slot returns 503" requires an `action` (or a probe). An `effect`-only event may only claim score pressure. This mismatch shipped once and broke the battle's promises — don't repeat it.
- `action.targetRef` / `action.functionRef` must name an existing `template.yaml` `Outputs:` key (validated).
- `action.revert` is **mandatory** (ADR-029: no disruption is permanent). Match `afterSeconds` to the duration the player-facing text promises. `{{placeholders}}` in `paramTemplate` may only reference declared `parameters` / `operatorEditable` keys (validated).
- `effect` penalties apply **unconditionally** once fired — any "only hurts teams still on X" conditionality is operator targeting discipline, which belongs in `OPERATOR.md` and `redteam/README.md`.
- A single self-explanatory `action` can live entirely in the disruption's `description` (see `battles/hello-world-battle`). Anything bigger — multiple disruptions, mixed delivery models, or attack scripts — ships a **`redteam/README.md`** (operator-facing): catalog table (id / delivery / what actually happens), the player recovery path, the targeting rule for effect-only events, and a pre-event smoke test for every real fault (see `battles/stackstack/redteam/smoke-test-attacks.sh`).
- Explain the red team's *existence and recovery path* in the player-facing `description` (players engage more when the pressure is announced) — but keep exact fire timing and `publicHint: false` unless timing is the gameplay.

Damage from a real fault arrives through the scoring engine on its own: a stopped service fails its probe → `failurePenalty` per cycle. Do **not** stack an `effect` penalty on top of an `action` for the same event — that double-charges and also (unfairly) hits teams that already migrated off the attacked host.

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

Sections in order: story (lead with this), what-gets-deployed (diagram if non-trivial), how-to-play / how-to-solve, scoring table, cost, learning goals, related files. EN-primary, JA mirror. Same SRE-day-in-the-life voice as `metadata.json` (the previous SRE, the CTO).

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

- **the previous SRE** — your predecessor SRE who abruptly resigned and left an undocumented mess.
- **the CTO** — vague high-stakes orders ("そろそろマネージドに分けてくれない?").
- **You** — first day / second day / month one as the new SRE inheriting the previous SRE's notes (a single Notion line, a Slack DM history that goes nowhere).

Two paragraphs of setup, then a clear "your job" line. Avoid stamping the migration target, exact scoring numbers, or hidden mechanics into the player-facing text — those are goals/discoveries, not framing.

Working examples to mirror:

- `challenges/hello-world/metadata.json` — first-day, single SSM parameter.
- `battles/hello-world-battle/metadata.json` — day two, inherited monolith, URL-registration gate.
- `battles/microservice-migration-battle/metadata.json` — month one, monolith → managed split, before/after ASCII diagram.

## Security CTFs (SQLi, IDOR, SSRF, …) — the flaw is the puzzle; never name it

The bar above is written for AWS-ops problems. For a **security CTF** whose challenge is to *find and exploit a vulnerability*, one rule dominates: **discovering the vulnerability IS the competition, so the problem must never reveal what it is or how to exploit it.** Naming the flaw or walking the payload is a spoiler that kills the game ("種明かしした問題を解くなんて興ざめ").

- **`name` (title)** = thematic / in-world (`スタッフ専用ログイン`, `管理者のメモ`). Never the vulnerability class — `SQL Injection — Login Bypass` is wrong.
- **`description`** = an immersive scenario + the goal (sign in as admin → read the flag), plus at most one *subtle* nudge ("入力の扱いがどこか雑だという噂"). Never write "this is vulnerable to X" and never show the exploit. Do not repeat the challenge URL — the portal already shows it in its access-URL panel.
- **`instructions`** = minimal: how to submit + "手が止まったらヒントを". **No setup steps** (`make local` / portal login — the reader is already in the portal) and **no exploit walkthrough**. This overrides step 3's `## 最初の一手` template: for a security CTF the first move must not be the exploit.
- **`hints`** (progressive, penalty-bearing) = where the technique lives. hint-1 = a nudge toward the discovery; hint-2 = the actual payload + the vuln name. The player *chooses* to pay for the answer.
- **post-solve writeup** = where the teaching goes. After a correct submission, show what the vuln was, the mechanism, and the fix — otherwise there is no learning payoff. (Field TBD — TenkaCloud issue #2191.)

### Local (AWS-free) CTF container format (#2054)

A security CTF can run entirely on the player's machine — no AWS account. Reference: `challenges/sqli-demo`, `challenges/api-idor-demo`.

- `runtime`: `{ provider: "docker", engine: "compose", entry: "local/docker-compose.yml", challengeEndpoints: {...}, verifyUrl: "http://127.0.0.1:18081/verify", secretEnv: ["FLAG_SEED"] }`; `scoring.kind: "verify"` — the platform holds no answer, it delegates each submission to the container's loopback `/verify`.
- Files: `local/{Dockerfile, docker-compose.yml, app/server.mjs}`. The flag is derived inside the container from a per-deploy random `FLAG_SEED` (never committed). Bind to `127.0.0.1` only.
- **Attack CTF** (exploit to capture the flag): single container; `FLAG_SEED` in its env is fine because the intended solution is HTTP-only, so a `docker exec` to read the seed is self-cheating (accepted).
- **Defense CTF** (fix the code): the player has a shell inside the container, so any secret there is trivially readable. Use **two containers** — a `target` the player edits (no secret) and a separate `grader` that holds the flag, probes the target, and releases the flag only when the fix passes.

## Footguns this skill prevents

By following the steps above you avoid:

- Deploy auto-earning points (= step 4's empty-URL Outputs pattern).
- Participants unable to see their own resources (= step 4's tag block on every EC2 resource).
- `aws login` returning HTTP 400 (= step 4's `SignInLocalDevelopmentAccess` managed policy).
- CloudShell refusing to open (= step 4's 7 cloudshell actions).
- Cross-tenant leakage via list-style IAM actions (= step 4's per-resource ARN scoping).
- Spoiler in the portal timeline (= step 3's `publicHint: false`).
- Disruptions that promise faults nothing delivers (= step 3.5's delivery-model table; "returns 503" needs an `action`, not just an `effect`).
- Permanent faults / unfair double penalties (= step 3.5's mandatory `revert` + no `effect`-on-top-of-`action` rule).
- AWS Console deep link 400s (= use literal slashes, never `%2F` encoding).
- Dry, non-engaging problem framing (= step 5's SRE-narration voice).

All of the above have happened in this repo before. AGENT.md §"Required invariants" carries the long-form rationale.
