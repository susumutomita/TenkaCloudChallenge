# db-a6-lock — 行ロックと待たされること

TenkaCloud Database Track (Phase 1, 2 章, Drill A6) の local-play Drill。Docker だ
けで動作し、AWS アカウントやクラウドリソースは不要。コンテナ `/verify` 採点契
約を checkpoint 単位で使う (`scoring.kind: "multi-verify"`, TenkaCloud#2252)。

> 訓練用ターゲット。compose は `127.0.0.1` のみに bind する。外部公開しないこと。

## 遊び方

```bash
make local PROBLEM=db-a6-lock   # TenkaCloud リポジトリのルートから
# Participant Portal が開く。任意の非空キーでログインする
```

- **挑戦する場所:** 実際の作業は Portal 内蔵ターミナルの `psql` で行う。ブラウ
  ザ完結ではない。<http://127.0.0.1:18440> は読み取り専用の情報/状態ページ。
- **ゴール:** widget を更新する transaction を開いたまま commit せずに放置し、
  別セッションが同じ行を更新しようとしてブロックされる様子を観測し、
  `pg_locks`/`pg_stat_activity` で blocker を特定してから、commit して 2 本目
  の更新を完了させる。

内蔵ターミナルがまだ無いビルドの Portal を使っている場合は、手元のターミナル
から同じデータベースへ入れる。

```bash
docker compose -f local/docker-compose.yml exec db-a6-lock \
  psql -U participant -d drill
```

## ストーリー

`inventory.stock` には widget と gadget の 2 行がある。widget は 2 つのセッ
ションが同時に触ろうとする唯一の行だ。Postgres は行レベルでロックを取る ──
ある transaction がある行を UPDATE すると、その transaction が commit または
rollback するまで、他のどの transaction もその同じ行への UPDATE を完了できな
い。これは第三者からの単なる `SELECT` (読み取り) ならブロックされなかったこ
と (A4 の 3 手目) との対比になる ── このドリルは「書き込み同士は待つ」という
話だ。

## ドメイン

| テーブル | 列 |
| --- | --- |
| `inventory.stock` | `id` (PK)、`sku`、`qty` (`check (qty >= 0)`) ── 2 行: widget=300、gadget=120 |
| `audit.lock_wait_log` | `log_id`、`stock_id`、`backend_pid`、`txid`、`stmt_started_at` ── 追記専用、`inventory.stock` への trigger だけが書き込む |

A4 の `bank.accounts` と異なり、`participant` は `inventory.stock` を所有し
ない (理由は下の「participant がテーブルを所有しない理由」を参照)。

## 塞ぐ → 特定する → 解放する

```sql
-- 1. セッション "blocker": widget の在庫を減らし始め、まだ commit しない。
begin;
update inventory.stock set qty = qty - 100 where id = 1;

-- 2. 同じターミナルから、2 本目の psql をバックグラウンドで起動する (& が肝
--    心 ── これが無いと、これから走る update は行ロックで待たされたまま
--    このコマンド自体が戻ってこない):
\! psql -U participant -d drill -c "update inventory.stock set qty = qty - 50 where id = 1;" > /tmp/a6-waiter.log 2>&1 &

-- 3. blocker 側のセッションに戻り、実際に誰かが待たされていることを確認する:
select pid, wait_event_type, wait_event, state from pg_stat_activity where wait_event_type = 'Lock';
-- 1 行、state='active'、wait_event_type='Lock' ── これが waiter だ。

-- 4. waiter から見た blocker の pid を特定する:
select pid, pg_blocking_pids(pid) as blocked_by from pg_stat_activity where wait_event_type = 'Lock';
select pg_backend_pid(); -- 自分自身 (blocker) の pid と一致することを確認する

-- 5. 意図的に待ってから、ロックを解放する:
select pg_sleep(5);
commit;

-- 6. バックグラウンドジョブが正常終了したこと、最終的な数字を確認する:
\! cat /tmp/a6-waiter.log
select * from inventory.stock order by id;
-- widget=150 (300-100-50)、gadget=120 (無傷)
```

上記の数値は、このドリルを作成する過程で実際にローカルの Postgres で計測した
ものである (詳細は下の「閾値の根拠」を参照)。手元の環境では同じ桁数になるが、
必ずしも同じ数字にはならない。

## 採点の仕組み

プラットフォームは答えを持たず、提出テキストも読まない。「提出」のたびに
`{ checkpointId, submission }` がコンテナの loopback `/verify`
(`POST http://127.0.0.1:18441/verify`) へ委譲され、`inventory.stock` と
`audit.lock_wait_log` の現在の状態を実際に問い合わせて
`{ checkpointId, correct, message }` を返す。

| checkpoint | 実際に何を確認しているか |
| --- | --- |
| `gadget-untouched` | このドリルに一切関わらない gadget の在庫数が 120 のまま変わっていないか |
| `widget-qty-correct` | widget の在庫数が blocker (-100) と waiter (-50) の両方を反映して、正確に 150 になっているか |
| `row-lock-wait-observed` | `audit.lock_wait_log` から、ある backend の transaction が実際に COMMIT した瞬間が、別の backend による widget への UPDATE 文がまだ実行中だった時間の内側に収まっているか |

何度でも再スキャンしてよい。各 checkpoint は独立しており、満点 100 点のうち
30 / 30 / 40 点を占める。

### participant がテーブルを所有しない理由

A4 の `bank.accounts` は `participant` が所有している ── A4 の採点は最終的な
行の状態 (残高、`xmin`) しか読まず、所有権があってもそのどちらも偽造できない
ため問題ない。このドリルは違う ── widget.qty の before/after を 1 回読むだけ
では、「2 つのセッションが本当にその行を奪い合った」のか「単に 2 つの独立し
た autocommit UPDATE が競合無しで連続して走った」だけなのかを区別できない ──
どちらも最終的に同じ数字にたどり着く。採点には実際に何が起きたかの持続的な記
録が要る。それが `audit.lock_wait_log` だ (trigger だけが書き込む ──
`local/db/schema.sql` を参照)。もし `participant` が `inventory.stock` を所
有していたら、`ALTER TABLE ... DISABLE TRIGGER` でこの記録を静かに無効化でき
てしまう ── これは「やらずに通す」抜け道にはならない (記録が無いと checkpoint
はむしろ通りにくくなるだけ) が、それでも塞いでおく価値はある。そのため
`inventory.stock` は bootstrap superuser の所有のままにし、`participant` に
は所有権の代わりに狭い `SELECT`/`UPDATE` 権限だけを与えている。

### 経過時間の閾値ではなく「重なり」で判定する理由

「この書き込みに時間がかかった」というだけでは lock 待ちの証拠にならない ──
参加者は自分自身の UPDATE に `pg_sleep()` を仕込むだけで、2 本目のセッション
も実際の競合も無いまま「遅く見せかける」ことができてしまう。本当に偽造でき
ないのは、同じ行に対する 2 つの異なるセッションの書き込みウィンドウの「関係」
そのものだ ── セッション B の transaction が、セッション A による同じ行への
UPDATE 文がまだ実行中の間に本当に commit していたなら、A は B の行ロックで
実際にブロックされていたはずである。これは Postgres 自身の MVCC 並行性制御
が、同じ行への 2 つの UPDATE について保証する事実であり、実際に待たされるこ
となくこの時間関係だけを再現する方法は無い。`local/grader/grade.mjs` の
`findGenuineLockWait()` は、まさにこの重なりを `pg_xact_commit_timestamp()`
(Postgres 自身が記録する、transaction の本当の commit 時刻 ── trigger が
transaction の途中で捕まえたタイムスタンプではない。blocker は自分の UPDATE
が返ってきた後も意図的に transaction を開いたままにするので、trigger 発火時
刻を使うとかえって誤解を招く) を使って探す。

### 閾値の根拠

このドリルを作成する過程で、実際の Postgres 16 に対して計測した数値 (配布す
る Docker image そのものに対してではない ── 理由はこの問題が乗った PR の
「検証」節を参照):

| 状態 | widget | gadget | 実際の lock 待ちが見つかるか |
| --- | --- | --- | --- |
| 未着手 (seed 直後) | 300 | 120 | いいえ (書き込みが無い) |
| blocker だけ実行され、waiter は起動していない | 200 | 120 | いいえ |
| 両方実行、同じ psql セッション、begin 無し | 150 | 120 | **いいえ** (backend_pid が 1 つ ── 2 本目のセッションが存在しない) |
| 両方実行、別セッションだが逐次的 (重なり無し) | 150 | 120 | **いいえ** (時間的な重なりが無い) |
| 両方実行、正しい数字、2 本目が `pg_sleep()` だけで遅く見せかけた | 150 | 120 | **いいえ** (実際の競合が無い) |
| 上記の実際の blocker/waiter フロー | 150 | 120 | **はい** |

最後の 2 行が `row-lock-wait-observed` の存在理由そのものである ── 5 行目は
正解と全く同じ最終数字にたどり着くが、行を本当に握っている相手がいない自己
申告的な遅延では、「commit が相手の実行中の文の時間窓の内側に収まる」という
重なりを再現できないため、捕まる。

## 配信モデル

`metadata.json` は CloudFormation テンプレートの代わりにコンテナ runtime を宣言
し、ホスト側に何もインストールしなくて済むよう Portal 内蔵ターミナル
(`runtime.terminal`) も宣言する。

```jsonc
"runtime": {
  "provider": "docker",
  "engine": "compose",
  "entry": "local/docker-compose.yml",
  "challengeEndpoints": { "Info": "http://127.0.0.1:18440" },
  "verifyUrl": "http://127.0.0.1:18441/verify",
  "secretEnv": ["FLAG_SEED"],
  "terminal": { "service": "db-a6-lock" }
},
"scoring": { "kind": "multi-verify", "checks": [ … 3 checkpoints, 満点 100 pts … ] }
```

```
db-a6-lock/
├── metadata.json                # runtime (docker/compose) + scoring (multi-verify) + hints
└── local/
    ├── docker-compose.yml       # サービス 1 つ、loopback のみに port 公開 + healthcheck
    ├── Dockerfile                # postgres:16-alpine ("participant" stage) + node
    ├── entrypoint.sh             # pg 起動 (track_commit_timestamp=on) → schema 適用 → 1 回だけ seed → app 起動
    ├── app/
    │   ├── server.mjs           # 情報/状態ページ (:8080) + /verify (:8081)
    │   ├── pg-client.mjs        # 実 Postgres アダプタ (在庫数、lock_wait_log)
    │   └── package.json         # `postgres` JS driver
    ├── grader/
    │   ├── grade.mjs            # 3 つの checkpoint + findGenuineLockWait (pure, dependency-injected)
    │   └── grade.test.mjs       # fake client を使う unit test (bun test、実 DB 不要)
    └── db/
        ├── schema.sql           # inventory.stock、audit.lock_wait_log + trigger、participant role
        └── seed.sql             # 2 行
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
