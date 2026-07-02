# IDOR — 読んではいけない他人のオブジェクト

> TenkaCloud Challenge · `challenges/api-idor-demo` · 難易度 2 · 約30分 · `verify` 採点

OWASP API Security Top 10 **API1:2023 Broken Object Level Authorization
(BOLA / IDOR)** を扱う、AWS不要のローカルCTFです。小さなプロフィールAPIと採点用
`/verify`をDockerで起動し、すべて`127.0.0.1`に限定します。

## 起動するもの

| 場所 | 内容 |
| --- | --- |
| ローカルDocker | Node製プロフィールAPI |
| `127.0.0.1:18080` | 攻略対象API |
| `127.0.0.1:18081` | TenkaCloudが利用する`/verify` |

フラグと管理者トークンは、デプロイごとの`FLAG_SEED`からコンテナ内で導出します。
正解や実データはリポジトリに保存されません。

## ミッション

あなたは`guest`としてログイン済みで、APIトークンは`token-guest`です。

- `GET /api/profile`はトークンに対応する自分のプロフィールを返します。
- `GET /api/profile/<id>`はログインだけを確認し、指定IDを読む権限を確認しません。

管理者はユーザーID `1`で、非公開の`note`にフラグがあります。管理者トークンは不要です。

## 手順

1. `make local PROBLEM=api-idor-demo`で問題とPortalを起動します。
2. 任意の空でないキーでPortalへログインします。
3. 自分のプロフィールを確認します。

   ```bash
   curl -H "Authorization: Bearer token-guest" \
     http://127.0.0.1:18080/api/profile
   ```

4. IDを管理者の`1`へ変更します。

   ```bash
   curl -H "Authorization: Bearer token-guest" \
     http://127.0.0.1:18080/api/profile/1
   ```

5. `note`内の`TC{...}`をPortalへ提出します。

| リクエスト | 結果 |
| --- | --- |
| トークンなしで`GET /api/profile/1` | `401` |
| guestで`GET /api/profile` | 自分のプロフィールを`200`で返す |
| guestで`GET /api/profile/1` | 管理者の非公開情報まで`200`で返す |

## 根本原因と対策

認証は「誰か」を確認し、認可は「そのオブジェクトを操作してよいか」を確認します。
このAPIは認証後の所有権確認を忘れています。

- 要求されたIDが本人または許可対象かを確認し、違えば`403`を返す。
- プロフィール応答に秘密フィールドを含めない。
- オブジェクト単位の認可テストを正常系・異常系の両方に追加する。

## コスト

ローカルDockerのみで、AWSリソースや料金は発生しません。
