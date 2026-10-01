# sqli-demo — SQLインジェクションによるログイン回避

Dockerだけで動く、TenkaCloudの小さなローカルChallengeです。AWSアカウントやクラウド
リソースは不要で、コンテナ`/verify`採点契約の参照実装でもあります。IPA
「安全なウェブサイトの作り方」§1.1のSQLインジェクションを題材にしています。

> 意図的に脆弱にした教材です。Composeは`127.0.0.1`だけにbindします。
> ループバック外へ公開しないでください。

## 起動

ローカル開催を統合したTenkaCloudのリポジトリのルートで実行します。

```bash
make local
```

1. 表示された開催者用URLを開き、初期設定とサインインを行います。
2. この問題と参加チームを含むイベントを作成し、参加アクセスを準備してイベントを開始します。
3. 各チームに専用の参加リンク・キーを渡します。Participant Portalでこの問題を選び、「起動 / 再開」を押します。
4. アクセス先URLの「Web」を開きます。チームごとに専用の環境とURLを割り当てるため、このREADMEの固定ポートを参加者用URLとして使わないでください。
5. パスワードを知らない`admin`としてログインし、表示された合言葉をPortalへ提出します。

`make down`ではイベント、得点、途中の作業を保持したまま停止します。
再度起動して問題環境を再開すると続きから取り組めます。明示的に問題を撤収すると
コンテナとボリュームを削除します。旧版のプラットフォームでは、その版に対応した手順を参照してください。

## 採点の仕組み

プラットフォームは正解を保持しません。提出内容をループバックの
`POST http://127.0.0.1:18081/verify`へ転送し、コンテナが返す
`{ "correct": boolean }`を採点します。正解は100点、誤答は5点減点です。ヒントの減点も適用され、得点はマイナスになることがあります。

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
  "points": 100,
  "wrongAnswerPenalty": 5,
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
