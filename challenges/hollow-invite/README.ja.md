# Operation "Hollow Invite"

> English: [README.md](./README.md)
> ファシリテーターは [FACILITATOR.md](./FACILITATOR.md)(アンサーキー + 進行台本)を読む。

あなたは独立系エンジニアリング会社 **Kestrel Dynamics** のセキュリティ対応チーム。 従業員の Aoi Tanaka から、 判断に迷うメールの相談が来た。 件名は、 本人に始めた記憶のないスレッドへの返信の体裁。 送信者は米国のコワーキング事業者 **Northgate Cowork** を名乗り、 Google Meet が使えなくなったからと別の会議ツール **Vela Meet** へ誘導している。

メールの認証は通っている ── SPF / DKIM / DMARC すべて pass、 さらに Aoi が過去に書いたように見える引用まで付いている。 では、 これは安全か?

ミッション: **このメールが安全か危険かを事実で判定する**。 危険なら手口・影響範囲・攻撃者インフラを突き止め、 封じ込めと通報まで持っていく。

> 登場するものはすべて架空で、 隔離テナント内で完結する。 使う名前は `.example` と `*.tenka.local` のみ。 外部ネットワーク・実マルウェア・実ペイロードは一切無い。

## デプロイされるもの

ローカルプレイ用のコンテナ 1 つ (AWS アカウント不要)。 これは攻略対象の脆弱アプリ **ではなく**、 あなたの証拠テナントである。

```text
docker compose (127.0.0.1 のみ)
  :18080  調査サーフェス
     ├─ /                         証拠インデックス
     ├─ /artifacts/hollow-invite.eml     報告されたメール (生ヘッダ付き)
     ├─ /clone/  + /clone/app.js         取得済み・無害化した偽会議ページ
     ├─ /artifacts/proxylog.jsonl        ネットワーク観測ログ (T+45)
     ├─ GET  /rdap/domain/{name}         モック RDAP (登録日)
     ├─ GET  /api/meetings/{id}          会議メタデータ
     ├─ POST /meetings/{id}/download     「helper」の動的発行 (マーカーのみ)
     └─ POST /api/heartbeat              presence ビーコン
  :18081  /verify   (loopback; ポータルが採点を委譲する)
```

`FLAG-1` (送信元ドメインの登録日) は、 deploy ごとにランダムな `FLAG_SEED` から生成される。 したがってモック RDAP から読む以外に得る方法はなく、 暗記では解けない。

## 進め方

1. 生の `hollow-invite.eml` をヘッダ込みで読む。 何が認証されているか、 そしてメールが実際に何を要求しているかを見る。
2. モックテナントで裏取りする: 送信元ドメインを RDAP で照会し、 `clone/app.js` を静的解析し、 (T+45 以降) `proxylog.jsonl` を読む。
3. 見つけた事実を、 ポータルの各チェックポイントに提出する:
   - **送信元ドメインの登録日**
   - **DKIM 署名ドメイン** (`d=`)
   - **偽会議アプリの配布エンドポイント**
   - **詐称された人物**
4. 手が止まったらヒントを開く (それぞれ減点付き)。

これはファシリテーター進行の GameDay として実施する。 ファシリテーターがインジェクトを配る (T+15 ドメイン照会 / T+30 二人目の受信者 / T+45 ネットワークログ / T+60 経営問い合わせ) とともに、 論証と成果物を [FACILITATOR.md](./FACILITATOR.md) のルーブリックで採点する。

## 採点

ポータルは 4 つの発見フラグを container の `/verify` で自動採点する (`multi-verify`、 各 50 点)。 ヒントには減点が付く。 100 点満点の GameDay ルーブリック ── ドメイン乗っ取りの論証、 認証が保証する範囲/しない範囲の言語化、 影響範囲判定、 IOC/通報成果物、 および `payload:"none"` だけで無害と断定する等の減点トラップ ── は、 ファシリテーターが別途採点する。 [FACILITATOR.md](./FACILITATOR.md) を参照。

## キーメッセージ

認証・実名・実在風の社名・TLS が揃っても、 正規性の **十分条件** にはならない。 商談の信頼性と、 会議・ログイン・ダウンロード・署名を要求する URL の信頼性は **別に** 評価し、 未知のリンクは踏まず、 既知の独立経路で本人確認する。

## 安全

- `.example` と `*.tenka.local` 以外は使わない / 外部 egress なし / 実ペイロードなし。
- ダウンロードエンドポイントは、 テナント内の無害マーカーへの URL を返すだけ (OS が非マッチなら何も返さない ── `payload:"none"`)。
- `node local/safety-check.mjs` (= `make harness` 相当) が、 予約 TLD のみ / 外部 egress なし / 実行ファイルなし を検査する。 イベント前に必ず実行する。

## コスト

ゼロ。 ローカル Docker コンテナで、 クラウドリソースは作らない。

## 関連ファイル

- [`metadata.json`](./metadata.json) — 問題メタデータ、 `multi-verify` の checks
- [`FACILITATOR.md`](./FACILITATOR.md) — アンサーキー、 進行台本、 100 点ルーブリック
- [`local/`](./local/) — コンテナ: `Dockerfile`、 `docker-compose.yml`、 `app/server.mjs` (モック API + `/verify`)、 `app/artifacts/`、 `app/clone/`、 `safety-check.mjs`
