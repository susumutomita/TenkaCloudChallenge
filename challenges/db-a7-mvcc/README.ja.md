# db-a7-mvcc — 行バージョンと、読み取りが待たされない理由

TenkaCloud Database Track (Phase 1, 2 章, Drill A7) の local-play Drill。Docker だ
けで動作し、AWS アカウントやクラウドリソースは不要。コンテナ `/verify` 採点契
約を checkpoint 単位で使う (`scoring.kind: "multi-verify"`, TenkaCloud#2252)。

> 訓練用ターゲット。compose は `127.0.0.1` のみに bind する。外部公開しないこと。

## 遊び方

```bash
make local PROBLEM=db-a7-mvcc   # TenkaCloud リポジトリのルートから
# Participant Portal が開く。任意の非空キーでログインする
```

- **挑戦する場所:** 実際の作業は Portal 内蔵ターミナルの `psql` で行う。ブラウ
  ザ完結ではない。<http://127.0.0.1:18450> は読み取り専用の情報/状態ページ。
- **ゴール:** 読み取りが書き込み中の行にブロックされないことを確認し、
  `xmin`/`xmax` を直接読む。その後 `repeatable read` の長時間 transaction を開
  き、別セッションから `mvcc.tickets` を churn し、`VACUUM` が dead tuple を回
  収できないことを見てから、transaction を閉じて 2 回目の `VACUUM` が成功する
  ことを確認する。

内蔵ターミナルがまだ無いビルドの Portal を使っている場合は、手元のターミナル
から同じデータベースへ入れる。

```bash
docker compose -f local/docker-compose.yml exec db-a7-mvcc \
  psql -U participant -d drill
```

## ストーリー

`mvcc.tickets` には 5 行、`mvcc.reference` には一切関わらない 1 行がある。A6
は同じ行への 2 つの `UPDATE` が互いの行ロックを待つ様子を見せた。このドリルは
その対比だ ── 書き込み中 (未 commit) の行への `SELECT` は一切ブロックされない
── 見えるのは直前の commit 済みの版だけだ。これが MVCC (Multi-Version
Concurrency Control) だ。Postgres は行を上書きせず新しい版を追加し、読み取りは
自分の snapshot が取られた時点で確定していた版だけを見る。ただし複数の版を保
持するにはコストがあり ── dead tuple ── それを回収する `VACUUM` は、長時間開
いたままの transaction によって妨げられうる。

## ドメイン

| テーブル | 列 |
| --- | --- |
| `mvcc.tickets` | `id` (PK)、`status`、`version` ── 5 行、すべて `status='open'`、`version=1` |
| `mvcc.reference` | `id` (PK)、`note` ── 1 行、`note='do-not-touch'` |
| `audit.churn_log` | `log_id`、`ticket_id`、`op`、`backend_pid`、`logged_at`、`concurrent_long_tx_started_at` ── 追記専用、`mvcc.tickets` への trigger だけが書き込む |

`mvcc.tickets` は `autovacuum_enabled=false` ── dead tuple は自分で `VACUUM`
を実行したときだけ減る。autovacuum が気まぐれなタイミングで先に片付けてしまう
ことはない。

## 見る → 塞ぐ → 解放する

```sql
-- 1. 1 行更新し、commit しない。
begin;
update mvcc.tickets set status = 'closed' where id = 1;
select xmin, xmax, status from mvcc.tickets where id = 1; -- 自分のセッションからは新しい値が見える

-- 2. 同じターミナルから、バックグラウンド化しない 2 本目の psql の SELECT
--    ── A6 の書き込み同士のケースと違い、決してブロックされない:
\! psql -U participant -d drill -c "select id, status from mvcc.tickets where id = 1;"
-- 古い値が見える: 読み取りは未 commit の書き込みを一切待たない。
commit;

-- 3. 実際に snapshot を確定させる長時間 transaction を開く:
begin transaction isolation level repeatable read;
select count(*) from mvcc.tickets; -- このクエリが snapshot を確定させる

-- 4. 別セッションから churn する (どの行もロックされていないのでブロックされない):
\! psql -U participant -d drill -c "do \$\$ begin for i in 1..30 loop update mvcc.tickets set status = 'churn-' || i, version = version + 1 where id = ((i % 5) + 1); end loop; end \$\$;"
select n_live_tup, n_dead_tup from pg_stat_user_tables where schemaname='mvcc' and relname='tickets';
-- n_dead_tup が増えている

-- 5. 長時間 transaction がまだ開いている状態で VACUUM ── 回収できない:
\! psql -U participant -d drill -c "vacuum (verbose) mvcc.tickets;"
-- "... are dead but not yet removable"
select n_dead_tup from pg_stat_user_tables where relname='tickets'; -- 変わらない

-- 6. 長時間 transaction を閉じてから、もう一度 VACUUM:
rollback;
\! psql -U participant -d drill -c "vacuum (verbose) mvcc.tickets;"
-- "... removed"
select n_dead_tup from pg_stat_user_tables where relname='tickets'; -- ほぼ 0
```

上記の数値は、このドリルを作成する過程で実際にローカルの Postgres で計測した
ものである (詳細は下の「閾値の根拠」を参照)。手元の環境では同じ桁数になるが、
必ずしも同じ数字にはならない。

## 採点の仕組み

プラットフォームは答えを持たず、提出テキストも読まない。「提出」のたびに
`{ checkpointId, submission }` がコンテナの loopback `/verify`
(`POST http://127.0.0.1:18451/verify`) へ委譲され、`mvcc.reference`・
`pg_stat_user_tables`・`audit.churn_log` の現在の状態を実際に問い合わせて
`{ checkpointId, correct, message }` を返す。

| checkpoint | 実際に何を確認しているか |
| --- | --- |
| `reference-untouched` | このドリルに一切関わらない `mvcc.reference` の内容が変わっていないか |
| `long-transaction-blocked-cleanup-observed` | `audit.churn_log` から、別セッションが実際に snapshot を保持する長時間 transaction (`pg_stat_activity.backend_xmin` が非 null ── 単に `begin;` しただけではない) を開いている間に、十分な数の書き込みが行われたか |
| `dead-tuples-reclaimed` | 十分な churn (累積 `n_tup_upd`/`n_tup_del`) が行われた上で、現在の `n_dead_tup` が十分小さいか |

何度でも再スキャンしてよい。各 checkpoint は独立しており、満点 100 点のうち
30 / 40 / 30 点を占める。

### participant が mvcc.tickets を所有する理由 (A6 の inventory.stock との違い)

PostgreSQL 16 では `VACUUM` の実行に所有権 (またはsuperuser) が要る ── 所有権
無しで実行できる `MAINTAIN` 権限は PostgreSQL 17 で初めて入った機能で、この
ドリル (A1〜A6 と同じ) が使う `postgres:16-alpine` より 1 メジャーバージョン
後だ。所有権が無いと `participant` はこのドリルの核心である `VACUUM` を一度
も実行できない。これは A6 の `inventory.stock` が閉じた tradeoff を再び開く
ことになる ── 所有者は自分のテーブルに対して `ALTER TABLE ... DISABLE TRIGGER`
でき、`audit.churn_log` への記録を止められる ── が、A6 が受け入れたのと同じ
理由でこれも許容できる: 監査記録を失うことは、それに依存する checkpoint を
「通りにくく」するだけで「通りやすく」はしない (実際に確認済み: trigger を無
効化した状態で `audit.churn_log` へ偽の行を INSERT しようとしても権限エラー
になる ── このテーブルは `mvcc.tickets` の所有者が誰であっても superuser 所
有のままだ)。

### 「別セッションが開いている」だけではなく backend_xmin を見る理由

「別セッションが idle in transaction だった」というだけの checkpoint は弱す
ぎる ── クエリを 1 つも実行していない単なる `begin;` は snapshot を一切保持
せず、既定の READ COMMITTED transaction も各文が終わるたびに snapshot を手放
す ── どちらも VACUUM を少しも妨げない (このドリルの作成中に実際に確認した:
何もクエリを実行しない `begin;` を 30 回の churn の間開いたままにしても、直後
の VACUUM は 30 件すべてを問題なく回収した)。実際に snapshot を確定させ、開い
たまま保持している transaction (例: クエリを 1 つ実行した後の `repeatable read`)
だけが、開いている間ずっと `pg_stat_activity.backend_xmin` を保持し続ける ──
これこそが VACUUM がその transaction がまだ必要とするかもしれない行を回収で
きなくなる条件そのものだ。`local/db/schema.sql` の trigger は (security-definer
の所有者として、誰が書き込んだかに関わらずマスクされない値が見える)
`backend_xmin` を読むことで、`long-transaction-blocked-cleanup-observed` が
「単に開いていただけ」ではなく「本当に cleanup を妨げ得た transaction」を判
定するようにしている。

### 閾値の根拠

このドリルを作成する過程で、実際の Postgres 16 に対して計測した数値 (配布す
る Docker image そのものに対してではない ── 理由はこの問題が乗った PR の
「検証」節を参照):

| 状態 | churn 後の n_dead_tup | 長時間 tx が開いている間の VACUUM | 閉じた後の VACUUM |
| --- | --- | --- | --- |
| 30 行 churn、長時間 tx = 単なる begin; (クエリ無し) | 30 | 30 件とも回収されてしまう | n/a |
| 30 行 churn、長時間 tx = repeatable read + クエリ 1 つ | 30 | 0 件回収、30 件が "not yet removable" | 30 件回収、残り 0 |
| 30 行 churn、長時間 tx が一切無い | 30 | (即座に VACUUM) 30 件回収 | n/a |

1 行目が「単に開いているだけ」ではなく `backend_xmin` を見る理由そのものであ
る ── snapshot を一度も確定させていない transaction は、どれだけ長く開いてい
ても VACUUM を妨げない。

## 配信モデル

`metadata.json` は CloudFormation テンプレートの代わりにコンテナ runtime を宣言
し、ホスト側に何もインストールしなくて済むよう Portal 内蔵ターミナル
(`runtime.terminal`) も宣言する。

```jsonc
"runtime": {
  "provider": "docker",
  "engine": "compose",
  "entry": "local/docker-compose.yml",
  "challengeEndpoints": { "Info": "http://127.0.0.1:18450" },
  "verifyUrl": "http://127.0.0.1:18451/verify",
  "secretEnv": ["FLAG_SEED"],
  "terminal": { "service": "db-a7-mvcc" }
},
"scoring": { "kind": "multi-verify", "checks": [ … 3 checkpoints, 満点 100 pts … ] }
```

```
db-a7-mvcc/
├── metadata.json                # runtime (docker/compose) + scoring (multi-verify) + hints
└── local/
    ├── docker-compose.yml       # サービス 1 つ、loopback のみに port 公開 + healthcheck
    ├── Dockerfile                # postgres:16-alpine ("participant" stage) + node
    ├── entrypoint.sh             # pg 起動 → schema 適用 → 1 回だけ seed → app 起動
    ├── app/
    │   ├── server.mjs           # 情報/状態ページ (:8080) + /verify (:8081)
    │   ├── pg-client.mjs        # 実 Postgres アダプタ (reference、ticket stats、churn_log)
    │   └── package.json         # `postgres` JS driver
    ├── grader/
    │   ├── grade.mjs            # 3 つの checkpoint (pure, dependency-injected)
    │   └── grade.test.mjs       # fake client を使う unit test (bun test、実 DB 不要)
    └── db/
        ├── schema.sql           # mvcc.tickets (participant 所有)、mvcc.reference、audit.churn_log + trigger
        └── seed.sql             # 5 + 1 行
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
