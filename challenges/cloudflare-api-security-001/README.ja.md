# セルフデプロイ API セキュリティ — 外部 URL を検証する (`cloudflare-api-security-001`)

AWS アカウントは不要。 自分のプロフィール API を好きな場所 (Cloudflare Workers /
コンテナ / 任意クラウド) に公開し、 その URL を問題の検証エンドポイントに渡す。
この問題が deploy する検証 Lambda が外から API を叩き、 要件をすべて満たすと flag を
返す。 採点条件は検証 Lambda の中だけにある — この README は公開仕様のみ。

## やること

1. 下の契約を満たすアプリを公開し、 その `https://` URL を控える。
2. 検証エンドポイントに自分の URL を渡す。
3. 失敗理由を読み、 API を直して再デプロイ → 再度 verify。
4. 通ったら返ってきた `TC{...}` を Portal に提出する。

ローカルで API を動かしただけでは通らない (検証は問題側の Lambda が外から HTTPS で実行する)。

## API 契約 (公開仕様)

| メソッド + パス | 期待する挙動                          |
| --------------- | ------------------------------------- |
| `GET /healthz`  | `200`、 JSON 本文に `ok` を含むこと   |

入力検証・認可・情報漏えい対策などの追加要件は、 前段を通すと verify の応答に段階的に現れる。

## 検証する

検証用 Function URL はスタック Output `VerifyUrl` (Portal にも表示)。 自分のアプリ URL を渡す:

```bash
curl 'https://<VerifyUrl>/verify?url=https://<あなたのアプリ>.workers.dev'
```

- 受理されるのは公開ホストへの `https://` のみ (private / loopback / メタデータ宛は拒否、 リダイレクトは追従しない)。
- 合格すると `{ "ok": true, "flag": "TC{...}" }` が返る。 その flag を提出する。

## 採点

- 正解 flag: **+200 pt** (1 deploy につき 1 回)。
- 不正解: **-15 pt**/回 (0 未満にはならない)。
- flag は deploy ごとにランダムで、 検証を通さないと得られない。
