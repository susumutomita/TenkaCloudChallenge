# rls-tenant-isolation — マルチテナント情報漏洩 (Postgres RLS)

> English: [README.md](./README.md)

TenkaCloud の自己完結型 **ローカルプレー** Challenge。 Docker 1 つで完結し (AWS アカウント不要)、 container `/verify` 採点契約 (#2054) を使う。 BtoB SaaS のドキュメント管理アプリでテナント境界が壊れており、 Postgres の Row Level Security で塞ぐ。

> 意図的に脆弱な訓練用ターゲット。 compose は `127.0.0.1` のみに bind する。 loopback の外に公開しないこと。

## 遊び方

```bash
make local PROBLEM=rls-tenant-isolation   # TenkaCloud リポジトリのルートから
# ポータルが開く。 任意の非空キーでログイン
```

- **challenge 表面:** <http://127.0.0.1:18080> — ドキュメント API。
- **ゴール:** 各社のドキュメントを相手社から不可視・不可変にし、 それをデータベースで enforce する。 7 件の攻撃テストを全て通せば正解。

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

Postgres で境界を enforce する。 `local/solution/policies.sql` (空で始まる → コンテナは脆弱な状態を読み込む) を編集して再起動する:

```bash
make local PROBLEM=rls-tenant-isolation   # 再ビルド / 再起動でポリシーを再適用
```

ポリシーは 7 件の検査を満たすこと:

1. `public.documents` で RLS を **有効化** (テーブル所有者も縛るよう `force` も)。
2. `SELECT` は自社の行のみ。
3. `INSERT` / `UPDATE` は自社のみ + **`WITH CHECK`** で `organization_id` を他社にできない。
4. `DELETE` は **owner** 限定。
5. **anon** は何も読めない。

schema (`local/db/schema.sql`) にポリシーで使う identity ヘルパが定義済み: `app.current_user_id()`、 `app.is_authenticated()`、 `app.current_org_ids()`、 `app.is_owner_of(org)`。 参照解答は `local/reference/policies.sql`。

## 採点

platform は答えを持たない。 提出時、 ローカル採点 API がコンテナの loopback `/verify` (`POST http://127.0.0.1:18081/verify`) に委譲し、 grader が **7 件の攻撃 assertion** を live Postgres に対して実行して `{ "correct": boolean }` を返す。 全 7 件 PASS で正解。 正解は 300 点、 誤答は 10 点減点。

## grader の単体テスト

grader の pass / fail ロジックは fake を注入した単体テストで検証する (live Postgres もネットワークも不要):

```bash
cd local/grader && bun test
```
