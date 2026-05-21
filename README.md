# TenkaCloudChallenge

> 日本語版: [README.ja.md](./README.ja.md)

[![CI](https://github.com/susumutomita/TenkaCloudChallenge/actions/workflows/ci.yml/badge.svg)](https://github.com/susumutomita/TenkaCloudChallenge/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/github/license/susumutomita/TenkaCloudChallenge)](./LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#contributing)
[![Bun](https://img.shields.io/badge/Bun-1.3.11-black?logo=bun)](https://bun.sh)
[![AWS CloudFormation](https://img.shields.io/badge/AWS-CloudFormation-orange?logo=amazonaws)](https://aws.amazon.com/cloudformation/)

> **Open problem library for the [TenkaCloud](https://github.com/susumutomita/TenkaCloud) platform** — real-time AWS competition problems (CTF / SRE / migration) deployed straight from this repo via CloudFormation.

TenkaCloud runs head-to-head **Battles** and self-paced **Challenges** on real AWS accounts. One problem = one directory under this repo. The platform mounts this repo as a git submodule, bundles it into `source.zip`, and deploys each problem's `template.yaml` into the participant's account. **You can ship a new problem with a PR to this repo alone** — no platform-repo changes needed.

## ✨ Why this repo exists

- **Authoring without platform context.** Adding a problem requires only `metadata.json` + `template.yaml` (+ optional portal slot UI and side services). Everything else — scoring, portal rendering, disruption scheduling — is driven generically by the platform from your metadata.
- **One source of truth.** `metadata.json` powers the catalog UI, the scoring engine, and the participant portal wiring. The platform side is a generic dispatcher (ADR-012).
- **Schema-validated in CI.** Every problem is checked against [`SCHEMA.json`](./SCHEMA.json) on every push and PR.
- **Open by design.** This repo holds the **base problem set** that ships under Apache 2.0 (matching the TenkaCloud platform repo). Spoiler-bearing private problems get a separate private repo via the ADR-008 S3 path.

Each problem ships with a per-problem README (English primary, Japanese mirror) describing the story, the solve path, and the learning goals. Browse [`battles/`](./battles/) and [`challenges/`](./challenges/) for the live catalog.

## 🚀 Quick start

```bash
# 1. Install Bun (one-time)
curl -fsSL https://bun.sh/install | bash

# 2. Clone and install
git clone https://github.com/susumutomita/TenkaCloudChallenge.git
cd TenkaCloudChallenge
bun install

# 3. Validate every problem against the schema + cross-refs
bun run validate
```

That's all you need for authoring. AWS credentials are only required when running the *platform* (CDK / Lambda) — not for catalog work in this repo.

## ➕ Add a new problem

1. **Create the directory.** `<category>/<id>/` where `<category>` is `battles` or `challenges` and `<id>` is lowercase kebab-case.
2. **Write `metadata.json`.** Conform to [`SCHEMA.json`](./SCHEMA.json) — see existing problems for working examples. Key fields: `id`, `name`, `category`, `difficulty`, `scoring`, `endpoints`, `disruptions`.
3. **Write `template.yaml`.** A single-page CloudFormation template (the deploy body). Must accept `NamePrefix` / `TenkaCloudAccountId` / `ExternalId` parameters and create the required `ParticipantViewerRole`.
4. **(Optional) Add `portal/<slot>.tsx`** for problem-specific UI in the participant portal, and **`services/`** for any docker-compose / Lambda code your template pulls down (e.g. via EC2 UserData).
5. **Validate locally** with `bun run validate`, open a PR, get it reviewed and merged.

A platform-repo maintainer then bumps the submodule pointer and the next `make deploy` ships your problem.

> For full schema documentation and worked examples see [`CATALOG.md`](./CATALOG.md).

## 🏗️ Repo layout

```
.
├── battles/                       # Battle (real-time, head-to-head)
│   └── <id>/
│       ├── metadata.json          # Source of truth (catalog + scoring + portal wiring)
│       ├── template.yaml          # Single-page CFn template (the deploy body)
│       ├── portal/                # Optional: <slot>.tsx (participant portal UI)
│       └── services/              # Optional: docker-compose / Lambda code
├── challenges/                    # Challenge (self-paced)
│   └── <id>/
│       ├── metadata.json
│       └── template.yaml
├── SCHEMA.json                    # JSON Schema for metadata.json (synced with platform)
├── index.json                     # Catalog index (built from every metadata.json)
├── CATALOG.md                     # Full catalog docs + schema walkthrough
├── scripts/validate-problems.ts   # Local + CI validator
└── .github/workflows/ci.yml       # Schema + cross-ref CI
```

## 🔄 Delivery flow

```
[contributor] open a PR that adds or updates problems
       │
       ▼
[merge to main] CI runs `bun run validate` against every metadata.json
       │
       ▼
[platform repo (= TenkaCloud) bumps the submodule pointer]
       │   git submodule update --remote problems
       │
       ▼
[make deploy] prepare-source-bundle.sh bundles `problems/`
       into source.zip → S3 → CodeBuild deploys template.yaml
```

## 🧠 Architecture references (platform side)

These ADRs live in the [platform repo](https://github.com/susumutomita/TenkaCloud) and explain the runtime contract this repo plugs into:

- **ADR-008** — Private problem payload separation (S3 path for spoiler-bearing add-on problems)
- **ADR-010** — API-first operator path (CLI / MCP)
- **ADR-012** — One problem = one plugin (3-asset model: `metadata.json` + `template.yaml` + optional `portal/services`)

## 🤝 Contributing

PRs are welcome — especially new problems, schema fixes, and English-doc polish.

**Read [`AGENT.md`](./AGENT.md) before opening your first PR** — it documents the invariants the validator enforces and the footguns that have bitten this repo before. If you use Claude Code, type **`/new-problem challenge`** or **`/new-problem battle`** to scaffold a new problem interactively (the skill lives at `.claude/skills/new-problem/`).

- Run `bun run validate` locally before opening a PR.
- Keep `metadata.json` Japanese at the top level and English under `i18n.en` (the platform's locale fallback chain is `en → ja → top-level`). README files are English-primary with `README.ja.md` mirrors.
- One problem per PR keeps reviews tractable.
- Discuss new problem ideas in an Issue first if they need new scoring kinds or portal slots — those touch the platform repo.

See [`CATALOG.md`](./CATALOG.md) for the full schema walkthrough.

## 📜 License

[Apache License 2.0](./LICENSE) — problems and tooling alike. Matches the [TenkaCloud platform repo](https://github.com/susumutomita/TenkaCloud)'s license so contributions can flow between the two without compatibility friction. If you ship problems with spoiler content, host them in a separate private repo and deliver them via the ADR-008 S3 path.

## 🔗 Related

- **Platform repo (CDK / Lambda / 3 SPAs):** <https://github.com/susumutomita/TenkaCloud>
- **JSON Schema:** [`SCHEMA.json`](./SCHEMA.json)
- **Full catalog docs:** [`CATALOG.md`](./CATALOG.md)
