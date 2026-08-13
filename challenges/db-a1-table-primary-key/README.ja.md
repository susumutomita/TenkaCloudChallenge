# db-a1-table-primary-key — Table / Row / Primary Key

TenkaCloud Database Track (Phase 1, Drill A1) の local-play Drill。Docker だけで
動作し、AWS アカウントやクラウドリソースは不要。コンテナ `/verify` 採点契約を
checkpoint 単位で使う (`scoring.kind: "multi-verify"`, TenkaCloud#2252)。

> 訓練用ターゲット。compose は `127.0.0.1` のみに bind する。外部公開しないこと。

## 遊び方

```bash
make local PROBLEM=db-a1-table-primary-key   # TenkaCloud リポジトリのルートから
# Participant Portal が開く。任意の非空キーでログインする
```

- **挑戦する場所:** 実際の作業は Portal 内蔵ターミナルの `psql` で行う。ブラウザ
  完結ではない。<http://127.0.0.1:18400> は読み取り専用の情報/状態ページ。
- **ゴール:** `email` を PRIMARY KEY とする `training.members` を作り、重複を除
  いたデータを読み込み、同じ email をもう一度 insert すると Postgres 自身が拒否
  することを確認する。

内蔵ターミナルがまだ無いビルドの Portal を使っている場合は、手元のターミナルか
ら同じデータベースへ入れる。

```bash
docker compose -f local/docker-compose.yml exec db-a1-table-primary-key \
  psql -U participant -d drill
```

## ストーリー

前任者が作った会員名簿 `training.members_unkeyed` には、同じ人物が 2 回、3 回
と重複して登録されている ── 再登録、テスト行、タイムアウト後のリトライ。テー
ブルにはそれを止める記述が何も無い。

## ドメイン

| テーブル                    | 列                                                                 |
| --------------------------- | -------------------------------------------------------------------- |
| `training.members_unkeyed` | `id` (PK だが無意味な連番)、`email`、`display_name`、`created_at` ── 事前 seed 済み、11 行 / 7 名 |
| `training.members`         | **自分で作る** ── `email` を PRIMARY KEY、`display_name`             |

## バグを観察してから直す

```sql
-- 1. 同じ email が複数回、別々の行として存在する:
select ctid, id, email, display_name from training.members_unkeyed order by email, id;

-- 2. もう 1 行重複を追加しても何も止まらない:
insert into training.members_unkeyed (email, display_name) values ('aoi@example.com', 'dup-test');
-- INSERT 0 1 — Postgres には拒否する理由が無い。

-- 3. 本当にキーを宣言したテーブルを作る:
create table training.members (
  email        text primary key,
  display_name text not null
);

-- 4. 重複を除いたデータを読み込む (email ごとに最初の行を採用):
insert into training.members (email, display_name)
select distinct on (email) email, display_name
from training.members_unkeyed
order by email, id;

-- 5. キー付きのテーブルへ同じ重複を試す:
insert into training.members (email, display_name) values ('aoi@example.com', 'dup-test');
-- ERROR: duplicate key value violates unique constraint "members_pkey"
```

手順 2 と 5 は、ほぼ同じ見た目の 2 つのテーブルに対する同じ操作である。違いは
「何を PRIMARY KEY として宣言しているか」だけ。

## 採点の仕組み

プラットフォームは答えを持たず、提出テキストも読まない。「提出」のたびに
`{ checkpointId, submission }` がコンテナの loopback `/verify`
(`POST http://127.0.0.1:18401/verify`) へ委譲され、**実際の Postgres の状態**
を問い合わせて `{ checkpointId, correct, message }` を返す。

| checkpoint                      | 実際に何を問い合わせているか                                                                     |
| --------------------------------- | ---------------------------------------------------------------------------------------------- |
| `members-table-has-primary-key` | `pg_index` / `pg_attribute`: `training.members` に `email` を含む PRIMARY KEY が実在するか       |
| `members-rows-loaded`           | `training.members` の行数 == `training.members_unkeyed` の重複無し email 件数 (7) か             |
| `duplicate-insert-rejected`     | grader 自身が既存 email を `training.members` へ insert してみる (常にロールバックする使い捨てトランザクション内) ── Postgres が `23505` で拒否するか |

何度でも再スキャンしてよい。各 checkpoint は独立しており、満点 100 点のうち
30 / 30 / 40 点を占める。

## 配信モデル

`metadata.json` は CloudFormation テンプレートの代わりにコンテナ runtime を宣言
し、ホスト側に何もインストールしなくて済むよう Portal 内蔵ターミナル
(`runtime.terminal`) も宣言する。

```jsonc
"runtime": {
  "provider": "docker",
  "engine": "compose",
  "entry": "local/docker-compose.yml",
  "challengeEndpoints": { "Info": "http://127.0.0.1:18400" },
  "verifyUrl": "http://127.0.0.1:18401/verify",
  "secretEnv": ["FLAG_SEED"],
  "terminal": { "service": "db-a1-table-primary-key" }
},
"scoring": { "kind": "multi-verify", "checks": [ … 3 checkpoints, 満点 100 pts … ] }
```

```
db-a1-table-primary-key/
├── metadata.json                # runtime (docker/compose) + scoring (multi-verify) + hints
└── local/
    ├── docker-compose.yml       # サービス 1 つ、loopback のみに port 公開 + healthcheck
    ├── Dockerfile                # postgres:16-alpine ("participant" stage) + node
    ├── entrypoint.sh             # pg 起動 → schema 適用 → 1 回だけ seed → app 起動
    ├── app/
    │   ├── server.mjs           # 情報ページ (:8080) + /verify (:8081)
    │   ├── pg-client.mjs        # grader が使う実 Postgres アダプタ
    │   └── package.json         # `postgres` JS driver
    ├── grader/
    │   ├── grade.mjs            # 3 つの checkpoint (pure, dependency-injected)
    │   └── grade.test.mjs       # fake client を使う unit test (bun test、実 DB 不要)
    └── db/
        ├── schema.sql           # training スキーマ、members_unkeyed、participant role
        └── seed.sql             # 7 名、11 行 (意図的な重複 3 件)
```

## grader の unit test を実行する

grader の合否ロジックは fake client による unit test で担保されている ── 実
Postgres 不要、ネットワーク不要。

```bash
cd local/grader && bun test
```

## FLAG_SEED

`make local` が全ての local-play 問題に注入する変数だが、このドリルでは未使
用。全 checkpoint は隠された秘密ではなく実データベースの状態を読む。
