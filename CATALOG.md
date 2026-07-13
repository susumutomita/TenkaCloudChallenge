# TenkaCloud Problem Catalog

> 日本語版: [CATALOG.ja.md](./CATALOG.ja.md)

Problems shipped on TenkaCloud (**Battle** / **Challenge**) follow a one-directory-per-problem convention. Whatever lives under `problems/` is the source of truth for the catalog.

Problems are treated as **plugins** per ADR-012: each problem ships in 3–4 assets (`metadata.json` + `template.yaml` + optional `portal/` slots + optional `services/` implementation). The platform side (`infrastructure/lib/problem-deploy/`) is a generic dispatcher that drives scoring / portal / disruptions purely from metadata. Problem-specific code stays inside the problem directory.

For a cross-cutting view of shipped problems + ideas, see [`docs/gallery.md`](../docs/gallery.md). For a 30-minute "author a new problem" onboarding, see [`docs/problems/AUTHORING.html`](../docs/problems/AUTHORING.html).

New competition problems follow a **"fun, not a drill" design bar** (discovered flag / fix-by-settings / a real "aha" / story with stakes), codified in the [`new-problem`](./.claude/skills/new-problem/SKILL.md) skill. The reference implementation is [`challenges/hello-world`](./challenges/hello-world/).

## Directory layout

```
problems/
├── battles/                       # Battle (real-time, head-to-head)
│   ├── hello-world-battle/
│   ├── microservice-migration-battle/
│   ├── security-battle-royale/
│   └── stackstack/
├── challenges/                    # Challenge (self-paced, evergreen)
│   ├── hello-world/
│   └── x402-paywall/              # x402 / WAF AI-bot monetization paywall
├── SCHEMA.json                    # JSON Schema (draft-07) — source of truth for metadata.json
├── SIMULATION_SCHEMA.json         # Optional versioned Simulator overlay contract
├── index.json                     # Catalog built from every metadata.json (= `make build-problems-index`)
├── CATALOG.md                     # This file (English, primary)
├── CATALOG.ja.md                  # Japanese mirror
└── README.md                      # Repo-level contributor docs (also mounted as problems/README.md)
```

A single problem directory is made up of the following assets (ADR-012).

| Asset                       | Required | Purpose                                                                                          |
| --------------------------- | -------- | ------------------------------------------------------------------------------------------------ |
| `metadata.json`             | ✓        | Source of truth for catalog UI + scoring engine + portal plugin wiring.                          |
| `README.md` / `README.ja.md` | ✓       | Problem detail page (story / solve path / learning goals). `README.md` is English (primary); `README.ja.md` is the Japanese mirror. |
| `template.yaml`             | ✓        | A single-page CFn template (the deploy body). Pushed into the competitor account via `create-stack`. |
| `portal/<slot>.tsx`         | -        | Problem-specific participant portal UI, referenced from `dashboard.slots`.                       |
| `services/`                 | -        | Problem-specific implementation (docker-compose / Lambda code / etc; pulled by EC2 UserData).    |
| `simulation.json`           | -        | Gap-only Simulator requirements/workloads, referenced by `simulationOverlay`; never scoring or answers. |

## Categories

| Category    | Nature                                                                                              |
| ----------- | --------------------------------------------------------------------------------------------------- |
| `Battle`    | Real-time, head-to-head. Multiple teams deploy at once and earn points via uptime / defense / phase progression. |
| `Challenge` | Self-paced, evergreen. Always open; the typical shape is "1 deploy = 1 flag submission".            |

The two are not strictly separated — they share metadata, scoring engine, and portal. A Battle problem can embed CTF-style sub-quests, and `metadata.category` tells them apart.

## metadata.json

The source of truth is [`SCHEMA.json`](./SCHEMA.json). Both the frontend catalog and the backend deploy pipeline read it.

### Required keys

