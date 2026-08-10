# db-a11-replication-lag ── 発生させ、観測し、解消する

TenkaCloud Database Track (Phase 1, 3 章, Drill A11) の local-play Drill。Docker
だけで動作し、AWS アカウントやクラウドリソースは不要。コンテナ `/verify` 採点
契約を checkpoint 単位で使う (`scoring.kind: "multi-verify"`, TenkaCloud#2252)。

前提となる db-a10-primary-replica と同じ 2 ノード構成 (`primary` + `replica`、
本物の物理 streaming replication) を、独立にもう一度セットアップして使う ──
A10 とコンテナを共有しない。

> 訓練用ターゲット。両サービスとも `127.0.0.1` のみに bind する。外部公開しな
> いこと。

## 遊び方

```bash
make local PROBLEM=db-a11-replication-lag   # TenkaCloud リポジトリのルートから
# Participant Portal が開く。任意の非空キーでログインする
```

- **挑戦する場所:** 実際の作業は Portal 内蔵ターミナル (`primary` コンテナに入
  る) の `psql` で行う。ブラウザ完結ではない。<http://127.0.0.1:18490> は読み
  取り専用の情報/状態ページ。
- **ゴール:** `recovery_min_apply_delay` で replica の apply を意図的に絞り、
  primary へ書き込んで `pg_stat_replication.replay_lag` が実際に伸びることを
  確認し、delay を戻してもう一度書き込み、lag が実際に縮むことも確認する。

内蔵ターミナルがまだ無いビルドの Portal を使っている場合は、手元のターミナル
から同じデータベースへ入れる。

```bash
docker compose -f local/docker-compose.yml exec primary \
  psql -U participant -d drill

# replica も host へ直接公開されている:
psql -h 127.0.0.1 -p 18492 -U participant -d drill
```

## ストーリー

`recovery_min_apply_delay` は実在の PostgreSQL 設定だ ── standby が WAL レコー
ドを「受け取ってから」、実際に「適用する」までに意図的に N 秒待つよう指示す
る。WAL 自体はいつも通り即座に stream される (primary の `sent_lsn`/`flush_lsn`
は遅れずに進む) ── 遅れるのは適用の段階だけだ。これは実運用でも本当に使われる
機能で、意図的に遅らせた replica は操作ミスからの復旧バッファになる (誤った
`DROP TABLE` の WAL が適用される前に recovery を止めれば、ミス前の状態にまだ
アクセスできる)。このドリルでは、参加者が安全なサンドボックスの中で lag を意
図的に発生させるためのつまみとして使う。

このドリルを作成する過程で確認した驚き: `replay_lag` は常時カウントアップし
続けるカウンターではない。primary が standby から「新しく適用した」という
feedback を受け取った瞬間だけ再計算される値で、それ以外の間は直前に計算され
た値を保持し続けているだけだ。だからこそ、delay を戻しただけでは
`replay_lag` はすぐには小さくならない ── 新しい適用を実際に起こす、もう 1 回
の書き込みが必要になる。

## ドメイン

A10 と同じ 2 ノード構成 (primary/replica の役割表はそちらの README を参照) に
加えて、このドリル独自のもの:

| オブジェクト | 役割 |
| --- | --- |
| `app.events` (primary、participant 所有) | 自由に INSERT できる ── apply を絞っている間に write load を発生させるために使う。 |
| `GRANT ALTER SYSTEM ON PARAMETER recovery_min_apply_delay TO participant` | `participant` が変更してよい唯一の GUC (PostgreSQL 15+ の細粒度権限)。primary 側で付与する (standby は GRANT を含む通常の DML/DDL を全て拒否するため)。role/parameter ACL はクラスタ共有の catalog なので replica 側へも自動的に複製される。 |
| `GRANT EXECUTE ON FUNCTION pg_reload_conf() TO participant` | `ALTER SYSTEM SET` を再起動無しで反映させるために必要。 |
| `audit.lag_samples` | `pg_stat_replication.replay_lag` の継続的な履歴。primary の Node app がコンテナ起動からずっと約 1 秒おきに記録し続ける ── participant の DML では一切書き込めない。`/verify` が呼ばれた瞬間には起きていない spike もその後の解消も、これがあるから grader から見える。 |

## 絞る → lag が伸びるのを見る → 戻す → lag が縮むのを見る

```sql
-- replica で (psql -h replica -U participant -d drill):
alter system set recovery_min_apply_delay = '8s';
select pg_reload_conf();

-- primary へ戻り:
insert into app.events (payload) select 'load-' || g from generate_series(1, 20) g;

-- 数秒後、primary で:
select replay_lag from pg_stat_replication;    -- 約 8 秒

-- replica でもう一度:
alter system set recovery_min_apply_delay = '0';
select pg_reload_conf();

-- primary で ── 古い replay_lag を更新するには、もう 1 回の書き込みが必要:
insert into app.events (payload) values ('recovered');

-- 数秒後:
select replay_lag from pg_stat_replication;    -- ほぼ 0 に戻る
```

この一連の手順 (grant、絞る、spike、戻す、解消) は、このドリルを作成する過程
で実際に host にインストールした PostgreSQL 16 の primary + standby ペアに対
して実行して確認した ── 実測値はこの問題が乗った PR の「検証」節を参照 (設定
した delay がほぼそのまま反映され、reset + 追加の書き込みの後 lag はサブミリ
秒まで戻った)。

## 採点の仕組み

プラットフォームは答えを持たず、提出テキストも読まない。「提出」のたびに
`{ checkpointId, submission }` が `primary` コンテナの loopback `/verify`
(`POST http://127.0.0.1:18491/verify`) へ委譲され、live な replication 状態と
`audit.lag_samples` の全履歴を実際に問い合わせて `{ checkpointId, correct,
message }` を返す。

| checkpoint | 実際に何を確認しているか |
| --- | --- |
| `streaming-replication-topology-active` | A10 と同じ構造の baseline チェック ── streaming が実際に繋がっているか |
| `lag-induced` | `audit.lag_samples` に `replay_lag_seconds >= 3` のサンプルがあるか |
| `lag-resolved` | 直近 5 件のサンプルがすべて 1 秒未満で、かつそれより前 (直近の窓の外) に 3 秒以上の spike が記録されているか |

何度でも再スキャンしてよい。各 checkpoint は独立しており、満点 100 点のうち
20 / 40 / 40 点を占める。

### なぜ `lag-resolved` は「それより前の spike」も確認するか

一度も絞られなかった replica もずっと lag がほぼ 0 のままだ ── それだけで
`lag-resolved` を通してはいけない (何も直していないから)。直近の低い区間より
「前」に induce 相当の spike があったことを要求するのが、「lag を発生させて
から、その後解消した」という順序そのものを、「最初からずっと低かっただけ」
と区別する仕組みだ。

### なぜこのドリルには live query ではなく継続的なサンプル履歴が要るか

`pg_stat_replication.replay_lag` は適用の間、値が古いまま (stale) であること
を、このドリルを作成する過程で実機の Postgres 16 で確認した (「ストーリー」
節参照)。`/verify` が呼ばれた「その瞬間」だけの問い合わせでは、発生させた
spike もその後の解消も、どちらも見逃しうる。primary の Node app が約 1 秒お
きに記録し続ける `audit.lag_samples` があるからこそ、grading の瞬間に何も起
きていなくても両方の瞬間を見ることができる ── これまでの Database Track の
Drill が trigger で書く `audit` schema に持たせてきた役割を、別種の一過性の
事実に対して果たしている。

## 配信モデル

`metadata.json` は CloudFormation テンプレートの代わりにコンテナ runtime を宣
言し、`primary` service だけに Portal 内蔵ターミナル (`runtime.terminal`) を
宣言する ── A10 と同じ形:

```jsonc
"runtime": {
  "provider": "docker",
  "engine": "compose",
  "entry": "local/docker-compose.yml",
  "challengeEndpoints": { "Info": "http://127.0.0.1:18490" },
  "verifyUrl": "http://127.0.0.1:18491/verify",
  "secretEnv": ["FLAG_SEED"],
  "terminal": { "service": "primary" }
},
"scoring": { "kind": "multi-verify", "checks": [ … 3 checkpoints, 満点 100 pts … ] }
```

```
db-a11-replication-lag/
├── metadata.json                # runtime (docker/compose, 2 services) + scoring (multi-verify) + hints
└── local/
    ├── docker-compose.yml       # primary + replica、loopback のみに port 公開、depends_on: service_healthy
    ├── Dockerfile                # postgres:16-alpine、2 target: "participant" (primary, +node) / "replica"
    ├── entrypoint-primary.sh     # pg 起動 (replication 用設定込み) → schema 適用 (role+slot+GUC grant) → app 起動
    ├── entrypoint-replica.sh     # primary を待つ → pg_basebackup -R → standby として起動
    ├── app/
    │   ├── server.mjs           # 情報/状態ページ (:8080) + /verify (:8081) ── 背景の lag sampler を起動
    │   ├── pg-client.mjs        # 実 Postgres アダプタ + startLagSampler (タイマーで audit.lag_samples へ記録)
    │   └── package.json         # `postgres` JS driver
    ├── grader/
    │   ├── grade.mjs            # 3 つの checkpoint (pure, dependency-injected)
    │   └── grade.test.mjs       # fake client を使う unit test (bun test、実 DB 不要)
    └── db/
        └── schema.sql           # app.events (participant 所有)、replicator role、replication slot、GUC grant、audit.lag_samples
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
