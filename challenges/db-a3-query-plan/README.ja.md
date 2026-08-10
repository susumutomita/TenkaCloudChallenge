# db-a3-query-plan — Query Plan と選択性

TenkaCloud Database Track (Phase 1, Drill A3) の local-play Drill。Docker だけで
動作し、AWS アカウントやクラウドリソースは不要。コンテナ `/verify` 採点契約を
checkpoint 単位で使う (`scoring.kind: "multi-verify"`, TenkaCloud#2252)。

> 訓練用ターゲット。compose は `127.0.0.1` のみに bind する。外部公開しないこと。

## 遊び方

```bash
make local PROBLEM=db-a3-query-plan   # TenkaCloud リポジトリのルートから
# Participant Portal が開く。任意の非空キーでログインする
```

- **挑戦する場所:** 実際の作業は Portal 内蔵ターミナルの `psql` で行う。ブラウ
  ザ完結ではない。<http://127.0.0.1:18420> は読み取り専用の情報/状態ページ (現
  在の実行計画・推定行数・実際の行数も見える)。
- **ゴール:** `analyze support.tickets;` を実行し、`priority = 'urgent'` (希少
  値) と `priority = 'normal'` (大多数を占める値) の実行計画が、選択性に応じて
  使い分けられるようにする。

内蔵ターミナルがまだ無いビルドの Portal を使っている場合は、手元のターミナル
から同じデータベースへ入れる。

```bash
docker compose -f local/docker-compose.yml exec db-a3-query-plan \
  psql -U participant -d drill
```

## ストーリー

`support.tickets` (30 万行) の `priority` 列には最初から index が張られてい
る。だが「index がある」ことと「planner が実際にそれを使う」ことは別問題であ
る。しかも今のテーブルは一度も `ANALYZE` されておらず、planner の row estimate
自体が壊れている状態から始まる。

## ドメイン

| テーブル | 列 |
| --- | --- |
| `support.tickets` | `id` (PK)、`priority` (index つき。urgent が約 50 行/300,000 行 = 0.02%、normal が残り 99.98%)、`subject`、`created_at` |

## コストを観察してから変える

```sql
-- 1. ANALYZE 前: 両方の値で同じ (的外れな) 推定行数が出る。
explain (analyze, buffers)
select * from support.tickets where priority = 'urgent';
-- rows=938 と表示されるが、実際に返るのは 50 行 (Bitmap Heap Scan)

explain (analyze, buffers)
select * from support.tickets where priority = 'normal';
-- rows=938 と表示されるが、実際に返るのは 299,950 行 (それでも Bitmap Heap Scan を選んでしまう)

-- 2. 統計を更新する:
analyze support.tickets;

-- 3. 同じ 2 クエリをもう一度実行する:
explain (analyze, buffers)
select * from support.tickets where priority = 'urgent';
-- Index Scan using idx_tickets_priority ... rows=60 (実際は 50 行)

explain (analyze, buffers)
select * from support.tickets where priority = 'normal';
-- Seq Scan on tickets ... rows=299940 (実際は 299,950 行) ── index からテーブル本体へ
-- 一行ずつ寄り道するより、テーブル全体を素直に読み切る方が実際に安い
```

上記の数値は、このドリルを作成する過程で実際にローカルの Postgres で計測した
ものである (詳細は下の「閾値の根拠」を参照)。手元の環境では同じ桁数になるが、
必ずしも同じ数字にはならない。

## 採点の仕組み

プラットフォームは答えを持たず、提出テキストも読まない。「提出」のたびに
`{ checkpointId, submission }` がコンテナの loopback `/verify`
(`POST http://127.0.0.1:18421/verify`) へ委譲され、2 つの固定クエリに対して実際
に `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` を実行し、`{ checkpointId, correct, message }` を返す。

| checkpoint | 実際に何を確認しているか |
| --- | --- |
| `table-statistics-collected` | `pg_stat_user_tables.last_analyze` に記録があるか (= 実際に `ANALYZE` が実行されたか) |
| `row-estimates-match-reality` | 両クエリについて、EXPLAIN の推定行数 (`Plan Rows`) が実際の行数 (`Actual Rows`) の 5 倍以内に収まっているか |
| `scan-strategy-matches-selectivity` | `urgent` の実行計画が index を使い Seq Scan を含まない、かつ `normal` の実行計画が Seq Scan のみで index を含まないか (両方揃って初めて合格) |

