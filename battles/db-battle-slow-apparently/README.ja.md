# DBが遅いらしい (`db-battle-slow-apparently`)

**Battle · difficulty 4 · 45〜75 分 · Docker のみで完結 · USD 0**

03:00 頃から注文 API の p99 latency が SLO を超えている。一部ユーザーからは「更新した内容が
すぐ表示されない」という報告も来ている。production traffic は止められない。画面には「DB CPU
が高いので scale-up を検討してください」という運用メモが出ているが、これは正解ではなく、
現場でありがちな早すぎる診断そのもの。

参加者向けの文面には、何が本当の原因かは一切書かれていない。**それを見つけること自体が課題**。

## 裏側の設計 (プレイ前に読まないこと — これは内部向けの設計メモ)

retention worker が毎日決まった時刻に古い注文を削除している。`commerce.orders` は既に月次
RANGE partition 済みだが、retention worker はその migration より前から存在しており、
partition の存在を無視して `DELETE FROM commerce.orders WHERE created_at < cutoff` を
1 本の巨大な未コミット transaction として実行し続けている。削除される各行は、行ごとに
ログを書く BEFORE DELETE trigger を経由する (現実の監査トリガを模したもので、フェイクの
遅延ではなく本物の CPU コスト) — このため primary の cpu limit を注文 API と奪い合い、
実際に p99 を悪化させる。この長い transaction が動いている間、primary 側の sampler が
transaction の実測継続時間に応じて replica の `recovery_min_apply_delay` (本物の Postgres
機能) を動的に有効化し、完全に本物の replication lag を発生させる。

正しい対応は、証拠から真因を診断し、本番の書き込みを止めずに該当 transaction を安全に
cancel し、安い方法 (`DETACH PARTITION` + `DROP TABLE`、row 単位の `DELETE` ではない) で
後片付けを完了させ、retention worker 自体の戦略を直して翌日また同じことが起きないようにする
こと。

## 4 つの phase

1. **診断** — `bin/diagnose.mjs` で構造化した診断を提出する: 実際の backend pid・実際の
   mechanism・実際の trigger・安全な最初の一手。自由記述は採点しない。
2. **containment** — 書き込みを止めず、何も再起動せず、replica も無効化せずに、該当セッション
   を `pg_cancel_backend()` する。
3. **正しい後片付け** — 対象テーブルが本当に partition されているかを確認してから片付け方法を
   選ぶ。誤った方法 (row 単位の `DELETE`) でも最終的には完了するが、満点にはならない。
4. **再発防止** — `ops.retention_config` を安全な戦略に切り替え、job 自身の周期的な再チェック
   が held-back partition を SLO を壊さずに片付けるのを確認する。

## 採点 (multi-verify, 7 checkpoint, 計 1000 点)

すべての checkpoint は、Postgres 自身の catalog と、参加者が書き込めない `audit.*` テーブル
(`incident_log` / `metrics_samples` / `diagnosis_log` / `deleted_orders_log`) だけを見る。
自己申告や固定文字列一致では一切通らない。詳細は `metadata.json` の `description` を参照。

1 点だけ明示しておく。held-back partition (2024-07) の「無傷であること」という条件は、
`ops.retention_config.cutoff_date` ではなく `audit.incident_log` に記録された episode
(実際に commit した `partition_aware` の実行) によって解除される。cutoff は参加者に
`UPDATE` を渡している唯一の行なので、そこを条件にすると「先に held-back のデータを壊してから、
自分で cutoff を広げる」が無罰で通ってしまう。

## 実行時の境界 (参加者のコンテナに入るもの)

Portal のターミナルが繋がるのは `workstation` service (Dockerfile の `participant` stage)
だけ。この image が持つのは `psql` と `node` と `bin/diagnose.mjs` のみで、`grader/`
(Phase 1 の正解キー・purge 対象 partition 一覧・widened cutoff) と `db/schema.sql`
(banner がシナリオ全体を解説している) は意図的に入れない。これらは Postgres と grader を
動かす `primary` image にだけ入り、そちらには誰も shell を持たない。

DB 側も同じ境界を張る。`local/entrypoint-primary.sh` が `pg_hba.conf` を全面的に書き、
compose network から SQL を実行できるのは `participant` / `app_service` /
`retention_service` の 3 role だけ、superuser (`postgres`) は primary コンテナ内の local
socket か per-run の `FLAG_SEED` から導出したパスワードでしか到達できない (`FLAG_SEED` は
workstation には渡さない)。ラボとしては従来どおり遊べる: `participant` は
`pg_read_all_stats`・`pg_signal_backend`・`ops.retention_config` の `SELECT`/`UPDATE`・
`orders_owner` 経由の leaf partition への `DETACH`/`DROP`/`DELETE` を保持し、`audit.*` は
`SELECT` のみ。

## ローカルプレイ

```bash
cd local
docker compose -p db-battle-slow-apparently up -d
# Info:   http://127.0.0.1:18580
# Verify: POST http://127.0.0.1:18581/verify {"checkpointId": "..."}
# 参加者の端末: docker compose -p db-battle-slow-apparently exec workstation sh
docker compose -p db-battle-slow-apparently down --volumes --remove-orphans
```

grader の unit test は Docker も Postgres も要らない。

```bash
bun test battles/db-battle-slow-apparently/local/grader/grade.test.mjs
```

必ず `-p db-battle-slow-apparently` を明示すること (TenkaCloudChallenge#521)。全ての
local-play 問題の compose file は `.../local/` というディレクトリ名で終わるため、既定の
project 名 (ディレクトリ名由来) は全問題で "local" になってしまい、素の `docker compose down`
が共有ホスト上の無関係な問題のコンテナを巻き込む。この問題自身の `local/docker-compose.yml`
も同じ理由で `name:` を明示している。

## スコープに関する注記

Issue #430 は 2 つの seed variant (Variant A: partitioned、Variant B: non-partitioned +
keyset + adaptive throttle) と、ハードコード対策としての境界/pid の seed variance を求めて
いる。この PR は **Variant A のみ**を完全な working increment として出荷する。Variant B と
seed variance は follow-up として追跡する — PR 本文の「Known incomplete work」を参照。
