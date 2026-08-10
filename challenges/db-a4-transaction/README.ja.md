# db-a4-transaction — Transaction と原子性

TenkaCloud Database Track (Phase 1, 2 章, Drill A4) の local-play Drill。Docker だ
けで動作し、AWS アカウントやクラウドリソースは不要。コンテナ `/verify` 採点契
約を checkpoint 単位で使う (`scoring.kind: "multi-verify"`, TenkaCloud#2252)。

> 訓練用ターゲット。compose は `127.0.0.1` のみに bind する。外部公開しないこと。

## 遊び方

```bash
make local PROBLEM=db-a4-transaction   # TenkaCloud リポジトリのルートから
# Participant Portal が開く。任意の非空キーでログインする
```

- **挑戦する場所:** 実際の作業は Portal 内蔵ターミナルの `psql` で行う。ブラウ
  ザ完結ではない。<http://127.0.0.1:18430> は読み取り専用の情報/状態ページ (現
  在の残高と `xmin` も見える)。
- **ゴール:** alice (id 1) から bob (id 2) へ 1000 cents を、1 つの原子的な操
  作として送金する。

内蔵ターミナルがまだ無いビルドの Portal を使っている場合は、手元のターミナル
から同じデータベースへ入れる。

```bash
docker compose -f local/docker-compose.yml exec db-a4-transaction \
  psql -U participant -d drill
```

## ストーリー

`bank.accounts` には alice、bob、carol の 3 行がある。alice から bob への送金
は、実際には 2 つの独立した `UPDATE` 文でしか表現できない。transaction 無しで
実行し、途中で失敗すると、片方だけ確定した状態が残る ── どこからともなくお金
が増える (あるいは消える)。

## ドメイン

| テーブル | 列 |
| --- | --- |
| `bank.accounts` | `id` (PK)、`owner`、`balance_cents` (`check (balance_cents >= 0)`) ── 3 行: alice=3000、bob=10000、carol=7000 |

## 壊す → 守られることを見る → 正しくやる

```sql
-- 1. transaction 無し: alice の残高を超える金額 (5000 cents) を送金してみる。
update bank.accounts set balance_cents = balance_cents + 5000 where id = 2; -- bob を加算、成功
update bank.accounts set balance_cents = balance_cents - 5000 where id = 1; -- alice を減算、ERROR (check 制約違反)
select sum(balance_cents) from bank.accounts;
-- 20000 のはずが 25000 ── bob は受け取ったのに、alice からは実際には引かれていない。

-- 2. 手で復旧する (transaction 無しでは自動では戻らない):
update bank.accounts set balance_cents = balance_cents - 5000 where id = 2;

-- 3. 同じ失敗する送金を、今度は transaction の中で:
begin;
update bank.accounts set balance_cents = balance_cents + 5000 where id = 2;
update bank.accounts set balance_cents = balance_cents - 5000 where id = 1; -- 同じ ERROR
-- この後どんなコマンドを打っても "current transaction is aborted" ── ROLLBACK するまで何もできない
rollback;
select sum(balance_cents) from bank.accounts;
-- すでに 20000 ── 今回は手で直す必要が無い。bob への加算は一度も commit されていない。

-- 4. 未 commit の不可視性を、1 つのターミナルの中から自分の目で見る:
begin;
update bank.accounts set balance_cents = balance_cents - 1000 where id = 1;
select balance_cents from bank.accounts where id = 1;               -- 2000 (自分の書き込みは自分に見える)
\! psql -U participant -d drill -c "select balance_cents from bank.accounts where id = 1;"
-- 2 本目の独立した psql プロセスからは 3000 (\! は元の transaction を裏で
-- 開いたまま、一時的にそのプロセスを起動する) ── 未 commit の書き込みは
-- 他のどのセッションからも見えない。
rollback;

-- 5. 実際のゴール ── 正しく commit する:
begin;
update bank.accounts set balance_cents = balance_cents - 1000 where id = 1;
update bank.accounts set balance_cents = balance_cents + 1000 where id = 2;
commit;
```

上記の数値は、このドリルを作成する過程で実際にローカルの Postgres で計測した
ものである (詳細は下の「閾値の根拠」を参照)。手元の環境では同じ桁数になるが、
必ずしも同じ数字にはならない。

## 採点の仕組み

プラットフォームは答えを持たず、提出テキストも読まない。「提出」のたびに
`{ checkpointId, submission }` がコンテナの loopback `/verify`
(`POST http://127.0.0.1:18431/verify`) へ委譲され、`bank.accounts` の現在の状
態 (残高と `xmin` システム列) を実際に問い合わせて `{ checkpointId, correct, message }`
を返す。