何度でも再スキャンしてよい。各 checkpoint は独立しており、満点 100 点のうち
30 / 30 / 40 点を占める。

### 閾値の根拠

このドリルを作成する過程で、実際の Postgres 16 に対して計測した数値 (配布す
る Docker image そのものに対してではない ── 理由はこの問題が乗った PR の
「検証」節を参照):

| 状態 | urgent (希少値) | normal (大多数を占める値) |
| --- | --- | --- |
| ANALYZE 前 | 推定 938 行 / 実際 50 行、Bitmap Heap Scan | 推定 938 行 / 実際 299,950 行、Bitmap Heap Scan (index を使ってしまう) |
| `ANALYZE` 後 | 推定 60 行 / 実際 50 行、Index Scan | 推定 299,940 行 / 実際 299,950 行、Seq Scan |

`row-estimates-match-reality` の許容比 (5 倍以内) は、ANALYZE 前の実測乖離
(urgent で約 19 倍、normal で約 320 倍) より遥かに厳しく、ANALYZE 後の実測比
(1.0〜1.2 倍) より遥かに緩い ── マシンごとの sampling 誤差に敏感ではない。

## 配信モデル

`metadata.json` は CloudFormation テンプレートの代わりにコンテナ runtime を宣言
し、ホスト側に何もインストールしなくて済むよう Portal 内蔵ターミナル
(`runtime.terminal`) も宣言する。

```jsonc
"runtime": {
  "provider": "docker",
  "engine": "compose",
  "entry": "local/docker-compose.yml",
  "challengeEndpoints": { "Info": "http://127.0.0.1:18420" },
  "verifyUrl": "http://127.0.0.1:18421/verify",
  "secretEnv": ["FLAG_SEED"],
  "terminal": { "service": "db-a3-query-plan" }
},
"scoring": { "kind": "multi-verify", "checks": [ … 3 checkpoints, 満点 100 pts … ] }
```

```
db-a3-query-plan/
├── metadata.json                # runtime (docker/compose) + scoring (multi-verify) + hints
└── local/
    ├── docker-compose.yml       # サービス 1 つ、loopback のみに port 公開 + healthcheck
    ├── Dockerfile                # postgres:16-alpine ("participant" stage) + node
    ├── entrypoint.sh             # pg 起動 → schema 適用 → 1 回だけ 30 万行 seed (ANALYZE なし) → app 起動
    ├── app/
    │   ├── server.mjs           # 情報/状態ページ (:8080) + /verify (:8081)
    │   ├── pg-client.mjs        # 実 Postgres アダプタ (EXPLAIN 実行、統計確認)
    │   └── package.json         # `postgres` JS driver
    ├── grader/
    │   ├── grade.mjs            # 3 つの checkpoint (pure, dependency-injected)
    │   └── grade.test.mjs       # fake client を使う unit test (bun test、実 DB 不要)
    └── db/
        ├── schema.sql           # support.tickets、index、participant role
        └── seed.sql             # 30 万行、set-based に生成。ANALYZE は意図的に実行しない
```

## なぜ ANALYZE を意図的に飛ばすか

db-a2-index-tradeoff の seed.sql は最後に `analyze shop.orders;` を呼んでい
るが、db-a3-query-plan の seed.sql は呼ばない。これはこのドリルの核心的な仕
掛けである ── バルクロード直後に統計が古いまま (あるいは皆無のまま) という状
態は、実務でも非常によく起きる。`local/db/schema.sql` は加えて
`support.tickets` に `autovacuum_enabled = false` を設定しており、
autovacuum が背後で勝手に統計を更新してしまい「未 ANALYZE の状態」がドリル開
始前に消えてしまうことを防いでいる。

## grader の unit test を実行する

grader の合否ロジックは fake client による unit test で担保されている ── 実
Postgres 不要、ネットワーク不要。

```bash
cd local/grader && bun test
```

## FLAG_SEED

`make local` が全ての local-play 問題に注入する変数だが、このドリルでは未使
用。全 checkpoint は隠された秘密ではなく実データベースの状態を読む。
