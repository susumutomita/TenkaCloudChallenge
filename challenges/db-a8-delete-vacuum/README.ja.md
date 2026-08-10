# db-a8-delete-vacuum — DELETE したのに disk が減らない

TenkaCloud Database Track (Phase 1, 2 章, Drill A8) の local-play Drill。Docker だ
けで動作し、AWS アカウントやクラウドリソースは不要。コンテナ `/verify` 採点契
約を checkpoint 単位で使う (`scoring.kind: "multi-verify"`, TenkaCloud#2252)。

> 訓練用ターゲット。compose は `127.0.0.1` のみに bind する。外部公開しないこと。

## 遊び方

```bash
make local PROBLEM=db-a8-delete-vacuum   # TenkaCloud リポジトリのルートから
# Participant Portal が開く。任意の非空キーでログインする
```

- **挑戦する場所:** 実際の作業は Portal 内蔵ターミナルの `psql` で行う。ブラウ
  ザ完結ではない。<http://127.0.0.1:18460> は読み取り専用の情報/状態ページ。
- **ゴール:** 40 万行のテーブルから、retention cutoff より古い 30 万行を一括
  `DELETE` する。disk 使用量がすぐには縮まないこと・`n_dead_tup` が急増する
  ことを確認してから、自分で `VACUUM` を実行 (autovacuum は無効) して dead
  tuple が回収される ── がファイルサイズ自体は依然として変わらない ── ことま
  で確認する。

内蔵ターミナルがまだ無いビルドの Portal を使っている場合は、手元のターミナル
から同じデータベースへ入れる。

```bash
docker compose -f local/docker-compose.yml exec db-a8-delete-vacuum \
  psql -U participant -d drill
```

## ストーリー

`telemetry.events` には 40 万行 ── retention cutoff (`2023-01-01`) より古い
"old" イベントが 30 万行、cutoff 以降の "recent" イベントが 10 万行 (一切触っ
てはいけない) ある。まず素直に古い 30 万行を消す ── そして驚くのは、その直後
に `pg_total_relation_size` がほとんど変わらないことだ。`DELETE` された行は
ファイルに穴が空くのではなく *dead tuple* になるだけで、代わりに
`n_dead_tup` が跳ね上がる。`VACUUM` (このドリルでは autovacuum が無効なので
自動では一切走らない) を実行すると dead tuple は再利用可能になる ── が、ファ
イルサイズ自体は依然として縮まない。実際にファイルを OS へ返却するのは
`VACUUM FULL` (テーブル全体を書き直す) だけで、代わりに `ACCESS EXCLUSIVE`
ロックというコストを払う。

## ドメイン

| テーブル | 列 |
| --- | --- |
| `telemetry.events` | `id` (PK)、`created_at`、`kind` ── 40 万行: `created_at` が 2022 年の行 30 万、2024 年の行 10 万 |
| `audit.delete_log` | `log_id`、`rows_deleted`、`min_created_at`、`max_created_at`、`backend_pid`、`executed_at` ── 追記専用、`telemetry.events` への statement-level trigger だけが書き込む |

`telemetry.events` は `autovacuum_enabled=false` ── dead tuple は自分で
`VACUUM` を実行したときだけ減る。autovacuum が気まぐれなタイミングで先に片付
けてしまうことはない。

## DELETE する → 縮まないのを見る → VACUUM する → それでも縮まないのを見る

```sql
-- 0. まず現状を確認する。
select count(*) from telemetry.events;                                  -- 400000
select pg_size_pretty(pg_total_relation_size('telemetry.events'));      -- 約 30 MB

-- 1. retention cutoff より古い行をまとめて消す。
delete from telemetry.events where created_at < '2023-01-01';           -- DELETE 300000

-- 2. DELETE 直後 ── サイズは変わらず、dead tuple が急増している:
select pg_size_pretty(pg_total_relation_size('telemetry.events'));      -- まだ約 30 MB
select n_live_tup, n_dead_tup from pg_stat_user_tables
  where schemaname='telemetry' and relname='events';                   -- n_dead_tup ≈ 300000

-- 3. VACUUM する (autovacuum は無効 ── 誰も自動では片付けない):
vacuum (verbose) telemetry.events;
select n_dead_tup from pg_stat_user_tables where relname='events';      -- ほぼ 0、回収された
select pg_size_pretty(pg_total_relation_size('telemetry.events'));      -- それでも約 30 MB

-- 4. 任意・採点対象外: VACUUM FULL なら実際に縮む。
vacuum full telemetry.events;
select pg_size_pretty(pg_total_relation_size('telemetry.events'));      -- 約 8 MB まで縮む
```

上記の数値は、このドリルを作成する過程で実際にローカルの Postgres で計測した
ものである (詳細は下の「閾値の根拠」を参照)。手元の環境では同じ桁数になるが、
必ずしも同じ数字にはならない。

## 採点の仕組み

プラットフォームは答えを持たず、提出テキストも読まない。「提出」のたびに
`{ checkpointId, submission }` がコンテナの loopback `/verify`
(`POST http://127.0.0.1:18461/verify`) へ委譲され、`telemetry.events`・
`pg_stat_user_tables`・`audit.delete_log` の現在の状態を実際に問い合わせて
`{ checkpointId, correct, message }` を返す。

| checkpoint | 実際に何を確認しているか |
| --- | --- |
| `old-rows-deleted-recent-intact` | cutoff より古い行が 0 件になっており、かつ cutoff 以降の行がちょうど 10 万件残っているか |
| `bulk-delete-observed` | `audit.delete_log` の累積 `rows_deleted` が、本当に大量 (25 万件以上) の DELETE を示しているか |
| `dead-tuples-reclaimed` | `pg_stat_user_tables.n_tup_del` も同様に十分大きく、かつ現在の `n_dead_tup` が十分小さいか |

何度でも再スキャンしてよい。各 checkpoint は独立しており、満点 100 点のうち
30 / 30 / 40 点を占める。

### `bulk-delete-observed` がなぜ要るのか

何も触られていない seed 直後の `telemetry.events` は、そもそも `n_dead_tup`
が 0 だ ── dead tuple は実際に何かが削除されて初めて生まれる。つまり「今
`n_dead_tup` が小さいか」だけでは、「本当に 30 万行削除して VACUUM で回収し
た」のか「何もせず、参加者が未使用のテーブルに `VACUUM;` を叩いただけ」なの
かを区別できない ── これはこのドリルの設計方針が名指しで警戒しているまさに
その近道だ。`audit.delete_log` (Postgres 自身の `referencing old table` DELETE
transition table を読む statement-level trigger ── 実測: 30 万行の DELETE で
も 1 秒未満で十分軽い) は、この隙間を塞ぐ、改ざん不能な記録だ。この table に
は `INSERT` 権限が一切無いので、参加者が偽の記録を作ることはできず、実際の
`DELETE` だけがここへ書き込む。

`dead-tuples-reclaimed` は同じ事実を、もう 1 つの独立した経路 ──
`pg_stat_user_tables.n_tup_del` (Postgres 自身が管理し、`VACUUM` でもリセッ
トされない累積カウンタ) ── でも二重にチェックする。実機の Postgres 16 で直
接確認済み: superuser でない table owner が `pg_stat_reset()` と
`pg_stat_reset_single_table_counters()` のどちらを呼んでも `permission
denied` になる ── つまり `participant` はこのカウンタを偽装もリセットもでき
ない。anti-cheat を突破するには、trigger が書く監査テーブルと engine が管理
する統計値の両方を同時に欺く必要がある。

### participant が telemetry.events を所有しつつ INSERT/UPDATE を持たない理由

PostgreSQL 16 では `VACUUM` の実行に所有権 (または superuser) が要る ── 所有
権無しで実行できる `MAINTAIN` 権限は PostgreSQL 17 で初めて入った機能で、こ
のドリル (A1〜A7 と同じ) が使う `postgres:16-alpine` より 1 メジャーバージョ
ン後だ。所有権が無いと `participant` はこのドリルの核心である `VACUUM` を一
度も実行できない。db-a7-mvcc は (`UPDATE` が必要なため) 所有権に伴う暗黙の
DML 権限をそのまま残したが、このドリルの checkpoint は固定の seed 値との行
「数」の比較なので (古い行が 0 件、cutoff 以降の行がちょうど 10 万件)、所有
権付与の直後に `INSERT`/`UPDATE` を明示的に `REVOKE` した ── 本当の大量
`DELETE` をやらずに、行数を水増し/埋め合わせできる抜け道を閉じるためだ。実機
の Postgres 16 で直接確認済み: table owner 自身に対する `REVOKE` はちゃんと
効く (以降 `INSERT` を試みると権限エラーになる) し、それでも `VACUUM`/
`DELETE` は問題なく動く。

### 閾値の根拠

このドリルを作成する過程で、実際の Postgres 16 に対して計測した数値 (配布す
る Docker image そのものに対してではない ── 理由はこの問題が乗った PR の
「検証」節を参照):

| 段階 | `pg_total_relation_size` | `n_dead_tup` |
| --- | --- | --- |
| DELETE 前 (40 万行) | 30 MB | 0 |
| 30 万行 `DELETE` 直後 | 30 MB (変化なし) | 300,000 |
| 通常の `VACUUM` 後 | 30 MB (**それでも**変化なし) | 0 (回収済み) |
| `VACUUM FULL` 後 (任意) | 約 7.6 MB | 0 |

真ん中の 2 行がこのドリルの核心そのものだ ── `DELETE` だけではファイルは絶
対に縮まないし、*通常の* `VACUUM` でも縮まない (同じテーブル内で再利用可能
な領域として印を付けるだけ)。実際に OS へ領域を返却するのは、テーブルを新し
いファイルへ書き直す `VACUUM FULL` だけだ。

## 配信モデル

`metadata.json` は CloudFormation テンプレートの代わりにコンテナ runtime を宣言
し、ホスト側に何もインストールしなくて済むよう Portal 内蔵ターミナル
(`runtime.terminal`) も宣言する。

```jsonc
"runtime": {
  "provider": "docker",
  "engine": "compose",
  "entry": "local/docker-compose.yml",
  "challengeEndpoints": { "Info": "http://127.0.0.1:18460" },
  "verifyUrl": "http://127.0.0.1:18461/verify",
  "secretEnv": ["FLAG_SEED"],
  "terminal": { "service": "db-a8-delete-vacuum" }
},
"scoring": { "kind": "multi-verify", "checks": [ … 3 checkpoints, 満点 100 pts … ] }
```

```
db-a8-delete-vacuum/
├── metadata.json                # runtime (docker/compose) + scoring (multi-verify) + hints
└── local/
    ├── docker-compose.yml       # サービス 1 つ、loopback のみに port 公開 + healthcheck
    ├── Dockerfile                # postgres:16-alpine ("participant" stage) + node
    ├── entrypoint.sh             # pg 起動 → schema 適用 → 1 回だけ seed → app 起動
    ├── app/
    │   ├── server.mjs           # 情報/状態ページ (:8080) + /verify (:8081)
    │   ├── pg-client.mjs        # 実 Postgres アダプタ (行数、統計、delete_log)
    │   └── package.json         # `postgres` JS driver
    ├── grader/
    │   ├── grade.mjs            # 3 つの checkpoint (pure, dependency-injected)
    │   └── grade.test.mjs       # fake client を使う unit test (bun test、実 DB 不要)
    └── db/
        ├── schema.sql           # telemetry.events (participant 所有、DELETE のみ)、audit.delete_log + trigger
        └── seed.sql             # 30 万 + 10 万行
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
