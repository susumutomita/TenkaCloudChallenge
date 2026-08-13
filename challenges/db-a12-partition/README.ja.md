# db-a12-partition — 大量削除の単位: row か partition か

TenkaCloud Database Track (Phase 1, 3 章, Drill A12) の local-play Drill。Docker
だけで動作し、AWS アカウントやクラウドリソースは不要。コンテナ `/verify` 採点
契約を checkpoint 単位で使う (`scoring.kind: "multi-verify"`, TenkaCloud#2252)。

> 訓練用ターゲット。compose は `127.0.0.1` のみに bind する。外部公開しないこと。

## 遊び方

```bash
make local PROBLEM=db-a12-partition   # TenkaCloud リポジトリのルートから
# Participant Portal が開く。任意の非空キーでログインする
```

- **挑戦する場所:** 実際の作業は Portal 内蔵ターミナルの `psql` で行う。ブラウ
  ザ完結ではない。<http://127.0.0.1:18470> は読み取り専用の情報/状態ページ。
- **ゴール:** 月別に native partitioning された 12 万行の時系列テーブルから、
  ある古い月を通常の `DELETE` で、別の古い月を `DETACH PARTITION` (+
  `DROP TABLE`) で消し、`\timing` で同じ規模の作業がどれだけ違う所要時間にな
  るかを計測する。

内蔵ターミナルがまだ無いビルドの Portal を使っている場合は、手元のターミナル
から同じデータベースへ入れる。

```bash
docker compose -f local/docker-compose.yml exec db-a12-partition \
  psql -U participant -d drill
```

## ストーリー

`metrics.events` は `partition by range (created_at)` で月別に partitioning さ
れている。2024-01〜06 の 6 partition、各 20,000 行、計 12 万行。うち 2 か月分
が「もう不要な古いデータ」だ ── 2024-01 は通常のやり方 (`DELETE ... WHERE`) で、
2024-02 は partition のやり方 (`ALTER TABLE ... DETACH PARTITION`、任意で続けて
`DROP TABLE`) で消す。どちらもほぼ同じ行数を対象にした作業だ。`DELETE` は
20,000 行それぞれについて 1 行ずつタプルを無効化する仕事を Postgres にさせる。
`DETACH PARTITION` は実データの行を 1 行も読まず、システムカタログのレコード
を 1 件書き換えるだけだ。この所要時間の違いこそがこのドリルの核心であり、先に
は教えない ── 自分の手で計測する。

## ドメイン

| テーブル | 行数 | 役割 |
| --- | --- | --- |
| `metrics.events_y2024m01` | 20,000 | 通常の `DELETE` で消す対象 |
| `metrics.events_y2024m02` | 20,000 | `DETACH PARTITION` (+ 任意で `DROP TABLE`) で消す対象 |
| `metrics.events_y2024m03` 〜 `m06` | 各 20,000 (計 80,000) | 無傷のまま残さなければならない bystander |

`metrics.events` (partition 化された親テーブル) 自体は行を持たない ── すべて
の行は 6 つの leaf partition のどれか 1 つに属する。すべての leaf は
`autovacuum_enabled = false`。

## DELETE する → DETACH する → 比較する

```sql
-- 0. 現在の partition 構成を見る。
select inhrelid::regclass as partition
from pg_inherits
where inhparent = 'metrics.events'::regclass
order by 1;                                                     -- 月別 6 partition

\timing on

-- 1. 方法 A: 2024-01 分 (約 2 万行) を通常の DELETE で消す。
delete from metrics.events where created_at >= '2024-01-01' and created_at < '2024-02-01';
-- DELETE 20000
-- Time: 約 19 ms

-- 2. 方法 B: 2024-02 分 (同じく約 2 万行) を DETACH PARTITION で消す。
alter table metrics.events detach partition metrics.events_y2024m02;
-- ALTER TABLE
-- Time: 約 1.3 ms  (桁が違うほど速い ── 詳細は下の「数値」参照)

-- 3. 切り離したテーブルはまだデータを持ったまま存在している。領域も返すには DROP する。
drop table metrics.events_y2024m02;
-- DROP TABLE
-- Time: 約 2.4 ms

-- 4. 触っていない月が無事かを確認する。
select count(*) from metrics.events;                             -- 80000
```

上記の数値は、このドリルを作成する過程で実際にローカルの Postgres で計測した
ものである (詳細は下の「閾値の根拠」を参照)。手元の環境では同じ桁数になるが、
必ずしも同じ数字にはならない。

## 採点の仕組み

プラットフォームは答えを持たず、提出テキストも読まない。「提出」のたびに
`{ checkpointId, submission }` がコンテナの loopback `/verify`
(`POST http://127.0.0.1:18471/verify`) へ委譲され、`pg_class.relispartition`・
`pg_inherits`・各 leaf partition の現在の行数を実際に問い合わせて
`{ checkpointId, correct, message }` を返す。

| checkpoint | 実際に何を確認しているか |
| --- | --- |
| `old-partition-detached-or-dropped` | `events_y2024m02` が `metrics.events` の partition では無くなっているか (DETACH のみ、または DETACH 後に DROP、どちらでもよい) |
| `old-month-deleted-via-delete` | `events_y2024m01` が attach されたままで、行数が 0 になっているか |
| `bystander-partitions-intact` | `events_y2024m03`〜`m06` がすべて attach されたまま、各 20,000 行で無傷か |

何度でも再スキャンしてよい。各 checkpoint は独立しており、満点 100 点のうち
35 / 35 / 30 点を占める。

### `old-month-deleted-via-delete` が「attach されたまま」を要求する理由

「`events_y2024m01` の行数が 0」というだけでは、本物の row-level `DELETE` を
実行したのか、参加者が (この対象には間違った手段である) DETACH を使ったのか
を区別できない ── どちらも `metrics.events` 経由では同じ「その月の行が見えな
い」という結果になる。`DETACH PARTITION` は完了した瞬間に必ず
`pg_class.relispartition` を `false` にする (実機の Postgres 16 で確認済み)
ので、「attach されたまま、かつ行数 0」を要求すればこの隙間を塞げる ── この
組み合わせは本物の `DELETE` でしか到達できない。`relispartition` は誰も書き
込めるテーブルではなく、Postgres 自身のカタログが管理する事実なので、どんな
DML 権限でも偽装できない。

### participant が metrics スキーマに USAGE は持つが CREATE は持たない理由、INSERT/UPDATE/TRUNCATE も無い理由

`participant` は partition 化された親テーブルと、すべての leaf partition を
所有する (`DETACH PARTITION` には親への `ALTER` 権限、`DROP TABLE` には対象
leaf の所有権、`DELETE` には対象 leaf への DML 権限が要る)。意図的に与えなか
った権限が 2 つある:

- **`metrics` スキーマへの `CREATE` を与えない** ── 同じ名前で空のテーブルを
  作り直し、partition として再 `ATTACH` することで、本物の `DELETE` を実行せ
  ずにその最終状態だけを偽装する近道を塞ぐため。実機の Postgres 16 で確認済
  み: このスキーマ配下での `CREATE TABLE` は `participant` に対して権限エラー
  になる。
- **`INSERT`/`UPDATE`/`TRUNCATE` を与えない** ── `INSERT` があると、誤って変
  えてしまった bystander 月の行数を後から水増しして元に戻せてしまう。
  `TRUNCATE` があると、`events_y2024m01` をカタログ操作 1 回で空にでき、「本
  物の行単位 DELETE のコストを払った」ふりができてしまう。実機の Postgres 16
  で確認済み: table owner 自身に対する `REVOKE` はちゃんと効き (以降
  `TRUNCATE` を試みると権限エラーになる)、それでも `DELETE` /
  `DETACH PARTITION` / `DROP TABLE` は問題なく動く。

### 閾値の根拠

このドリルを作成する過程で、実際の Postgres 16 に対して計測した数値 (配布す
る Docker image そのものに対してではない ── 理由はこの問題が乗った PR の
「検証」節を参照)。クライアント接続のオーバーヘッドが比較を歪めないよう、す
べて同一の `psql` セッション内で計測した:

| 操作 | 対象行数 | 所要時間 |
| --- | --- | --- |
| `DELETE` (2024-01) | 20,000 | 約 19.0 ms |
| `DETACH PARTITION` (2024-02) | 20,000 (実際には 1 行も読まない) | 約 1.3 ms |
| `DROP TABLE` (切り離し済みの 2024-02) | 20,000 (行単位ではなくファイルごと削除) | 約 2.4 ms |

`DETACH` + `DROP` を合わせても (約 3.7 ms)、同じ行数の単純な行 `DELETE`
(約 19.0 ms) の 5 分の 1 以下で終わった。この差は行数が増えるほど広がる ──
`DELETE` のコストは削除行数に比例するが、`DETACH PARTITION` のコストはそう
ではないからだ。

## 配信モデル

`metadata.json` は CloudFormation テンプレートの代わりにコンテナ runtime を宣言
し、ホスト側に何もインストールしなくて済むよう Portal 内蔵ターミナル
(`runtime.terminal`) も宣言する。

```jsonc
"runtime": {
  "provider": "docker",
  "engine": "compose",
  "entry": "local/docker-compose.yml",
  "challengeEndpoints": { "Info": "http://127.0.0.1:18470" },
  "verifyUrl": "http://127.0.0.1:18471/verify",
  "secretEnv": ["FLAG_SEED"],
  "terminal": { "service": "db-a12-partition" }
},
"scoring": { "kind": "multi-verify", "checks": [ … 3 checkpoints, 満点 100 pts … ] }
```

```
db-a12-partition/
├── metadata.json                # runtime (docker/compose) + scoring (multi-verify) + hints
└── local/
    ├── docker-compose.yml       # サービス 1 つ、loopback のみに port 公開 + healthcheck
    ├── Dockerfile                # postgres:16-alpine ("participant" stage) + node
    ├── entrypoint.sh             # pg 起動 → schema 適用 → 1 回だけ seed → app 起動
    ├── app/
    │   ├── server.mjs           # 情報/状態ページ (:8080) + /verify (:8081)
    │   ├── pg-client.mjs        # 実 Postgres アダプタ (partition カタログ、行数)
    │   └── package.json         # `postgres` JS driver
    ├── grader/
    │   ├── grade.mjs            # 3 つの checkpoint (pure, dependency-injected)
    │   └── grade.test.mjs       # fake client を使う unit test (bun test、実 DB 不要)
    └── db/
        ├── schema.sql           # metrics.events (partition 化、participant 所有、DELETE のみ) + 月別 6 leaf
        └── seed.sql             # 6 × 20,000 行
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
