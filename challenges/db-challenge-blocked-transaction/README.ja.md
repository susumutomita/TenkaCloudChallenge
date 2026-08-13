# db-challenge-blocked-transaction — 支払いの書き込みが止まったまま返ってこない

TenkaCloud Database Track (Phase 1, Chapter 4, Challenge 2) の local-play
Challenge。Docker だけで動作し、AWS アカウントやクラウドリソースは不要。コン
テナ `/verify` 採点契約を checkpoint 単位で使う (`scoring.kind:
"multi-verify"`, TenkaCloud#2252)。

> 訓練用ターゲット。compose は `127.0.0.1` のみに bind する。外部公開しないこと。

このトラックのここまでの Drill (A6、A7、...) と違い、これは **Challenge** で
ある ── `instructions`/`description` のどこにも原因は書かれていない。参加者
に渡されるのは「アプリの書き込みが止まっている」という情報と、A6 (行ロック、
`pg_stat_activity`、`pg_blocking_pids()`) で既に習得した診断の道具だけ。実際
の blocker を見つけて解消すること自体が課題である。

## 遊び方

```bash
make local PROBLEM=db-challenge-blocked-transaction   # TenkaCloud リポジトリのルートから
# Participant Portal が開く。任意の非空キーでログインする
```

- **挑戦する場所:** 実際の作業は Portal 内蔵ターミナルの `psql` で行う。ブラ
  ウザ完結ではない。<http://127.0.0.1:18510> は読み取り専用の情報/状態ページ。
- **ゴール:** account 1 への保留中の書き込みを実際に完了させる。

内蔵ターミナルがまだ無いビルドの Portal を使っている場合は、手元のターミナル
から同じデータベースへ入れる。

```bash
docker compose -f local/docker-compose.yml exec db-challenge-blocked-transaction \
  psql -U participant -d drill
```

## 症状 (参加者に渡される情報)

> 運用チームから報告: account 1 (griffin holdings) への出金処理が、ずっと保
> 留のまま終わらない。アプリ側は裏で再試行し続けているが、何も返ってこない。

これ以外は何も渡さない。ロックの話も、blocker の話も、何が悪いかも書かれて
いない。

## ドメイン

| テーブル                | 列                                                                      |
| -------------------------- | ---------------------------------------------------------------------- |
| `app.accounts`          | `id` (PK)、`owner_name`、`balance_cents` ── 2 行: account 1 = $1,000.00、account 2 (無関係な bystander) = $500.00 |
| `audit.incident_log`    | `log_id`、`event`、`backend_pid`、`logged_at` ── append-only、アプリ自身だけが書く |

`participant` は `app.accounts` への書き込み権限を一切持たない (A6 の
`inventory.stock` とは違い、参加者自身が書き込む側ではない) ── このチャレン
ジで実際に書き込む主体はアプリ自身の `app_service` 接続だけ。`participant` が
持つ唯一の手段は `pg_terminate_backend()` (`pg_signal_backend` メンバーシッ
プ経由) である。

**実際に Postgres 16 で動かして見つけた権限の穴 (仮定ではない):**
`pg_stat_activity` の `state` / `wait_event_type` / `wait_event` 列は、
superuser または `pg_read_all_stats` のメンバーでない限り、**他の role** の
backend については NULL を返す ── この grant が無いと、この Challenge の
instructions が説明している診断クエリ (A6 の技法そのもの) は `participant`
から見て 0 行を返してしまう。`app_service` は別 role だからだ。
`local/db/schema.sql` はこの理由で `participant` に `pg_read_all_stats` を
grant している (読み取り専用 ── それ自体には書き込みや signal の権限は無い)。

## 症状の裏で実際に動いているもの

Node アプリがコンテナ起動時にインシデント全体を自分で仕込んでいる。

1. **リークした blocker** ── transaction を開いて account 1 を更新し、その
   まま commit も rollback もせずに放置される (「前回のデプロイが transaction
   を開いたまま接続を切り忘れた」という設定)。行ロックを握ったまま `idle in
   transaction` で居座り続ける。
2. **無害なデコイ** ── 同じ `app_service` role だが、1 回クエリを実行しただ
   けで idle になっている。transaction もロックも無い。終了させても何も変わ
   らない ── 赤いニシン。`app_service` の接続を見て当てずっぽうに選ぶと、こ
   ちらを選んでしまう可能性がある。
3. **再試行し続ける waiter** ── アプリが実際に発行している account 1 への書
   き込みで、blocker の行ロックに実際にブロックされている。自分自身の
   backend が誤って終了させられても自動的に再試行するので、間違った選択を
   しても詰みにはならない。

## 採点の仕組み

プラットフォームは答えを持たず、提出テキストも読まない。「提出」のたびに
`{ checkpointId, submission }` がコンテナの loopback `/verify`
(`POST http://127.0.0.1:18511/verify`) へ委譲され、`app.accounts` と
`audit.incident_log` の現在の状態を実際に問い合わせ、
`{ checkpointId, correct, message }` を返す。

| checkpoint                       | 実際に何を確認しているか                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `blocking-session-cleared`       | インシデント開始時に一度だけ記録された、本物の blocker の backend pid が、今の pg_stat_activity にもう存在しないか |
| `genuine-wait-then-resolution`   | 保留中の書き込みが、意味のある (ミリ秒単位のノイズではない) 時間だけ、アプリ自身が記録した形でロック待ちしてから完了したか |
| `stuck-write-completed`          | account 1 の残高が、waiter の分だけ正しく反映された値 (100000 → 95000 cents) になっているか                  |

何度でも再スキャンしてよい。各 checkpoint は独立しており、満点 100 点のうち
30 / 30 / 40 点を占める。

### なぜ「何か 1 つ終わらせる」だけでは通らないか

- 無害なデコイを終了させる ── 記録されている blocker の pid は消えないので
  `blocking-session-cleared` が落ち、書き込みも完了しないので残り 2 つも落
  ちる。
- 何もせず待つ ── 同上。このインシデントは自然には解消しない。
- 「最初から問題が起きていなかった」(仮に本当に一度もロック待ちが発生しな
  いバグがあった場合) ── `genuine-wait-then-resolution` はほぼ 0ms の完了
  を明確に弾く。この時間はアプリ自身の信頼できるコード (書き込みを発行した
  瞬間と、実際に返ってきた瞬間) から来ており、参加者が操作できるものでは
  ない。
- 本当に `pg_blocking_pids()` で本物の blocker を特定し、その pid を終了さ
  せた場合だけ 3 つとも通る。

## 提供形態

`metadata.json` は CloudFormation テンプレートの代わりにコンテナ runtime を
宣言し、ホスト側のツールが不要になる Portal 内蔵ターミナル (`runtime.terminal`)
も併せて宣言する:

```jsonc
"runtime": {
  "provider": "docker",
  "engine": "compose",
  "entry": "local/docker-compose.yml",
  "challengeEndpoints": { "Info": "http://127.0.0.1:18510" },
  "verifyUrl": "http://127.0.0.1:18511/verify",
  "secretEnv": ["FLAG_SEED"],
  "terminal": { "service": "db-challenge-blocked-transaction" }
},
"scoring": { "kind": "multi-verify", "checks": [ … 3 checkpoints、計 100 点 … ] }
```

```
db-challenge-blocked-transaction/
├── metadata.json                # runtime (docker/compose) + scoring (multi-verify) + hints
└── local/
    ├── docker-compose.yml       # 1 service、loopback のみの port + healthcheck
    ├── Dockerfile                # postgres:16-alpine ("participant" stage) + node
    ├── entrypoint.sh             # pg 起動、schema 適用、1 回だけ seed、app 起動
    ├── app/
    │   ├── server.mjs           # info/status ページ (:8080) + /verify (:8081)。起動時にインシデントを仕込む
    │   ├── pg-client.mjs        # 実 Postgres アダプタ (残高、blocker の生存確認、待ち時間)
    │   └── package.json         # `postgres` JS driver
    ├── grader/
    │   ├── grade.mjs            # 3 checkpoint 本体 (pure、dependency-injected)
    │   └── grade.test.mjs       # fake client によるユニットテスト。デコイ/偽の解決のケースを含む (bun test、実 DB 不要)
    └── db/
        ├── schema.sql           # app.accounts、audit.incident_log、participant/app_service role、pg_signal_backend + pg_read_all_stats 権限
        └── seed.sql             # 2 行
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
