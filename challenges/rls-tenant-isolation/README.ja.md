# rls-tenant-isolation — マルチテナント情報漏洩 (Postgres RLS)

> English: [README.md](./README.md)

TenkaCloud の自己完結型 **ローカルプレー** Challenge。 Docker 1 つで完結し (AWS アカウント不要)、 container `/verify` 採点契約 (#2054) を使う。 BtoB SaaS のドキュメント管理アプリでテナント境界が壊れており、 Postgres の Row Level Security で塞ぐ。

> 意図的に脆弱な訓練用ターゲット。 compose は `127.0.0.1` のみに bind する。 loopback の外に公開しないこと。

## 遊び方

```bash
make local PROBLEM=rls-tenant-isolation   # TenkaCloud リポジトリのルートから
# ポータルが開く。 任意の非空キーでログイン
```

- **challenge 表面:** <http://127.0.0.1:18080> — ドキュメント API。 修正そのものは Portal 内蔵の **コンテナターミナル** (`runtime.terminal` → 唯一の compose service `rls-tenant-isolation`) の `psql` で書く: `psql -U postgres -d rls_demo`。
- **ゴール:** 各社のドキュメントを相手社から不可視・不可変にし、 それをデータベースで enforce する。 8 件の攻撃テストを全て通せば正解。

内蔵ターミナルがまだ無いビルドの Portal を使っている場合は、 手元のターミナルから同じデータベースへ入れる。

```bash
docker compose -f local/docker-compose.yml exec rls-tenant-isolation \
  psql -U postgres -d rls_demo
```

## ストーリー

引き継いだのは複数企業向けのドキュメント管理 SaaS (Supabase 風: Postgres + PostgREST)。 顧客は 2 社、 **Acme Corp** と **Beacon Inc**。 各社に owner と member が 1 名ずつと機密ドキュメントが数件。 サポートに「Acme のユーザが他人のドキュメント ID のリンクを開いたら **Beacon** のドキュメントが見えた」 という報告が来た。 テナント境界が壊れている。

## ドメイン

| テーブル        | カラム                                                            |
| --------------- | ----------------------------------------------------------------- |
| `organizations` | `id`, `name`                                                      |
| `memberships`   | `user_id`, `organization_id`, `role` (`owner` \| `member`)        |
| `documents`     | `id`, `organization_id`, `title`, `body`, `created_by`           |

seed されるアクター (`x-user-id` が以下のいずれかに対応):

| user          | org    | role   |
| ------------- | ------ | ------ |
| `alice-owner` | Acme   | owner  |
| `amir-member` | Acme   | member |
| `bella-owner` | Beacon | owner  |
| `ben-member`  | Beacon | member |

## 漏洩を再現する

初期状態の API は identity を持つ (`x-user-id` は検証済み Supabase JWT の代理) が、 アプリ側の `organization_id` フィルタに頼っており、 by-id 経路はフィルタを忘れている:

```bash
# Acme の owner が ID を差し替えるだけで Beacon のドキュメントを読める — 漏洩。
curl -H 'x-user-id: alice-owner' http://127.0.0.1:18080/documents/00000000-0000-0000-0000-00000000bd01

# 匿名 (公開) クライアントが全件を読める — 漏洩。
curl http://127.0.0.1:18080/documents
```

## 脅威モデル

攻撃者は **あるテナントの正規の認証済みユーザ** (または **公開 / anon クライアント**)。 他人の identity は偽造できないが、 以下は **できる**:

- URL / API パラメータ / Supabase クライアント呼び出しの `document_id` を改ざんする。
- UI がリンクしない経路 (検索・件数・CSV エクスポート・生の by-id 読み書き) を含め、 任意の endpoint を叩く。
- プロジェクトの **anon キー** (公開クライアント) を直接使う。
- INSERT / UPDATE の `organization_id` を他テナントに向ける (行の越境 / 所有権の付け替え)。

守る資産: 他テナントの `documents` 行 — 機密性 (越境の読み取り・検索・件数・エクスポート禁止) と完全性 (越境の更新・削除・所有権付け替え禁止)。

### なぜアプリ側の `organization_id` フィルタでは不十分か

アプリ側フィルタ (`... where organization_id = $current_user_org`) は攻撃者が回避できる単一のゲートにすぎない:

1. **経路ごとの対策である。** 開発者がフィルタを覚えていたクエリしか守れない。 この starter の by-id GET / PATCH、 現実には検索・件数・CSV エクスポート・管理ショートカットが、 それぞれ同じ `WHERE` を必要とし、 1 つでも漏れると leak する。 データベースは何も言わないので漏れは静かに起きる。
2. **パラメータ改ざんは行まで届く。** フィルタ済みクエリでさえクライアント由来の ID を信用しており、 ID を差し替えると忘れられた分岐が行を返す。
3. **anon / 公開クライアントはアプリを丸ごと素通りする。** Supabase は PostgREST 経由でテーブルを露出する。 anon キーのリクエストはアプリのフィルタを一切通らない。 データベース層のルールだけが拒否できる。
4. **WITH CHECK にアプリ側の等価物がない。** `organization_id` を他テナントへ *動かす* UPDATE を止めるのは *新しい* 行の性質であり、 RLS の `WITH CHECK` が表現する一方、 散らばったアプリコードが取りこぼしやすい。

よって境界は **最後の砦** としてデータベースに置く。 RLS はどの経路 (どのクライアント) から来ても行を拒否する。

## 解き方

Postgres で境界を enforce する。 ポリシーを動いているデータベースに入れる経路は 2 つあり、 grader はどちらでも構わない (提出のたびに live database を検査するため。 後述)。

**主経路 — Portal のターミナル (checkout 不要)。** コンテナターミナルの 「接続」 を押し、 `psql -U postgres -d rls_demo` でつなぐ。 コンテナは OS user `postgres` で動き、 `entrypoint.sh` は Postgres を trust 認証で Unix socket と `127.0.0.1:5432` に立てるので、 host や password の指定は要らない (entrypoint 自身の `psql -d rls_demo` も同じ経路でつないでいる)。 `alter table … enable row level security;` と `create policy …` をそのまま打つ。 打った瞬間に有効になり、 再起動は要らない。 ターミナルは `compose exec -T` の shell なので psql のプロンプトは出ないが、 `;` ごとに結果は表示される。 ここで作ったものは動いているコンテナの中にだけある: `entrypoint.sh` は起動のたびに `public.documents` のポリシーを全部 drop し、 solution ファイル (空なら `broken-policies.sql`) を読み直すので、 停止→起動で脆弱な状態に戻り、 SQL はもう一度貼り付ける必要がある。

**副経路 — solution ファイル (checkout が必要)。** `local/solution/policies.sql` (空で始まる → コンテナは脆弱な状態を読み込む) を編集して再起動する:

```bash
make local PROBLEM=rls-tenant-isolation   # 再ビルド / 再起動でポリシーを再適用
```

このファイルは read-only で bind-mount され起動のたびに読み込まれるので、 再起動を越えて残る。

どちらの経路でも、 ポリシーは次の 5 つの要件を満たすこと (grader の 8 件の検査はこれを突く):

1. `public.documents` で RLS を **有効化** (テーブル所有者も縛るよう `force` も)。
2. `SELECT` は自社の行のみ。
3. `INSERT` / `UPDATE` は自社のみ + **`WITH CHECK`** で `organization_id` を他社にできない。
4. `DELETE` は **owner** 限定。
5. **anon** は何も読めない。

schema (`local/db/schema.sql`) にポリシーで使う identity ヘルパが定義済み: `app.current_user_id()`、 `app.is_authenticated()`、 `app.current_org_ids()`、 `app.is_owner_of(org)`。 ターミナルからは `\df app.*` で一覧できる。 参照解答は `local/reference/policies.sql` (author stage 限定。 participant image には入らない)。

### psql から効き目を確かめる

RLS は superuser には効かないので、 ポリシーを作ったあとも `postgres` で `select * from public.documents` すると全行返る。 API が見ているものを見るには、 `server.mjs` / `pg-client.mjs` と同じやり方でリクエストの identity を借りる ── RLS が効く role に切り替え、 ヘルパが読む 2 つの GUC を設定する:

```sql
set role app_api;
select set_config('request.jwt.role', 'authenticated', false);  -- または 'anon'
select set_config('app.user_id', 'alice-owner', false);         -- または ''
select id, organization_id, title from public.documents;
reset role;
```

直す前は両 org の全行、 正しく直したあとは Acme の分だけが返る。 次の DDL の前に `reset role` が必要 (`app_api` はポリシーを作れない)。 問題文にも同じ snippet を載せてあり、 `curl` を持たない Portal の参加者にもコンテナ内で feedback loop がある。

## 採点

platform は答えを持たない。 提出時、 ローカル採点 API がコンテナの loopback `/verify` (`POST http://127.0.0.1:18081/verify`) に委譲し、 grader が **8 件の攻撃 assertion** を live Postgres に対して実行して `{ "correct": boolean }` を返す。 提出文字列は捨てられる (`server.mjs` は body を読んで無視する) ので、 Flag 欄は空でなければ何でもよい。 採点されるのはその瞬間に有効なポリシーであり、 1 秒前に psql で打ったものでも起動時に solution ファイルから読んだものでも同じ。 全 8 件 PASS で正解。 正解は 200 点、 誤答は 10 点減点。

8 件目が要る理由: `patchDocument` (検査 3) はアプリの PATCH endpoint が転送するフィールド (`title`、`body`) しか叩かない (`organization_id` は転送しない、 `local/app/server.mjs` 参照)。 そのため grader は検査 1〜7 と同じ仕組み (`local/app/pg-client.mjs`) で、 `UPDATE ... SET organization_id` を SQL レベルで直接実行して確認する。

ここは Postgres の意味論を正確に書いておく価値がある。 `UPDATE` ポリシーに `WITH CHECK` を**一切書かない**場合、 Postgres は `USING` 式を新しい行のチェックにも再利用する — そのため `USING` が `organization_id` で正しく絞られていれば、 別途 `WITH CHECK` を書かなくても同じ行の `organization_id` 付け替えは既に拒否される (これは実際に live database に対して実測して確認済みであり、 ドキュメントからの推測ではない)。 つまり `UPDATE` の `WITH CHECK` を**省略すること自体**は、 要件 4 が警告している穴ではない。

8 件目が実際に捕まえるのは、 `WITH CHECK` 句が**存在するのに** `organization_id` を制約していないケースである — 例えば `app.is_authenticated()` しか再チェックしない場合。 明示的な `WITH CHECK` を書くと、 それが暗黙の (USING 由来の) 保護を完全に置き換えてしまうため、 その明示句が `organization_id` を見ていなければ、 ポリシーの他のどこもそれを止めない。 これが要件 4 が `USING` に任せず `WITH CHECK` を明示的に書くよう求めている理由そのものである — 暗黙の、書かれていない保護は、 あなた自身や後でレビューする人がポリシーを読むだけでは検証できない。

## 配信モデル

`metadata.json` は CloudFormation テンプレートの代わりにコンテナ runtime を宣言し、 唯一の service に Portal 内蔵ターミナル (`runtime.terminal`) を宣言する (SCHEMA.json の制約: terminal は宣言した 1 service にしか入れず、 その service は `target: participant` で build されていなければならない。 docker adapter が attach 時に再検証する):

```jsonc
"runtime": {
  "provider": "docker",
  "engine": "compose",
  "entry": "local/docker-compose.yml",
  "challengeEndpoints": { "DocumentsApi": "http://127.0.0.1:18080" },
  "verifyUrl": "http://127.0.0.1:18081/verify",
  "secretEnv": ["FLAG_SEED"],
  "terminal": { "service": "rls-tenant-isolation" }
},
"scoring": { "kind": "verify", "points": 200, "wrongAnswerPenalty": 10, "hints": [ … ] }
```

```
rls-tenant-isolation/
├── metadata.json                  # runtime (docker/compose) + scoring (verify) + hints
└── local/
    ├── docker-compose.yml         # 1 service (= terminal の対象)、 loopback のみに port 公開、 solution の bind-mount、 healthcheck
    ├── Dockerfile                 # postgres:16-alpine + node
    ├── entrypoint.sh              # pg 起動 → schema/seed 適用 → ポリシー読み込み → app 起動
    ├── app/
    │   ├── server.mjs             # 脆弱なドキュメント API (:8080) + /verify (:8081)
    │   ├── pg-client.mjs          # grader が叩く実 Postgres アダプタ (RLS が効く role で実行)
    │   └── package.json           # `postgres` JS driver
    ├── grader/
    │   ├── grade.mjs              # 8 件の攻撃 assertion (pure, dependency-injected)
    │   └── grade.test.mjs         # fake client を使う unit test (bun test、 実 DB 不要)
    ├── db/
    │   ├── schema.sql             # テーブル + identity ヘルパ + app_api role
    │   ├── seed.sql               # 2 org、 各 2 user、 複数 doc
    │   └── broken-policies.sql    # 脆弱な初期状態 (RLS 無効)
    ├── solution/
    │   └── policies.sql           # ファイル経路の答案 (空で始まる。 ターミナル経路ではファイル不要)
    └── reference/
        └── policies.sql           # 参照解答 (author stage 限定)
```

## grader の単体テスト

grader の pass / fail ロジックは fake を注入した単体テストで検証する (live Postgres もネットワークも不要):

```bash
cd local/grader && bun test
```