| checkpoint | 実際に何を確認しているか |
| --- | --- |
| `total-balance-conserved` | テーブル全体の `sum(balance_cents)` が seed 時点の合計 (20000) のままか。carol など送金に無関係な行への副作用も含め、どこかに残った不整合を捕まえる |
| `transfer-applied-correctly` | alice の残高がちょうど 2000、bob の残高がちょうど 11000 ── このドリルが求める送金の具体的な期待値 |
| `updates-committed-atomically` | alice と bob の現在の行が同じ `xmin` (最後にその行を書いたトランザクション ID) を共有しているか。2 つの独立した autocommit 文で正しい数字にたどり着いても、他の 2 つの checkpoint が通っていてもここは通らない |

何度でも再スキャンしてよい。各 checkpoint は独立しており、満点 100 点のうち
30 / 30 / 40 点を占める。

### 閾値の根拠

このドリルを作成する過程で、実際の Postgres 16 に対して計測した数値 (配布す
る Docker image そのものに対してではない ── 理由はこの問題が乗った PR の
「検証」節を参照):

| 状態 | 合計 | alice | bob | alice.xmin == bob.xmin |
| --- | --- | --- | --- | --- |
| 未着手 (seed 直後) | 20000 | 3000 | 10000 | **いいえ** (意図的に別々の 2 本の INSERT で seed している) |
| no-tx デモ後、後片付け前 | 25000 | 3000 | 15000 | いいえ |
| 後片付け後 / tx+ROLLBACK 後 | 20000 | 3000 | 10000 | いいえ |
| `begin`...`commit` による正しい送金 | 20000 | 2000 | 11000 | **はい** |
| 2 つの独立した autocommit 文による「数字だけ正しい」送金 | 20000 | 2000 | 11000 | いいえ |

最後の行が `updates-committed-atomically` の存在理由そのものである ── 正解と
同じ最終残高に、2 つの書き込みを一度も transaction で包まずに到達したケース。

## なぜ `grading` baseline table ではなく `xmin` なのか

db-a2-index-tradeoff の採点基準 (index 追加前のバッファ数) は実行時にしか分か
らない値なので `grading` schema に一度だけ記録する必要があったが、A4 の目標残
高は `local/db/seed.sql` の時点で固定・既知 (3000 / 10000 / 7000) であり、
db-a2 の `TARGET_ORDER_NUMBER` や db-a3 の `RARE_VALUE`/`COMMON_VALUE` と同じ
ように `local/grader/grade.mjs` にハードコードしてよい ── これは instructions
がそのまま参加者に伝えている値であって、隠された答えではない。A4 には追加の
`grading` schema は不要である。

`xmin` は Postgres が各行に自動的に刻む「その行を最後に書いたトランザクショ
ン ID」というシステム列である。alice と bob の現在の `xmin` を比較すること
は、「2 人の現在の値が本当に 1 つのトランザクションとして一緒に書かれたか」
という、推測では満たせない実際のデータベースの事実になる。

## 配信モデル

`metadata.json` は CloudFormation テンプレートの代わりにコンテナ runtime を宣言
し、ホスト側に何もインストールしなくて済むよう Portal 内蔵ターミナル
(`runtime.terminal`) も宣言する。

```jsonc
"runtime": {
  "provider": "docker",
  "engine": "compose",
  "entry": "local/docker-compose.yml",
  "challengeEndpoints": { "Info": "http://127.0.0.1:18430" },
  "verifyUrl": "http://127.0.0.1:18431/verify",
  "secretEnv": ["FLAG_SEED"],
  "terminal": { "service": "db-a4-transaction" }
},
"scoring": { "kind": "multi-verify", "checks": [ … 3 checkpoints, 満点 100 pts … ] }
```

```
db-a4-transaction/
├── metadata.json                # runtime (docker/compose) + scoring (multi-verify) + hints
└── local/
    ├── docker-compose.yml       # サービス 1 つ、loopback のみに port 公開 + healthcheck
    ├── Dockerfile                # postgres:16-alpine ("participant" stage) + node
    ├── entrypoint.sh             # pg 起動 → schema 適用 → 1 回だけ 3 行 seed → app 起動
    ├── app/
    │   ├── server.mjs           # 情報/状態ページ (:8080) + /verify (:8081)
    │   ├── pg-client.mjs        # 実 Postgres アダプタ (残高、xmin)
    │   └── package.json         # `postgres` JS driver
    ├── grader/
    │   ├── grade.mjs            # 3 つの checkpoint (pure, dependency-injected)
    │   └── grade.test.mjs       # fake client を使う unit test (bun test、実 DB 不要)
    └── db/
        ├── schema.sql           # bank.accounts、participant role
        └── seed.sql             # 3 行、別々の 3 本の INSERT で (grade.test.mjs のコメント参照)
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
