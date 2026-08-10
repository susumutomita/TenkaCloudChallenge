# db-challenge-slow-query — 顧客の注文履歴が返ってこない

TenkaCloud Database Track (Phase 1, Chapter 4, Challenge 1) の local-play
Challenge。Docker だけで動作し、AWS アカウントやクラウドリソースは不要。コン
テナ `/verify` 採点契約を checkpoint 単位で使う (`scoring.kind:
"multi-verify"`, TenkaCloud#2252)。

> 訓練用ターゲット。compose は `127.0.0.1` のみに bind する。外部公開しないこと。

このトラックのここまでの Drill (A2、A3、...) と違い、これは **Challenge** で
ある ── `instructions`/`description` のどこにも原因は書かれていない。参加者
に渡すのは遅いクエリ 1 本と、A2 (Index の read/write trade-off)・A3 (Query
Plan と選択性) で既に習得した診断の道具だけ。原因を見つけること自体が課題に
なっている。

## 遊び方

```bash
make local PROBLEM=db-challenge-slow-query   # TenkaCloud リポジトリのルートから
# Participant Portal が開く。任意の非空キーでログインする
```

- **挑戦する場所:** 実際の作業は Portal 内蔵ターミナルの `psql` で行う。ブラ
  ウザ完結ではない。<http://127.0.0.1:18500> は読み取り専用の情報/状態ページ
  (現在の実行計画とバッファ数も見える)。
- **ゴール:** 下の注文履歴クエリが `storefront.orders` の全件走査で無くなる
  ようにする。

内蔵ターミナルがまだ無いビルドの Portal を使っている場合は、手元のターミナル
から同じデータベースへ入れる。

```bash
docker compose -f local/docker-compose.yml exec db-challenge-slow-query \
  psql -U participant -d drill
```

## 症状 (参加者に渡される情報)

> カスタマーサポートから報告: 管理画面である顧客の注文履歴を開くと、いつま
> でも読み込みが終わらない。調べると、遅いのはこのクエリだと分かった:
>
> ```sql
> select id, status, total_cents, created_at
> from storefront.orders
> where customer_id = 2500
> order by created_at desc
> limit 20;
> ```

これ以外は何も渡さない。index の話も、列順の話も、何が悪いかも書かれていない。

## ドメイン

| テーブル                  | 列                                                                             |
| -------------------------- | --------------------------------------------------------------------------------- |
| `storefront.customers`    | `id` (PK)、`email`、`full_name`、`created_at` ── 5,000 行                        |
| `storefront.orders`       | `id` (PK)、`customer_id` (FK)、`status`、`total_cents`、`created_at` ── 30 万行 |

## 赤いニシン (red herring)

`storefront.orders` は index が無いテーブルではない。コンテナが起動した時点
で、既にこの index が存在する:

```sql
create index idx_orders_status_customer on storefront.orders (status, customer_id);
```

この index は本物 ── `pg_indexes` にも実際に現れるので、「このテーブルに
index はあるか」としか確認しない参加者はすぐに見つけてしまう。しかし対象クエ
リは `status` を条件に含んでおらず、`customer_id` だけで絞り込んでいる。

**実際に Postgres 16 で動かして見つけた罠 (仮定ではない):** この Challenge
は当初「実行計画に Seq Scan ノードが無ければ通す」という判定を想定していた。
これは実機で検証した結果、誤りだと分かった。`customer_id` は
`idx_orders_status_customer` の先頭列ではないにもかかわらず、プランナはこの
index を対象クエリに対して選ぶ ── (heap より幅の狭い) この index を全件たど
りながら、各エントリの `customer_id` を直接確認する形で (`Filter` ではなく
`Index Cond`)。これは heap そのものを全件たどるより実際に安いために起こる。
結果として、この対象クエリの実行計画には**起動直後の、参加者が何もしていな
い状態から一度も** `Seq Scan` ノードが現れない。だから「Seq Scan が消えたか」
を合格条件にはできない ── 下の「採点の仕組み」で実際に何を見ているかを説明
する。

## 採点の仕組み

プラットフォームは答えを持たず、提出テキストも読まない。「提出」のたびに
`{ checkpointId, submission }` がコンテナの loopback `/verify`
(`POST http://127.0.0.1:18501/verify`) へ委譲され、対象クエリに対して実際に
`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` を実行し、
`{ checkpointId, correct, message }` を返す。

| checkpoint                              | 実際に何を確認しているか                                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `orders-customer-id-leads-an-index`     | `storefront.orders` の index のうち、列リストが `customer_id` で始まるものが実在するか (「含んでいる」ではない ── 赤いニシンも含んではいるが先頭ではない) |
| `target-query-uses-customer-id-led-index` | 実行計画が実際に選んだ index (`Index Name`) が、`customer_id` を先頭列とする index の集合に含まれるか (「Seq Scan が無いか」ではない ── 上記の罠を参照) |
| `buffers-dramatically-reduced`          | 現在のバッファ数が `max(100, baseline * 0.3)` 以下か。baseline はコンテナ初回起動時 (赤いニシンの index しか無い、参加者がまだ何もしていない状態) に自動で一度だけ記録される |

何度でも再スキャンしてよい。各 checkpoint は独立しており、満点 100 点のうち
30 / 30 / 40 点を占める。

### なぜ「とにかく index を足す」「Seq Scan さえ消えれば」では通らないか

3 つの checkpoint はどれか 1 つの浅い行動だけでは全て通らないよう意図的に重
ねてある。

- 赤いニシンをそのまま放置する、または無関係な列 (例: `total_cents`) に
  index を足す ── `orders-customer-id-leads-an-index` (先頭列が `customer_id`
  でない) と `target-query-uses-customer-id-led-index` (実行計画は相変わら
  ず赤いニシンを使っており、その `Index Name` は customer_id 先頭の集合に
  無い) の両方で落ちる。
- 先頭列が違う**別の** index に手を出す (例: `(created_at desc, customer_id)`
  ── `order by` に合わせたつもりの、それらしく見える罠)。プランナが赤いニシ
  ンの代わりにこちらを選ぶことすらあるが、実測ではむしろ悪化する (下記)。ど
  ちらにせよ `Index Name` は customer_id 先頭の集合に無いため checkpoint 2
  はバッファ数に関係なく落ちる。
- 正しい列順の index を作ったが `ANALYZE` を忘れる ── checkpoint 1 (index
  は先頭列 `customer_id` で実在する) は通るが、統計が古いままだとプランナが
  赤いニシンを選び続けることがあり、checkpoint 2 で落ちうる (A3 と同じ教訓)。
- 本当の対策 (`customer_id` を先頭列とする index を、プランナが実際に選び、
  バッファ数が実測で減った) だけが 3 つとも通る。

### 閾値の根拠

このチャレンジを作成する過程で、実際の Postgres 16 に対して計測した数値
(配布する Docker image そのものに対してではない ── 理由はこの問題が乗った
PR の「検証」節を参照)。赤いニシンが (上記の理由で) それ自体である程度の改
善を偶然もたらしてしまうため、baseline は db-a2-index-tradeoff の「index が
一切無い」baseline よりずっと低い:

| 状態                                                          | 実行計画 (Index Name)                        | バッファ数 (shared hit + read) |
| ------------------------------------------------------------------ | ------------------------------------------------ | -------------------------------- |
| 赤いニシンの index しか無い (baseline)                              | `idx_orders_status_customer` (先頭列が違う、それでも Seq Scan は無い) | 386                               |
| 先頭列が違う**別の** index (`(created_at desc, customer_id)`)        | `idx_orders_created_customer` (これも間違い)         | 396 ── 実測ではむしろ悪化           |
| `customer_id` 単体の index + `ANALYZE` 後                          | `idx_orders_customer_id` (Bitmap Heap/Index Scan) | 65                                |
| `(customer_id, created_at desc)` の複合 index + `ANALYZE` 後        | `idx_orders_customer_created` (Index Scan、Sort 無し) | 26                                |

`buffers-dramatically-reduced` の閾値 (`max(100, baseline * 0.3)` ≈ この
baseline では約 116) は、本当の対策 (65、26) の上に余裕を持ちつつ、対策に
なっていない 2 つ (386、396) の下に十分な余裕を持つ位置にある。

## 提供形態

`metadata.json` は CloudFormation テンプレートの代わりにコンテナ runtime を
宣言し、ホスト側のツールが不要になる Portal 内蔵ターミナル (`runtime.terminal`)
も併せて宣言する:

```jsonc
"runtime": {
  "provider": "docker",
  "engine": "compose",
  "entry": "local/docker-compose.yml",
  "challengeEndpoints": { "Info": "http://127.0.0.1:18500" },
  "verifyUrl": "http://127.0.0.1:18501/verify",
  "secretEnv": ["FLAG_SEED"],
  "terminal": { "service": "db-challenge-slow-query" }
},
"scoring": { "kind": "multi-verify", "checks": [ … 3 checkpoints, 計 100 点 … ] }
```

```
db-challenge-slow-query/
├── metadata.json                # runtime (docker/compose) + scoring (multi-verify) + hints
└── local/
    ├── docker-compose.yml       # 1 service、loopback のみの port + healthcheck
    ├── Dockerfile                # postgres:16-alpine ("participant" stage) + node
    ├── entrypoint.sh             # pg 起動、schema 適用 (赤いニシン index 込み)、1 回だけ seed、app 起動
    ├── app/
    │   ├── server.mjs           # info/status ページ (:8080) + /verify (:8081)。起動時に baseline を記録
    │   ├── pg-client.mjs        # 実 Postgres アダプタ (EXPLAIN 実行、先頭列判定、baseline)
    │   └── package.json         # `postgres` JS driver
    ├── grader/
    │   ├── grade.mjs            # 3 checkpoint 本体 (pure、dependency-injected)
    │   └── grade.test.mjs       # fake client によるユニットテスト。赤いニシン/浅い近道のケースを含む (bun test、実 DB 不要)
    └── db/
        ├── schema.sql           # storefront.customers/orders、赤いニシン index、grading.baseline_buffers、participant role
        └── seed.sql             # 顧客 5,000 行 + 注文 30 万行、set-based で生成
```

## grader のユニットテストを実行する

grader の合否判定ロジックは注入した fake でユニットテスト済み ── 実 Postgres
もネットワークも不要:

```bash
cd local/grader && bun test
```

## FLAG_SEED

`make local` が全ての local-play 問題に注入するが、ここでは未使用 ── 全ての
checkpoint は発見された秘密ではなく、実データベースの状態を読む。
