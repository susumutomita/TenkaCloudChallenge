# TenkaCloudChallenge

> English: [README.md](./README.md)

[![CI](https://github.com/susumutomita/TenkaCloudChallenge/actions/workflows/ci.yml/badge.svg)](https://github.com/susumutomita/TenkaCloudChallenge/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/github/license/susumutomita/TenkaCloudChallenge)](./LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#コントリビュート)
[![Bun](https://img.shields.io/badge/Bun-1.3.11-black?logo=bun)](https://bun.sh)
[![AWS CloudFormation](https://img.shields.io/badge/AWS-CloudFormation-orange?logo=amazonaws)](https://aws.amazon.com/cloudformation/)

> **[TenkaCloud](https://github.com/susumutomita/TenkaCloud) プラットフォーム公式の問題ライブラリ** — 実 AWS アカウント上で動く競技問題 (CTF / SRE / migration) を CloudFormation で deploy する。

TenkaCloud は実 AWS で動くリアルタイム **Battle** と個別演習 **Challenge** をホストするプラットフォームです。 本 repo は問題本体の OSS カタログで、 1 ディレクトリ = 1 問題。 platform 本体は本 repo を git submodule として mount し、 `source.zip` に同梱して各問題の `template.yaml` を競技者アカウントに deploy します。 **新問題は本 repo の PR だけで追加できます** — platform 本体の repo は触らなくて OK。

## ✨ なぜ本 repo があるか

- **platform 知識ゼロでも問題を書ける**。 必要なのは `metadata.json` + `template.yaml` (+ 任意の portal slot UI と side services) だけ。 scoring / portal 表示 / disruption schedule は platform 側が metadata から generic に駆動する。
- **正本は 1 つ**。 `metadata.json` がカタログ UI、 scoring engine、 portal plugin の wiring を全部駆動する。 platform 側は generic dispatcher (ADR-012)。
- **CI で schema 検証**。 push / PR ごとに [`SCHEMA.json`](./SCHEMA.json) で全問題を validate。
- **OSS 前提**。 本 repo は Apache 2.0 で配布する **ベース問題セット** (= TenkaCloud platform 本体と同じライセンス)。 答え / spoiler を含む問題は別 private repo に置いて ADR-008 の S3 経路で配信する。

各問題は per-problem README (英語 primary + 日本語 mirror) を持ち、 ストーリー / 解き方 / 学習目的が書いてある。 ライブカタログは [`battles/`](./battles/) と [`challenges/`](./challenges/) を参照。

## 🚀 クイックスタート

```bash
# 1. Bun を入れる (初回のみ)
curl -fsSL https://bun.sh/install | bash

# 2. clone + install
git clone https://github.com/susumutomita/TenkaCloudChallenge.git
cd TenkaCloudChallenge
bun install

# 3. 全問題を schema + cross-ref で validate
bun run validate
```

これだけで問題作成に必要な環境は揃う。 AWS credentials は **platform** (CDK / Lambda) を動かすときだけ必要で、 本 repo の catalog 作業では不要。

## ➕ 新しい問題を追加する

1. **ディレクトリを作る**。 `<category>/<id>/` (= `<category>` は `battles` / `challenges`、 `<id>` は lowercase kebab-case)。
2. **`metadata.json` を書く**。 [`SCHEMA.json`](./SCHEMA.json) に準拠。 既存問題が動く reference。 主キー: `id` / `name` / `category` / `difficulty` / `scoring` / `endpoints` / `disruptions`。
3. **`template.yaml` を書く**。 CFn ペライチ (deploy 本体)。 必須パラメータ (`NamePrefix` / `TenkaCloudAccountId` / `ExternalId`) と必須 IAM Role (`ParticipantViewerRole`) を含める。
4. **(任意) `portal/<slot>.tsx`** で participant portal に問題固有 UI を差し込み、 **`services/`** で template が pull してくる docker-compose / Lambda code を置く (例: EC2 UserData から fetch)。
5. **ローカルで `bun run validate`** → PR → レビュー → main マージ。

platform repo の maintainer が submodule pointer を更新すると、 次の `make deploy` で deploy される。

> Schema 詳解と worked example は [`CATALOG.md`](./CATALOG.md) を参照。

## 🏗️ リポジトリ構造

```
.
├── battles/                       # Battle (リアルタイム対戦)
│   └── <id>/
│       ├── metadata.json          # 正本 (catalog + scoring + portal wiring)
│       ├── template.yaml          # CFn ペライチ (deploy 本体)
│       ├── portal/                # 任意: <slot>.tsx (participant portal UI)
│       └── services/              # 任意: docker-compose / Lambda code
├── challenges/                    # Challenge (個別演習)
│   └── <id>/
│       ├── metadata.json
│       └── template.yaml
├── SCHEMA.json                    # metadata.json の JSON Schema (本体 repo と同期)
├── index.json                     # カタログ index (全 metadata から build)
├── CATALOG.md                     # カタログ docs + schema walkthrough
├── scripts/validate-problems.ts   # local + CI validator
└── .github/workflows/ci.yml       # schema + cross-ref CI
```

## 🎮 設計の基準 — ドリルではなく、面白い問題を

新しい競技問題は 1 つの基準で測る: プレイヤーが「宿題」ではなく **「面白い」** と呼べること。 4 つの性質 — [`new-problem`](./.claude/skills/new-problem/SKILL.md) 作問 skill に成文化:

1. **発見型フラグ**。 フラグは deploy ごとのランダム値で、 意図した AWS 操作をして初めて入手できる — 暗記した概念名ではない。
2. **設定変更で直す・手で新規作成しない**。 テンプレは壊れた状態でリソースを作り、 解法は既存リソースの *変更*。 トップレベルリソースを手で作らないので `delete-stack` で孤児が残らない。
3. **本物の「気づき」**。 `curl` が *ハング* するか *拒否* されるか等、 答えを読むのではなくパケットで体得する実運用スキル。
4. **ストーリーと緊張感**。 共通世界観 (前任の SRE の置き土産、 CTO) を保ちつつ、 毎回新しい事件で。

リファレンス実装: [`challenges/net-evo-01-reachability`](./challenges/net-evo-01-reachability/) — **インターネット進化史** シリーズ Ep01。 各話はインターネットが進化した 1 場面を、 TCP/IP の層を *操作* して追体験する (Ep01: ステートフル SG vs ステートレス NACL)。

## 🎯 カタログ

少数精鋭の厳選セット ── **すべての問題が上記の設計基準に沿う**。 量より質: 暗記ドリルはゲームではないので、 以前の試験対策ラボ群は削除した。

| Status | Category  | Problem                                                                                       | Duration   | Difficulty |
| ------ | --------- | --------------------------------------------------------------------------------------------- | ---------- | ---------- |
| ready  | Challenge | [`hello-world`](./challenges/hello-world/)                                                     | 1 分       | 1          |
| ready  | Challenge | [`net-evo-01-reachability`](./challenges/net-evo-01-reachability/) (インターネット進化史 Ep01) | 30-45 分   | 3          |
| ready  | Challenge | [`net-evo-02-dns`](./challenges/net-evo-02-dns/) (インターネット進化史 Ep02)                    | 45-60 分   | 3          |
| ready  | Challenge | [`net-evo-03-egress`](./challenges/net-evo-03-egress/) (インターネット進化史 Ep03)              | 30-45 分   | 3          |
| ready  | Challenge | [`net-evo-04-tls`](./challenges/net-evo-04-tls/) (インターネット進化史 Ep04)                    | 30-45 分   | 3          |
| ready  | Challenge | [`net-evo-05-edge`](./challenges/net-evo-05-edge/) (インターネット進化史 Ep05)                  | 30-45 分   | 3          |
| ready  | Battle    | [`hello-world-battle`](./battles/hello-world-battle/)                                          | 30 分      | 1          |
| ready  | Battle    | [`microservice-migration-battle`](./battles/microservice-migration-battle/)                   | 90-120 分  | 4          |
| ready  | Battle    | [`security-battle-royale`](./battles/security-battle-royale/)                                  | 60-90 分   | 4          |
| ready  | Battle    | [`stackstack`](./battles/stackstack/)                                                          | 90-120 分  | 4          |

初開催向け bundle: [`bundles/starter-event.json`](./bundles/starter-event.json) — Challenge 1 + Battle 2、 60-90 分枠。

**インターネット進化史** Challenge シリーズ (`net-evo-*`) がカタログの背骨 ── 各話はインターネットが進化した 1 場面を、 TCP/IP の層を *操作* して追体験する。

## 🔄 配信フロー

```
[contributor] PR で問題を追加 / 更新
       │
       ▼
[main マージ] CI が `bun run validate` を全 metadata.json に対して走らせる
       │
       ▼
[platform repo (= TenkaCloud) が submodule pointer を更新]
       │   git submodule update --remote problems
       │
       ▼
[make deploy] prepare-source-bundle.sh が `problems/` を
       source.zip に同梱 → S3 → CodeBuild が template.yaml を deploy
```

## 🧠 アーキテクチャ参照 (platform 側)

これらの ADR は [platform repo](https://github.com/susumutomita/TenkaCloud) にあり、 本 repo が plug-in する runtime 契約を定義する:

- **ADR-008** — private 問題 payload 分離 (= spoiler を含む追加問題向け S3 経路)
- **ADR-010** — operator 経路を API-first に (CLI / MCP)
- **ADR-012** — 1 問題 = 1 plugin (3-asset model: `metadata.json` + `template.yaml` + 任意 `portal/services`)

## 🤝 コントリビュート

PR 歓迎 — 特に新問題 / schema 修正 / 英語ドキュメント整備。

**初めて PR を出す前に [`AGENT.md`](./AGENT.md) を読んでください** — validator が強制する invariants と、 過去にこの repo で踏み抜かれてきた footgun が網羅されている。 Claude Code を使う場合は **`/new-problem challenge`** または **`/new-problem battle`** を叩けば skill (`.claude/skills/new-problem/`) が scaffold を対話で誘導する。

- PR を出す前にローカルで `bun run validate` が green になることを確認。
- `metadata.json` は top-level を日本語、 英語は `i18n.en` に置く (= platform の locale fallback chain は `en → ja → top-level`)。 README は英語 primary + `README.ja.md` mirror。
- 1 PR = 1 問題が review しやすい。
- 新しい scoring kind / portal slot を導入する問題は、 platform 側に変更が必要になるので先に Issue で相談。

Schema 詳解は [`CATALOG.md`](./CATALOG.md) を参照。

## 📜 ライセンス

[Apache License 2.0](./LICENSE) — 問題本体も tooling も Apache 2.0。 [TenkaCloud platform 本体](https://github.com/susumutomita/TenkaCloud) と同じライセンスなので、 双方向にコードを流せる。 spoiler を含む問題を配信する場合は private repo に置いて ADR-008 の S3 経路で配信する。

## 🔗 関連

- **Platform repo (CDK / Lambda / 3 SPAs):** <https://github.com/susumutomita/TenkaCloud>
- **JSON Schema:** [`SCHEMA.json`](./SCHEMA.json)
- **カタログ詳解:** [`CATALOG.md`](./CATALOG.md)
- **作問の設計基準 (skill):** [`.claude/skills/new-problem/SKILL.md`](./.claude/skills/new-problem/SKILL.md)
