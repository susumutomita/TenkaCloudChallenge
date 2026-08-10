# db-a10-primary-replica ── 複製は「コピー」ではなく「追従」

TenkaCloud Database Track (Phase 1, 3 章, Drill A10) の local-play Drill。Docker
だけで動作し、AWS アカウントやクラウドリソースは不要。コンテナ `/verify` 採点
契約を checkpoint 単位で使う (`scoring.kind: "multi-verify"`, TenkaCloud#2252)。

これまでの Database Track の Drill (A1〜A8・A12) と違い、このドリルは **2 コン
テナ** (`primary` と `replica`) を使い、実際の PostgreSQL 物理 streaming
replication で結線する。

> 訓練用ターゲット。両サービスとも `127.0.0.1` のみに bind する。外部公開しな
> いこと。

## 遊び方

```bash
make local PROBLEM=db-a10-primary-replica   # TenkaCloud リポジトリのルートから
# Participant Portal が開く。任意の非空キーでログインする
```

- **挑戦する場所:** 実際の作業は Portal 内蔵ターミナル (`primary` コンテナに入
  る) の `psql` で行う。ブラウザ完結ではない。<http://127.0.0.1:18480> は読み
  取り専用の情報/状態ページ。
- **ゴール:** primary/replica の結線が本物の (一度きりのコピーではない)
  streaming であることを、primary への 2 回・時間差のある書き込みが両方とも
  replica へ届くことで確認する。

内蔵ターミナルがまだ無いビルドの Portal を使っている場合は、手元のターミナル
から同じデータベースへ入れる。

```bash
docker compose -f local/docker-compose.yml exec primary \
  psql -U participant -d drill

# replica も host へ直接公開されている:
psql -h 127.0.0.1 -p 18482 -U participant -d drill
```

## ストーリー

これまでの Drill はすべて 1 台の PostgreSQL コンテナで完結していた。実務の
PostgreSQL 運用では、読み取りスケールや障害対策のために replication がほぼ必
ず登場する。このドリルは最小限の本物を組む ── primary 1 台、streaming replica
1 台を `pg_basebackup` と物理 WAL streaming で結線する。**その結線自体はコンテ
ナ起動時に自動で行われる** ── このドリルは結線を組む練習ではなく、組まれた結
線が実際に何をするかを確認する練習だ。

このドリルが体験させたい核心の驚き: 1 回の書き込みが replica に届いただけでは
あまり多くを証明できない ──「その書き込みの直後にたまたまコピーが取られただ
け」でも説明がついてしまう。別のタイミングでのもう 1 回の書き込みも届くこと
こそが、「本物の streaming replica」と「一度きりのスナップショット」を実際に
分ける違いだ。

## ドメイン

| ノード | 役割 |
| --- | --- |
| `primary` | 通常の読み書き可能な PostgreSQL。`app.ledger` (participant が書き込める)、`replicator` role、物理 replication slot `db_a10_replica` を持つ。Node の info/verify app もここで動く ── `runtime.terminal` の対象もここ。 |
| `replica` | 起動時に `primary` へ `pg_basebackup -R` して作られる hot standby。常に recovery mode (`pg_is_in_recovery() = true`) で、superuser を含む全 role の通常 DML を拒否する。Node app は無い。primary のターミナルから compose のサービス名 `replica` で直接つながるほか、host の `127.0.0.1:18482` へも直接公開されている。 |

`app.ledger` は空の状態から始まる。中の行はすべて参加者自身が書き込んだもの
で、`'wave-1'` か `'wave-2'` のタグが付く。

## streaming を確認し、2 回書き込み、追従することを見る

```sql
-- primary で (psql -U participant -d drill):
select application_name, state, sync_state from pg_stat_replication;
-- 1 行、state = streaming

insert into app.ledger (note) values ('wave-1'), ('wave-1'), ('wave-1');

-- replica で (psql -h replica -U participant -d drill):
select pg_is_in_recovery();                                  -- t
select count(*) from app.ledger where note = 'wave-1';        -- 3

-- primary へ戻り、時間差のあるもう 1 回の書き込み:
insert into app.ledger (note) values ('wave-2'), ('wave-2'), ('wave-2');

-- replica でもう一度:
select count(*) from app.ledger where note = 'wave-2';        -- 3、独立に届いた

-- primary で「追いついている」ことを数字で見る:
select sent_lsn, replay_lsn, pg_wal_lsn_diff(sent_lsn, replay_lsn) as lag_bytes
from pg_stat_replication;                                     -- lag_bytes はほぼ 0
```

この一連の手順 (2 ノード、`pg_basebackup -R`、物理 replication slot、2 波の書
き込み、LSN の差分) は、このドリルを作成する過程で実際に host にインストール
した PostgreSQL 16 の primary + standby ペアに対して実行して確認した ── 実測
値はこの問題が乗った PR の「検証」節を参照 (LSN が一致し、追いついた後の
`lag_bytes` は 0、両方の波が独立に replica へ届いたことを確認済み)。

## 採点の仕組み

プラットフォームは答えを持たず、提出テキストも読まない。「提出」のたびに
`{ checkpointId, submission }` が `primary` コンテナの loopback `/verify`
(`POST http://127.0.0.1:18481/verify`) へ委譲され、両方のノードの現在の状態
(primary/replica の `pg_stat_replication`/`pg_stat_wal_receiver`、両方の
`app.ledger`) を実際に問い合わせて `{ checkpointId, correct, message }` を返
す。

| checkpoint | 実際に何を確認しているか |
| --- | --- |
| `streaming-replication-active` | primary の `pg_stat_replication` に `state = streaming` の行がちょうど 1 件あり、replica も `pg_is_in_recovery() = true` かつ `pg_stat_wal_receiver.status = streaming` か |
| `writes-follow-to-replica` | primary の `app.ledger` に `wave-1`/`wave-2` がそれぞれちょうど 3 件あり、replica にも同じ件数があるか |
| `replica-caught-up` | primary の `pg_stat_replication` から取れる `pg_wal_lsn_diff(sent_lsn, replay_lsn)` が十分小さいか (≤ 1 MiB ── 少数の小さな INSERT に対しては十分余裕を持たせた値) |

何度でも再スキャンしてよい。各 checkpoint は独立しており、満点 100 点のうち
30 / 40 / 30 点を占める。

### なぜこのドリルには `audit` schema が要らないか (A6〜A8・A12 との違い)

これまでの Database Track の Drill は、参加者が自分のテーブルへ持つ通常の読み
書き権限だけで「本当に手順を踏んだか」の信号を偽装できてしまうため、trigger
だけが書く追記専用の `audit` schema を anti-cheat として必要としていた。この
ドリルにはそれが要らない ── **recovery mode (standby) の PostgreSQL サーバー
は、superuser を含む全 role の通常 DML を拒否する**ことを、このドリルを作成す
る過程で実機の Postgres 16 で直接確認した (standby 自身に対する `GRANT` など
の DDL も `cannot execute ... in a read-only transaction` で失敗する)。どちら
のノードにも、参加者が replica の `app.ledger` へ直接書き込める権限は存在しな
い。primary と replica の行数が一致すること自体が、本物の WAL 再生でしか説明
できない事実になる ── replica の read-only という性質そのものが anti-cheat だ。

### なぜ 1 回ではなく 2 波か

1 回の書き込みが replica に届いただけでは、「その書き込みの直後にたまたまス
ナップショットが取られた」可能性を否定できない。このドリルの instructions が
時間差のある 2 回目の書き込みを求めるのは、`writes-follow-to-replica` が両方
を要求できるようにするためだ ── replica が「継続的に」変更を追従しているこ
と、一度きりのコピーではないことを証明する。

## 配信モデル

`metadata.json` は CloudFormation テンプレートの代わりにコンテナ runtime を宣
言し、`primary` service だけに Portal 内蔵ターミナル (`runtime.terminal`) を
宣言する (SCHEMA.json の制約: terminal は宣言した 1 service にしか入れず、そ
の service は `target: participant` でなければならない):

```jsonc
"runtime": {
  "provider": "docker",
  "engine": "compose",
  "entry": "local/docker-compose.yml",
  "challengeEndpoints": { "Info": "http://127.0.0.1:18480" },
  "verifyUrl": "http://127.0.0.1:18481/verify",
  "secretEnv": ["FLAG_SEED"],
  "terminal": { "service": "primary" }
},
"scoring": { "kind": "multi-verify", "checks": [ … 3 checkpoints, 満点 100 pts … ] }
```

```
db-a10-primary-replica/
├── metadata.json                # runtime (docker/compose, 2 services) + scoring (multi-verify) + hints
└── local/
    ├── docker-compose.yml       # primary + replica、loopback のみに port 公開、depends_on: service_healthy
    ├── Dockerfile                # postgres:16-alpine、2 target: "participant" (primary, +node) / "replica"
    ├── entrypoint-primary.sh     # pg 起動 (replication 用設定込み) → schema 適用 (role+slot) → app 起動
    ├── entrypoint-replica.sh     # primary を待つ → pg_basebackup -R → standby として起動
    ├── app/
    │   ├── server.mjs           # 情報/状態ページ (:8080) + /verify (:8081) ── 両ノードへ接続
    │   ├── pg-client.mjs        # 実 Postgres アダプタ (replication 行、recovery 状態、ledger 件数)
    │   └── package.json         # `postgres` JS driver
    ├── grader/
    │   ├── grade.mjs            # 3 つの checkpoint (pure, dependency-injected)
    │   └── grade.test.mjs       # fake client を使う unit test (bun test、実 DB 不要)
    └── db/
        └── schema.sql           # app.ledger (participant 所有)、replicator role、replication slot
```

## grader の unit test を実行する

grader の合否ロジックは fake client による unit test で担保されている ── 実
Postgres 不要、ネットワーク不要。

```bash
cd local/grader && bun test
```

## FLAG_SEED

`make local` が全ての local-play 問題に注入する変数だが、このドリルでは未使
用。全 checkpoint は隠された秘密ではなく実際の replication/データベース状態
を読む。
