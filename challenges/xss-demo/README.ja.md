# xss-demo — 格納型XSSによるセッション窃取

Dockerだけで動く、TenkaCloudの小さなローカルChallengeです。AWSアカウントやクラウド
リソースは不要で、`sqli-demo`と同じコンテナ`/verify`採点契約(#2054)を使います。IPA
「安全なウェブサイトの作り方」§1.5のクロスサイト・スクリプティング対策を題材にしています。

> 意図的に脆弱にした教材です。Composeは`127.0.0.1`だけにbindします。
> ループバック外へ公開しないでください。

## 起動

TenkaCloudリポジトリのルートで実行します。

```bash
make local PROBLEM=xss-demo
```

- 攻略対象: <http://127.0.0.1:18080> の日本語「スタッフ掲示板」
- ゴール: 掲示板に投稿し、ページ上の「巡回を依頼」(`POST /admin/report`)で疑似セキュリティ担当に
  巡回させ、ページ上の「受信ログ」(`GET /admin/captured`)で合言葉を読み取り、`TC{...}` だけをPortalへ提出する

## 採点の仕組み

プラットフォームは正解を保持しません。提出内容をループバックの
`POST http://127.0.0.1:18081/verify`へ転送し、コンテナが返す
`{ "correct": boolean }`を採点します。正解は100点、誤答は5点減点です。

フラグはデプロイごとのランダムな`FLAG_SEED`から導出するため、実行ごとに変わり、
秘密値はリポジトリに保存されません。

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
xss-demo/
├── metadata.json
└── local/
    ├── docker-compose.yml
    ├── Dockerfile
    └── app/server.mjs
```

すべての公開portはループバック限定で、`make local-down`により初期状態へ戻せます。