| Key                 | Purpose                                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| `id`                | Lowercase kebab-case ID. Matches the directory name. Also goes into the CFn stack name prefix.           |
| `name`              | Human-readable display name (any language).                                                              |
| `category`          | `Battle` or `Challenge`.                                                                                 |
| `status`            | `ready` / `draft` / `deprecated`.                                                                        |
| `visibility`        | `public` / `private`. Private problems show up only in the admin console.                                |
| `difficulty`        | 1 (beginner) – 5 (expert).                                                                               |
| `estimatedDuration` | Estimated playtime, e.g. `60–90 min`.                                                                    |
| `shortDescription`  | One-line summary used on catalog cards.                                                                  |
| `description`       | Long-form detail page text (newlines OK).                                                                |
| `tags`              | kebab-case search / filter tags.                                                                         |
| `exposedPorts`      | Array of `{port, name}` for endpoints exposed to competitors after deploy. Use a single placeholder entry if there are no public endpoints. |
| `learningGoals`     | Bullet list of learning goals.                                                                           |
| `cfnTemplate`       | Relative path to the CFn template in the same directory (typically `template.yaml`).                     |

### Optional keys (ADR-012 thick metadata DSL)

| Key              | Purpose                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------- |
| `i18n.en`        | English overrides for `name` / `shortDescription` / `description` / `learningGoals`. ja stays at top-level; en lives here. Supported locales are **ja + en only** (#1108). |
| `scoring`        | Declares one of 5 builtin kinds (see below). Omit to disable scoring entirely (deploy-only problem).         |
| `endpoints`      | Endpoint registry for uptime / phased-polling kinds (`slot` / `outputKey` / `path`).                          |
| `phases`         | For `phased-polling`. Stages in `afterMinutes` order where score rule or endpoint binding flips over time.    |
| `disruptions`    | In-Battle disruption events. Triggers: `after-deploy` / `team-score-above` / `phase-entered`.                 |
| `dashboard.slots`| Slots for problem-specific React components (`portal/<slot>.tsx`) injected into the participant portal.       |
| `cfnParameters`  | Hints for CFn parameters the operator inputs at deploy time.                                                  |
| `track`          | Position within a systematic curriculum (`{id, order, chapter}`). See [Curriculum tracks](#curriculum-tracks) below. Independent of `onboardingOrder` (a single first-time-onboarding sequence) and `tags` (free-text filters). |
| `simulationOverlay` | Versioned reference to `simulation.json` when binding IaC/probe/disruption sources cannot express an actual Simulator invocation. IAM is authorization inventory, not invocation evidence. See [`SIMULATION.md`](./SIMULATION.md). |
| `nodes`          | Educational knowledge-graph nodes: learning objectives, concepts, assessment criteria, misconceptions, and audiences. Problem nodes are implicit. |
| `relations`      | Directed knowledge-graph edges. The MVP types are `teaches`, `covers`, `requires`, `assesses`, and `related_to`. |

### Simulator overlay

Do not add Simulator metadata by default. The compatibility scanner derives binding
requirements from provider-native IaC, endpoints, scoring probes, and disruptions, while IAM
actions remain non-blocking authorization inventory. Only a concrete execution-evidence gap may
use `simulationOverlay`; the referenced file is validated
against [`SIMULATION_SCHEMA.json`](./SIMULATION_SCHEMA.json). It cannot contain scoring,
answers, flags, secrets, credentials, environment variables, host mounts, or unpinned OCI
images. The complete contract and current nine-problem audit are in
[`SIMULATION.md`](./SIMULATION.md).

### Educational knowledge graph

`nodes` and `relations` add explicit learning dependencies without replacing the existing
flat `tags` or human-facing `learningGoals`. Both graph fields are optional, so existing
problems remain valid. The graph is catalog-wide: a relation may target another problem or a
node declared in another metadata file. Every node ID must therefore be unique across the
catalog.

Problem nodes are created implicitly from metadata IDs as `problem.<problem-id>`. Declare all
other nodes under the collection that defines their type:

| Node type | Collection | ID convention |
| --------- | ---------- | ------------- |
| Problem | implicit | `problem.<problem-id>` |
| Learning Objective | `nodes.learning_objectives` | `lo.<problem-id>.<kebab-slug>` |
| Concept | `nodes.concepts` | `concept.<kebab-slug>` |
| Assessment Criterion | `nodes.assessment_criteria` | `assessment.<problem-id>.<kebab-slug>` |
| Misconception | `nodes.misconceptions` | `misconception.<kebab-slug>` |
| Audience / Role | `nodes.audiences` | `audience.<kebab-slug>` |

Learning-objective and assessment IDs are problem-scoped. Concept, misconception, and audience
IDs are shared vocabulary: declare each shared node once, then reference that ID from other
problems.

| Relation | Allowed endpoints |
| -------- | ----------------- |
| `teaches` | Problem → Learning Objective |
| `covers` | Problem → Concept |
| `requires` | Problem, Learning Objective, or Concept → Problem, Learning Objective, or Concept |
| `assesses` | Problem → Assessment Criterion |
| `related_to` | Any declared node → any declared node |

`requires` is directional: `source` depends on `target`. It can express both concept
prerequisites and problem-to-problem learning order. CI rejects missing `source` / `target`
nodes, duplicate node IDs, invalid endpoint combinations, and every `requires` cycle. It reports
the concrete cycle path so the author can remove or redirect an edge.

```json
{
  "tags": ["api-security", "idor"],
  "learningGoals": ["認証と認可の違いを理解する"],
  "nodes": {
    "learning_objectives": [
      {
        "id": "lo.api-idor-demo.detect-object-authorization-gap",
        "description": "API のオブジェクト単位の認可不備を発見できる"
      }
    ],
    "concepts": [
      {
        "id": "concept.authorization",
        "description": "呼び出し元が対象を操作できるか判断する仕組み"
      }
    ]
  },
  "relations": [
    {
      "type": "teaches",
      "source": "problem.api-idor-demo",
      "target": "lo.api-idor-demo.detect-object-authorization-gap"
    },
    {
      "type": "requires",
      "source": "lo.api-idor-demo.detect-object-authorization-gap",
      "target": "concept.authorization"
    }
  ]
}
```

See [`challenges/api-idor-demo/metadata.json`](./challenges/api-idor-demo/metadata.json) for a
complete example containing all node collections and all five MVP relation types.

### Scoring kinds

One kind per problem. The platform's generic dispatcher (ADR-012 Phase 3) reads `scoring.kind` and dispatches accordingly.

| Kind                | Summary                                                                                                          | Example                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `flag`              | Challenge-style. One submission per deploy; compare submitted flag with the CFn Output named in `flagOutputKey`. | `hello-world`                          |
| `uptime-flat`       | Probe 1–N endpoints independently; award points for each endpoint that returns OK (partial uptime still earns).   | `hello-world-battle`                   |
| `uptime-multi`      | Probe N endpoints; award `pointsAllOk` only when *all* are OK. A single failure → 0 + `failurePenalty`.           | `security-battle-royale`               |
| `phased-polling`    | Polling kind with rules that flip over time. Combine with `phases[]` to express progressive degradation / hosting switches. | `microservice-migration-battle` / `stackstack` |
| `attack-detection`  | Read an attack counter shipped with the problem stack (CFn Output / SSM Parameter / CW metric) and award based on detection count. | (defense side of `security-battle-royale`) |

The legacy `uptime` kind is an alias for `uptime-flat`. New problems should use `uptime-flat`.

### Hints (progressive, shared by all 5 kinds)

`scoring.hints[]` accepts `{id, content, penalty}` entries. Each reveal in the portal deducts `penalty` from `points` (flag) / `pointsPerSuccess` (uptime kinds) / cumulative score (phased-polling / attack-detection) — Issue #742 Phase 5.

## Curriculum tracks

`track` (optional, `{id, order, chapter}`) places a problem inside a systematic curriculum instead of a flat, tag-filtered list — e.g. working through IPA "安全なウェブサイトの作り方" chapter by chapter. A problem with no `track` is not part of any curriculum; existing problems are not retroactively migrated (Issue #177).

| Track ID            | Curriculum                                                             | Problems (in `order`)                          |
| -------------------- | ----------------------------------------------------------------------- | ----------------------------------------------- |
| `ipa-web-security`   | IPA "安全なウェブサイトの作り方" (<https://www.ipa.go.jp/security/vuln/websecurity/about.html>), one chapter per problem | 1. `xss-demo` (§1.5 XSS)                        |

Planned (not yet authored, tracked in Issue #177's Phase 2/3): remaining `ipa-web-security` chapters (CSRF §1.6, OS command injection §1.2, path traversal §1.3, session management §1.4), a `twelve-factor` track (<https://12factor.net/ja/>), and a `well-architected` track scoped to pillars that a Docker-only local drill can honestly reproduce (operational excellence, reliability, performance efficiency — cost optimization and least-privilege security are excluded from the local track since they need a real AWS billing/IAM model to teach honestly).

## template.yaml

A single-page CloudFormation template. **This one file** is pushed into the competitor account on deploy — no S3 upload, no nested stacks.

### Required parameters

So the deploy pipeline can invoke every problem template with the same arguments, every template supports these.

| Parameter             | Required | Purpose                                                                                                |
| --------------------- | -------- | ------------------------------------------------------------------------------------------------------ |
| `NamePrefix`          | ✓        | `tc-{problemSlug}-{teamSlug}` resource prefix. Goes on every resource name / tag.                       |
| `TenkaCloudAccountId` | ✓        | TenkaCloud operator AWS account ID (12 digits). Goes into the `ParticipantViewerRole` trust policy.     |
| `ExternalId`          | ✓        | ExternalId (= jobId) used when AssumeRoling into `ParticipantViewerRole`. Injected by the deploy chain. |
| `AllowedCidr`         | -        | CIDR allowed to access public ports (default `0.0.0.0/0`).                                              |
| Problem-specific params | -      | `DbPassword` / `InstanceType` / etc — free to add per problem.                                          |

### Required resources

| Resource                  | Purpose                                                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `ParticipantViewerRole`   | Read-only IAM Role that competitors AssumeRole into from AWS Console / CLI. Role name is fixed at `${NamePrefix}-participant-viewer`. Trust is `TenkaCloudAccountId:root` + `sts:ExternalId == ExternalId`. Per the ADR-021 baseline, "the Role must only be able to touch resources belonging to this problem". |

The policy requirements for `ParticipantViewerRole` are machine-checked by [`infrastructure/test/problem-deploy/problem-template-participant-viewer-role.test.ts`](../infrastructure/test/problem-deploy/problem-template-participant-viewer-role.test.ts) — `Resource: "*"` is only allowed under a tag-based Condition or via the metadata-only / self-identity API allowlist.

### Naming convention (avoiding collisions)

We assume multiple teams' stacks coexist in the same (Account, Region). Prefix every resource name / tag / group name with `${NamePrefix}`.

```yaml
Resources:
  MyVpc:
    Type: AWS::EC2::VPC
    Properties:
      Tags:
        - Key: Name
          Value: !Sub "${NamePrefix}-vpc"
        - Key: TenkaCloud:NamePrefix
          Value: !Ref NamePrefix
```

Add the `TenkaCloud:NamePrefix` tag to every resource a competitor can see — this is what makes the tag-based Condition (`aws:ResourceTag/TenkaCloud:NamePrefix`) on `ParticipantViewerRole` work.

### Required Outputs

At minimum, the UI / operator / scoring dispatcher reads these.

| Output                       | Purpose                                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------ |
| `NamePrefix`                 | Echo of the deploy-time parameter (debug aid for the operator).                                        |
| `ParticipantViewerRoleArn`   | `!GetAtt ParticipantViewerRole.Arn`. AssumeRoled by the portal's one-click AWS Console federation.     |
| Participant-facing endpoint URLs | `FrontendUrl` / `ApiUrl` etc (uptime / phased-polling kinds). Referenced from `endpoints[].outputKey`. |
| The key named in `flagOutputKey` | Only when `scoring.kind = flag`. This is the value competitors paste into the portal.              |

## Adding a new problem

The scaffolding CLI is the shortest path. Templates exist for each of the 5 kinds under `.claude/templates/problems/<kind>/`.

```bash
# 1. Generate scaffold (Battle uptime-flat example)
bun run scripts/tenkacloud-problem.ts create my-new-problem --kind uptime-flat

# 2. Edit metadata.json and template.yaml

# 3. Validate
bun run scripts/tenkacloud-problem.ts validate my-new-problem
make validate-problems

# 4. (Optional) Smoke deploy
aws cloudformation deploy \
  --template-file problems/battles/my-new-problem/template.yaml \
  --stack-name tc-my-new-problem-test \
  --parameter-overrides NamePrefix=tc-my-new-problem-test TenkaCloudAccountId=<id> ExternalId=<jobId>
```

| Subcommand                                         | Purpose                                                                          |
| -------------------------------------------------- | -------------------------------------------------------------------------------- |
| `tenkacloud-problem.ts list-kinds`                 | List available scoring kinds and their scaffolds.                                |
| `tenkacloud-problem.ts create <id> --kind <kind>`  | Generate scaffold (metadata.json + template.yaml + README skeleton).             |
| `tenkacloud-problem.ts validate <id>`              | SCHEMA + cross-ref check (e.g. `endpoints[].outputKey` exists in CFn Outputs).   |
| `tenkacloud-problem.ts inspect <id>`               | Dump metadata + template + cross-ref in one screen (design review aid).         |

Inside Claude Code, the `/create-problem` skill walks you through requirements → scaffold generation → metadata editing.

## Catalog build pipeline

After adding / editing a problem, the following checks make CI green. `make before-commit` runs them locally.

| Step                                  | What it checks                                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `make validate-problems`              | Validate every `metadata.json` against `SCHEMA.json`.                                                              |
| `make check-problems-index`           | Verify `index.json` matches the current metadata.json set (drift detection). Rebuild via `make build-problems-index`. |
| `make check-template-ascii`           | Templates stay within ASCII + Latin-1 (safe IAM Description characters).                                           |
| `make check-template-security`        | Scan for dangerous patterns in IAM / Security Group / S3 / KMS (e.g. `Action: "*"` + `Resource: "*"`).             |
| `make check-template-cfn-refs`        | Verify `!Ref` / `!GetAtt` reference integrity + presence of the required `ParticipantViewerRole`.                  |
| `bun run cost:check`                   | Verify `cost-report.json` matches the templates (#87 — static AWS cost + leftover-billing estimate). Rebuild via `bun run cost --write`. |

`index.json` is injected at build time into the three SPAs (`apps/admin-console` / `apps/application-admin-console` / `apps/participant-portal`), making `metadata.json` the single source of truth for catalog display.

### Cost visibility (#87)

Each problem's AWS cost is estimated **without deploying** by line-walking its `template.yaml` (`scripts/estimate-cost.ts` + the static rate table in `scripts/lib/cost-rates.ts`). Two generated artifacts hold the result:

- **`cost-report.json`** — full per-problem breakdown (`bun run cost <id>` / `--all` / `--json`). Regenerate with `bun run cost --write`.
- **`index.json` `cost`** — the select-time summary the catalog/admin console reads: `perHourUsd`, `perDayIfLeftRunningUsd`, `freeTierEligible`, and **`alwaysOnResources`** (RDS / ALB / NAT / EIP / Route53 HostedZone — these keep billing even when the stack is idle, so they are the "落とし忘れ" risk). Derived from the same estimator, so rerun `bun run scripts/build-index.ts` after a cost-relevant template change.

**Operate-time (`bun run status`)** — a read-only monitor that lists live CloudFormation stacks and annotates each with its estimated `$/day` (matched to a problem by name, sourced from `cost-report.json`) plus any always-on resources, so a forgotten stack is easy to spot. It calls `aws cloudformation list-stacks` once (does not modify anything); offline you can pipe a saved listing with `bun run status --from-json stacks.json`.

## i18n

Supported locales: **ja + en only** (Issue #1108 deprecated es / zh).

- **`metadata.json` fields**: the platform default locale is still Japanese (= the platform's locale fallback chain is `en → ja → top-level`). Put Japanese strings at the top level (`name` / `shortDescription` / `description` / `learningGoals`) and English overrides under `i18n.en`.
- **`README.md` files** (this repo's docs): primary is English (`README.md`), Japanese mirror is `README.ja.md`. These are GitHub-facing author/contributor docs and are independent of the platform's runtime locale switcher.

If a problem has no English override (= no `i18n.en`), switching the portal's locale switcher to `en` falls back to the Japanese default.

## Related docs

- [`SCHEMA.json`](./SCHEMA.json) — JSON Schema for `metadata.json` (source of truth)
- [`docs/problems/AUTHORING.html`](../docs/problems/AUTHORING.html) — 30-minute onboarding (5-kind decision tree + 4 worked examples)
- [`docs/architecture/adr-012-problem-plugin-architecture.html`](../docs/architecture/adr-012-problem-plugin-architecture.html) — 3-asset model + thick metadata DSL + generic scoring dispatcher
- [`infrastructure/templates/README.md`](../infrastructure/templates/README.md) — Competitor-account setup
- [`docs/gallery.md`](../docs/gallery.md) — Cross-cutting catalog of shipped + planned problems
