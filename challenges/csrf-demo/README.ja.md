# csrf-demo — 設定変更エンドポイントへのCSRF

Dockerだけで動く、TenkaCloudの小さなローカルChallengeです。AWSアカウントやクラウド
リソースは不要で、`sqli-demo`/`xss-demo`と同じコンテナ`/verify`採点契約(#2054)を
使います。IPA「安全なウェブサイトの作り方」§1.6のクロスサイト・リクエスト・
フォージェリ対策を題材にしています。

> 意図的に脆弱にした教材です。Composeは`127.0.0.1`だけにbindします。
> ループバック外へ公開しないでください。

## 起動

TenkaCloudリポジトリのルートで実行します。

```bash
make local PROBLEM=csrf-demo
```

- 攻略対象: <http://127.0.0.1:18080> の「Acme Security — 怪しいページの通報」窓口
- ゴール: 設定変更エンドポイント (`POST /settings/email`) は有効な管理者セッションが
  付いているかしか確認していない ── 本人の意思による送信かは見ていない。
  そのエンドポイントを狙う自動送信フォームを含むページを通報し、
  疑似セキュリティ担当 (サインイン済み) に `POST /admin/review-reports` で
  「開かせる」と、 担当自身のセッションでそのフォームが送信される。
  `GET /admin/notification-status` からフラグを読み取る

## 採点の仕組み

プラットフォームは正解を保持しません。提出内容をループバックの
`POST http://127.0.0.1:18081/verify`へ転送し、コンテナが返す
`{ "correct": boolean }`を採点します。正解は100点、誤答は5点減点です。

フラグはデプロイごとのランダムな`FLAG_SEED`から導出するため、実行ごとに変わり、
秘密値はリポジトリに保存されません。管理者のセッショントークンはどのルートからも
公開されないため、フラグは疑似担当を経由した本物の偽装リクエストによってのみ
到達可能で、設定変更エンドポイントを直接叩いても届きません。

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
  "points": 100,
  "wrongAnswerPenalty": 5,
  "hints": [ … ]
}
```

```text
csrf-demo/
├── metadata.json
└── local/
    ├── docker-compose.yml
    ├── Dockerfile
    └── app/server.mjs
```

すべての公開portはループバック限定で、`make local-down`により初期状態へ戻せます。
