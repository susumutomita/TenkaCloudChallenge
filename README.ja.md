# TenkaCloudChallenge

> English: [README.md](./README.md)

[TenkaCloud](https://github.com/susumutomita/TenkaCloud) プラットフォームの**競技問題ライブラリ**。 platform 本体 repo (CDK / Lambda / 3 SPA) は本 repo を **git submodule として `problems/` 配下に mount** し、 `make deploy` で source.zip に同梱して配信します。 問題作成者はプラットフォーム repo を clone せず、 本 repo だけで問題を追加できます。

> **このリポジトリは現在 public です。** 後続で「答え」「spoiler」 を含む問題を追加するなら、 別の private repo を立てて ChallengePayloadStack の S3 経路で配信する設計を取ってください (= ADR-008 経路)。 本 repo は **ベース問題セット** (= プラットフォームに同梱しても OSS 可能な公開問題) を持ちます。

## 関連 ADR (platform 側)

- [ADR-008](https://github.com/susumutomita/TenkaCloud/blob/main/docs/architecture/) — private 問題 payload 分離 (= 追加問題向け S3 経路)
- [ADR-010](https://github.com/susumutomita/TenkaCloud/blob/main/docs/architecture/adr-010-api-first-cli-mcp.html) — operator 経路を API-first に
- [ADR-012](https://github.com/susumutomita/TenkaCloud/blob/main/docs/architecture/adr-012-problem-plugin-architecture.html) — 1 問題 = plugin (3-asset model: metadata.json + template.yaml + 任意 portal/services)

## ディレクトリ構造

本 repo の root が `problems/` 相当 (= 本体 submodule mount 先と一致)。

```
.
├── battles/                       # Battle (リアルタイム対戦)
│   └── <id>/
│       ├── metadata.json
│       ├── template.yaml
│       ├── portal/                # 任意: <slot>.tsx (= participant portal の差し込み UI)
│       └── services/              # 任意: 問題固有の実装 (= docker-compose / Lambda code 等)
├── challenges/                    # Challenge (個別演習)
│   └── <id>/
│       ├── metadata.json
│       └── template.yaml
├── SCHEMA.json                    # metadata.json JSON Schema (= 本体 repo と同期)
├── index.json                     # catalog 一覧 (= 全 metadata から build される)
├── CATALOG.md / CATALOG.ja.md     # カタログ ドキュメント (= 本体 problems/README.md と同期)
├── scripts/validate-problems.ts   # ローカル + CI で metadata + cross-ref を validate
├── package.json + bun.lock        # ajv 等 catalog CI の依存
└── .github/workflows/ci.yml       # validate を GitHub Actions で走らせる
```

1 つの問題ディレクトリは ADR-012 thick metadata DSL で書く。 schema は [`SCHEMA.json`](./SCHEMA.json) (本体 repo と同期)。

## 配信フロー

```
[contributor] PR で battles/<id>/ or challenges/<id>/ を更新
       │
       ▼
[main マージ]
       │
       ▼
[platform repo (= TenkaCloud) 側で submodule pointer を更新]
       │   git submodule update --remote problems
       │   git add problems && git commit
       ▼
[make deploy] prepare-source-bundle.sh が `problems/` 配下 (= 本 repo の中身) を
       source.zip に同梱 → S3 → CodeBuild が local-path で template.yaml を deploy
```

submodule pointer 更新は platform repo の maintainer 操作。 自動化したい場合は GitHub Actions で `git submodule update --remote` → PR 経路 (= 旧 `catalog-pr.yml`) を追加で組む。

## 新しい問題を追加するとき

1. `<category>/<id>/metadata.json` を [`SCHEMA.json`](./SCHEMA.json) に準拠して書く。
2. `template.yaml` (CFn ペライチ) を書く。 必須パラメータ (`NamePrefix` / `TenkaCloudAccountId` / `ExternalId`) と必須 IAM Role (`ParticipantViewerRole`) を含める。
3. 必要なら `portal/<slot>.tsx` / `services/` を追加。
4. ローカルで `bun run validate` (= 本 repo) で schema + cross-ref を pass。
5. PR レビュー後 main にマージ → platform repo の maintainer が submodule pointer を更新。

雛形生成は本体 repo の `/create-problem` Claude Code skill か `bun run scripts/tenkacloud-problem.ts create <id> --kind <kind>` を使う (= 雛形 CLI は platform 側に残す)。

## 関連

- 本体 repo: <https://github.com/susumutomita/TenkaCloud>
