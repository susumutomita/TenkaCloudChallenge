# 入場端末の信頼境界

> TenkaCloud Challenge · `festivalgate-terminal-api` · 難易度3 · 約60分 · `multi-verify`

4つの独立したcontrol gapと、設定変更後のhidden state検査を扱う、AWS不要のlocal
API-security教材です。架空serviceと合成dataだけを使い、1つのDocker containerで動きます。

## runtimeと安全境界

| address | 用途 |
| --- | --- |
| `127.0.0.1:18080` | 端末APIと、所有者が使う正規security設定 |
| `127.0.0.1:18081` | loopback限定の`/verify` |

両listenerはloopbackだけに公開します。端末credential、staff PIN、各checkpoint flagは、
デプロイごとの新しい`FLAG_SEED`から導出します。

## scenario

FestivalGateの入場端末はticket照会と入場処理だけを担当するはずですが、実装は次の4つの
危険な仮定に依存しています。

1. clientが送るproxy headerで「内部request」だと証明できる。
2. 運営summaryは利便性のためcustomer数やsecretを返してよい。
3. 端末identityは運営serviceと同じ広いdata接続を使ってよい。
4. 3桁support PINでも試行回数を制御しなくてよい。

4つを別々の発見として採点し、最後に自己申告ではなくserverの実状態から防御設定を検査します。

## checkpoint

| ID | 証跡 | 点 |
| --- | --- | ---: |
| `proxy-boundary` | 「内部限定」境界を越えた後に返る監査marker | 40 |
| `response-scope` | 過剰な運営summary field内の監査marker | 40 |
| `terminal-data-scope` | 端末identityから読めるcustomer record内の監査marker | 40 |
| `attempt-throttling` | 制御されないPIN探索後に返る監査marker | 40 |
| `security-remediation` | 5つの防御設定をhidden stateで検査 | 40 |

是正すると証跡へのaccess pathが閉じるため、先に4つの合言葉を集めます。

## 監査手順

1. 問題を起動します。

   ```sh
   make local PROBLEM=festivalgate-terminal-api
   ```

2. `http://127.0.0.1:18080/`を開き、割り当てられたlow-privilege端末tokenと公開仕様を確認します。
3. `/internal/ops/status`を通常requestして`403`を確認します。serverがrequest中のどの値で
   内部・外部を判断しているか考えます。
4. client自身が指定した内部らしいfirst hopを`/internal/ops/status`と
   `/internal/ops/summary`の両方へ試します。summaryは目的以上のfieldを返します。
5. 端末tokenで隣接する`/api/terminal/customers/<id>`を調べます。小さな整数IDは列挙可能です。
6. top pageにある3桁`/api/terminal/staff-unlock?pin=000`を調べます。初期状態では誤答を
   繰り返しても試行制御が発動しません。
7. 4つの`TC{...}`を対応するPortal rowへ提出します。
8. `/owner/security`を開き、全rowを是正します。

   - client headerをidentityとして信頼しない。
   - 運営responseを最小化する。
   - 端末identityからcustomer dataへのaccessを削除する。
   - PIN試行制御を有効化する。
   - 運営secretを端末serviceのdata pathから分離する。

9. `security-remediation`へ`VERIFY`を提出します。

## 是正後に確認できること

- 偽装した`X-Forwarded-For`では運営endpointを開けない。
- 端末からcustomer data endpointを呼ぶと`403`になる。
- 3回PINを誤ると後続requestは`429`になる。
- 運営secretがsummaryのdata pathから分離される。
- 是正checkpointの`VERIFY`が成功する。

containerを再起動すると意図的に脆弱な初期状態へ戻り、credentialとflagがすべてrotateします。

## 根本原因から学ぶこと

- network boundaryは補助防御でありauthenticationではない。管理されたproxyが確立した
  metadataだけを信頼し、各endpointでidentityを検証する。
- 認可に成功しても、backing record全体を返してよいわけではない。業務目的に必要なfieldだけを返す。
- terminal service identityはticket操作だけに限定し、customer dataと運営secretを別identity・
  data storeへ分ける。
- entropyの低いcredentialにはrate limit、lockout、監視、より強いprimary authenticationが必要である。

## 関連file

- `local/app/server.mjs` — API surface、所有者control、SQLite data、採点
- `local/docker-compose.yml` / `local/Dockerfile` — loopback限定runtime
- `metadata.json` — 日英checkpoint label、hint、採点
