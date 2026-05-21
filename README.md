# TenkaCloudChallenge

[TenkaCloud](https://github.com/susumutomita/TenkaCloud) プラットフォームの**競技問題ライブラリ**。 platform 本体 (CDK / Lambda / 3 つの SPA) から物理的に分離して、 問題作成者がプラットフォーム repo を clone せずに問題を CRUD できるようにする repo です。

> **このリポジトリは現在 public です。** 後続の問題追加で「答え」や spoiler を含むものは、 個別の問題ディレクトリで `metadata.json` の `visibility: "private"` に倒すか、 services/ 等の答え相当コードを別 private repo に逃がす運用にしてください。 当 repo 自体を private 化する選択もあります (= ADR-003 が想定する main pattern)。

## 関連 ADR

- [ADR-003](https://github.com/susumutomita/TenkaCloud/blob/main/docs/architecture/adr-003-problem-catalog-ddb.html) — 問題カタログを filesystem 自動 discovery から DDB-backed catalog API に移行
- [ADR-010](https://github.com/susumutomita/TenkaCloud/blob/main/docs/architecture/adr-010-api-first-cli-mcp.html) — operator 経路を API-first に (= 当 repo の publish workflow も同じ API 経路を介する設計)
- [ADR-012](https://github.com/susumutomita/TenkaCloud/blob/main/docs/architecture/adr-012-problem-plugin-architecture.html) — 1 問題 = plugin (3-asset model: metadata.json + template.yaml + 任意 portal/services)

## ディレクトリ構造

```
problems/
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
└── SCHEMA.json                    # 当面は本体 repo からコピー (= ADR-003 完成後は API が validate)
.github/workflows/
├── publish.yml                    # main push で問題 zip を S3 にアップロード
└── catalog-pr.yml                 # metadata 変更を本体 repo に PR で同期
```

1 つの問題ディレクトリは ADR-012 thick metadata DSL で書く。 schema は [`problems/SCHEMA.json`](./problems/SCHEMA.json) (本体 repo と同期)。

## 配信フロー (Phase 2 完成後の最終形)

```
[contributor] PR で problems/<category>/<id>/ を更新
       │
       ▼
[main マージ]
       │
       ├──► publish.yml: 該当問題を zip 化 → S3 (= tc-challenges-${env}/<id>/<sha>.zip + latest.zip)
       │
       └──► catalog-pr.yml: metadata.json の diff を本体 repo に PR (= 移行期の transition)
       │
       ▼
[TenkaCloud Worker Lambda] deploy 要求が来たら S3 から 15min TTL presigned URL を発行
       │
       ▼
[CodeBuild] CHALLENGE_PAYLOAD_URL を fetch → CFn deploy
```

## セットアップ (skeleton 段階 = まだ動かない)

現状はファイル構造のみで、 GitHub Actions の workflow は secret 未 bind のため実行に失敗します。 以下を順に整えることで動作開始します。

1. **本体 repo 側で `ChallengePayloadStack`** (= S3 bucket + lifecycle + OIDC trust IAM Role) を deploy。 これは ADR-003 Phase 2.2 で実装予定。
2. CloudFormation 出力の Role ARN を取得。
3. 当 repo の Settings → Secrets and variables → Actions に bind:
   - `AWS_CHALLENGE_PUBLISH_ROLE_ARN` = 上記 Role ARN
   - `TENKACLOUD_CATALOG_BOT_TOKEN` = 本体 repo に PR を作るための PAT (scope=repo) または GitHub App token

## 新しい問題を追加するとき

1. `problems/<category>/<id>/metadata.json` を [`SCHEMA.json`](./problems/SCHEMA.json) に準拠して書く。
2. `template.yaml` (CFn ペライチ) を書く。 必須パラメータ (`NamePrefix` / `TenkaCloudAccountId` / `ExternalId`) と必須 IAM Role (`ParticipantViewerRole`) を含める。
3. 必要なら `portal/<slot>.tsx` / `services/` を追加。
4. PR レビュー後 main にマージ → 自動で S3 publish + 本体 repo catalog PR (= Phase 2 完成後)。

雛形生成は本体 repo の `/create-problem` Claude Code skill か `bun run scripts/tenkacloud-problem.ts create <id> --kind <kind>` を使う。

## ロードマップ (TenkaCloud platform 側)

| Phase | 内容                                                                      | 本 repo への影響                                                             |
| ----- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 0     | ✅ Skeleton (ディレクトリ構造 + workflow 雛形 + SCHEMA コピー)。           | 完了。 既存 GameDay / JAM 構造を `_legacy/` に退避。                         |
| 1     | ✅ 本体 repo の 5 問題を migrate + catalog CI (= ajv validation + cross-ref)。 | 完了。 `_legacy/` 削除。 `problems/{battles,challenges}/` に 5 問題が揃った。 |
| 2     | `ChallengePayloadStack` + OIDC IAM Role を本体 CDK で deploy。            | secret bind により publish.yml が動き始める。                                |
| 3     | DDB-backed Problems Catalog CRUD API。                                    | catalog-pr.yml の役割が一旦終わる (= API 経由 sync に置換)。                 |
| 4     | 本体 repo `problems/` 削除 + source.zip 同梱から除外。                    | 物理分離完了。 platform 更新と問題更新が完全に独立。                         |

## 関連

- 本体 repo: <https://github.com/susumutomita/TenkaCloud>
