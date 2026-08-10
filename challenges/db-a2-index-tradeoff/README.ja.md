# db-a2-index-tradeoff — Index の read/write trade-off

TenkaCloud Database Track (Phase 1, Drill A2) の local-play Drill。Docker だけで
動作し、AWS アカウントやクラウドリソースは不要。コンテナ `/verify` 採点契約を
checkpoint 単位で使う (`scoring.kind: "multi-verify"`, TenkaCloud#2252)。

> 訓練用ターゲット。compose は `127.0.0.1` のみに bind する。外部公開しないこと。

## 遊び方

```bash
make local PROBLEM=db-a2-index-tradeoff   # TenkaCloud リポジトリのルートから
# Participant Portal が開く。任意の非空キーでログインする
```

- **挑戦する場所:** 実際の作業は Portal 内蔵ターミナルの `psql` で行う。ブラウ
  ザ完結ではない。<http://127.0.0.1:18410> は読み取り専用の情報/状態ページ (現
  在の実行計画とバッファ数も見える)。
- **ゴール:** `select * from shop.orders where order_number = 'ORD-00256789';`
  が全件走査で無くなるようにする。

内蔵ターミナルがまだ無いビルドの Portal を使っている場合は、手元のターミナル
から同じデータベースへ入れる。

```bash
docker compose -f local/docker-compose.yml exec db-a2-index-tradeoff \
  psql -U participant -d drill
```

## ストーリー

`shop.orders` は 40 万行あるが、主キー (`id`) 以外に index が無い。カスタマー
サポートは 1 日中 `order_number` で注文を検索しているが、そのたびにテーブル全
体を読んでいる。

## ドメイン

| テーブル       | 列                                                                             |
| -------------- | ------------------------------------------------------------------------------- |
| `shop.orders` | `id` (PK)、`order_number`、`customer_email`、`amount_cents`、`status`、`created_at` ── 40 万行 |

## コストを観察してから変える

```sql
-- 1. order_number に index が無い: プランナには全件走査しか選べない。
explain (analyze, buffers)
select * from shop.orders where order_number = 'ORD-00256789';
-- Seq Scan on orders ... Buffers: shared hit=4651

-- 2. index を作り、プランナの統計を更新する:
create index idx_orders_order_number on shop.orders (order_number);
analyze shop.orders;

-- 3. 同じクエリをもう一度実行する:
explain (analyze, buffers)
select * from shop.orders where order_number = 'ORD-00256789';
-- Index Scan using idx_orders_order_number ... Buffers: shared hit=1 read=3

-- 4. (採点対象ではないが体験の core) 書き込み側のコストを体感する:
\timing on
insert into shop.orders (order_number, customer_email, amount_cents, status)
select 'ORD-EXTRA' || i, 'x@example.com', 100, 'paid' from generate_series(1, 10000) i;
-- index を作る前に同じ insert を実行した場合の所要時間と比べてみる
```

上記の数値は、このドリルを作成する過程で実際にローカルの Postgres で計測した
ものである (詳細は下の「閾値の根拠」を参照)。手元の環境では同じ桁数になるが、
必ずしも同じ数字にはならない。

## 採点の仕組み

プラットフォームは答えを持たず、提出テキストも読まない。「提出」のたびに
`{ checkpointId, submission }` がコンテナの loopback `/verify`
(`POST http://127.0.0.1:18411/verify`) へ委譲され、対象クエリに対して実際に
`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` を実行し、`{ checkpointId, correct, message }` を返す。

| checkpoint                     | 実際に何を確認しているか                                                                                     |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `order-number-index-exists`    | `pg_indexes` に `order_number` を含む index が実在するか                                                     |
| `query-plan-avoids-seq-scan`   | 対象クエリの実行計画に `Seq Scan` ノードが**存在せず**、Index 系ノード (`Index Scan` / `Index Only Scan` / `Bitmap Index Scan`) が**存在する**か ── プランナが実際に index を選ばなければ通らない |
| `buffers-dramatically-reduced` | 現在のバッファ数 (Shared Hit + Shared Read の合計) が `max(50, baseline * 0.1)` 以下か。baseline はコンテナが初めて起動したとき (= 参加者が index を作りようがないタイミング) に自動で一度だけ記録される |

