# sqli-demo — SQLインジェクションによるログイン回避

Dockerだけで動く、TenkaCloudの小さなローカルChallengeです。AWSアカウントやクラウド
リソースは不要で、コンテナ`/verify`採点契約の参照実装でもあります。IPA
「安全なウェブサイトの作り方」§1.1のSQLインジェクションを題材にしています。

> 意図的に脆弱にした教材です。Composeは`127.0.0.1`だけにbindします。
> ループバック外へ公開しないでください。

## 起動

TenkaCloudリポジトリのルートで実行します。

```bash
make local PROBLEM=sqli-demo
```

- 攻略対象: <http://127.0.0.1:18080> の「Acme Staff Login」
- ゴール: パスワードを知らない`admin`としてログインし、管理画面のフラグをPortalへ提出する

## 採点の仕組み

プラットフォームは正解を保持しません。提出内容をループバックの
`POST http://127.0.0.1:18081/verify`へ転送し、コンテナが返す
`{ "correct": boolean }`を採点します。正解は200点、誤答は10点減点です。

フラグと管理者パスワードはデプロイごとのランダムな`FLAG_SEED`から導出するため、
実行ごとに変わり、秘密値はリポジトリに保存されません。

## 配信モデル

`metadata.json`はCloudFormationの代わりにコンテナruntimeを宣言します。

```jsonc
"runtime": {
  "provider": "docker",
  "engine": "compose",
  "entry": "local/docker-compose.yml",
  "challengeEndpoints": { "Web": "http://127.0.0.1:18080" },
  "verifyUrl": "http://127.0.0.1:18081/verify",
  "secretEnv": ["FLAG_SEED"]
},
"scoring": {
  "kind": "verify",
  "points": 200,
  "wrongAnswerPenalty": 10,
  "hints": [ … ]
}
```

```text
sqli-demo/
├── metadata.json
└── local/
    ├── docker-compose.yml
    ├── Dockerfile
    └── app/server.mjs
```

すべての公開portはループバック限定で、`make local-down`により初期状態へ戻せます。