何度でも再スキャンしてよい。各 checkpoint は独立しており、満点 100 点のうち
30 / 30 / 40 点を占める。

### 閾値の根拠

このドリルを作成する過程で、実際の Postgres 16 に対して計測した数値 (配布す
る Docker image そのものに対してではない ── 理由はこの問題が乗った PR の
「検証」節を参照):

| 状態                          | 実行計画      | バッファ数 (shared hit + read) |
| ------------------------------ | ------------- | -------------------------------- |
| index 追加前 (baseline)       | `Seq Scan`    | 4651                              |
| `CREATE INDEX` + `ANALYZE` 後 | `Index Scan`  | 4                                 |

`buffers-dramatically-reduced` の閾値 (`max(50, baseline * 0.1)` = ここでは
465) は、実測した「解けた」値 (4) より 1 桁以上大きい余裕を持たせてあるので、
マシンごとの誤差に敏感ではない。

## 配信モデル

`metadata.json` は CloudFormation テンプレートの代わりにコンテナ runtime を宣言
し、ホスト側に何もインストールしなくて済むよう Portal 内蔵ターミナル
(`runtime.terminal`) も宣言する。

```jsonc
"runtime": {
  "provider": "docker",
  "engine": "compose",
  "entry": "local/docker-compose.yml",
  "challengeEndpoints": { "Info": "http://127.0.0.1:18410" },
  "verifyUrl": "http://127.0.0.1:18411/verify",
  "secretEnv": ["FLAG_SEED"],
  "terminal": { "service": "db-a2-index-tradeoff" }
},
"scoring": { "kind": "multi-verify", "checks": [ … 3 checkpoints, 満点 100 pts … ] }
```

```
db-a2-index-tradeoff/
├── metadata.json                # runtime (docker/compose) + scoring (multi-verify) + hints
└── local/
    ├── docker-compose.yml       # サービス 1 つ、loopback のみに port 公開 + healthcheck
    ├── Dockerfile                # postgres:16-alpine ("participant" stage) + node
    ├── entrypoint.sh             # pg 起動 → schema 適用 → 1 回だけ 40 万行 seed → app 起動
    ├── app/
    │   ├── server.mjs           # 情報/状態ページ (:8080) + /verify (:8081)。起動時に baseline を記録
    │   ├── pg-client.mjs        # 実 Postgres アダプタ (EXPLAIN 実行、index 確認、baseline)
    │   └── package.json         # `postgres` JS driver
    ├── grader/
    │   ├── grade.mjs            # 3 つの checkpoint (pure, dependency-injected)
    │   └── grade.test.mjs       # fake client を使う unit test (bun test、実 DB 不要)
    └── db/
        ├── schema.sql           # shop.orders、grading.baseline_buffers (author-only)、participant role
        └── seed.sql             # 40 万行、set-based に生成
```

## なぜ baseline をファイルではなくデータベースに置くか

「index 追加前」のバッファ数は、コンテナが初めてビルド・起動されたその瞬間に
一度だけ記録しなければならない ── 参加者の index が既に存在する状態で後から
再計算したら、その数字はもう意味を持たない。`grading.baseline_buffers` は
`participant` に一切の権限を与えていない専用スキーマのテーブルなので、コンテ
ナ再起動 (同じ Postgres データボリューム) を跨いで残り、ドリル側からは読み出
しも改ざんもできない。

## grader の unit test を実行する

grader の合否ロジックは fake client による unit test で担保されている ── 実
Postgres 不要、ネットワーク不要。

```bash
cd local/grader && bun test
```

## FLAG_SEED

`make local` が全ての local-play 問題に注入する変数だが、このドリルでは未使
用。全 checkpoint は隠された秘密ではなく実データベースの状態を読む。
