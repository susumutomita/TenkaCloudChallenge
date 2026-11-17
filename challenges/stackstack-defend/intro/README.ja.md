# 漏えいを止める一問（Issue #958・公開前のローカル版）

初見の初級〜中級エンジニアが、架空会員サイトで被害を観測し、本人の利用を保ちながら不正閲覧を止める短い日本語Web演習です。**3分は目標で、人間による初見計測は未実施です。** 公開・クラウド契約・インフラ作成はしていません。

## 起動と終了

リポジトリrootから、Node.js 22以降（標準モジュールのみ）で実行します。

```sh
node challenges/stackstack-defend/intro/server.mjs
# http://127.0.0.1:18090 を開く
# Ctrl-C で受付停止、全演習プロセスを破棄
node --test challenges/stackstack-defend/intro/*.test.mjs
make install
make agent-gate
```

この起動はローカル専用です。Docker・AWS・Simulatorは不要です。既存の本編 `make local PROBLEM=stackstack-defend`、5 checkpoint、60秒holdとmetadataは変更しません。このディレクトリは本編に付属する導入モードであり、新しいPortal runtime adapterやカタログ問題ではありません。LPと標準ポータルへの接続は別作業です。

## 体験と実装

「開始」→Aとして自分とBの架空住所・連絡先を比較→閲覧ルールを変更→HTTP確認→認証と認可の違いを学ぶ、という順です。ヒントは最初から無料で開けます。全拒否などを選んでもルールを戻せます。終了で枠を返し、やり直しでは別プロセス・別資格情報・別IDから再開します。同一ブラウザのタブは同一枠を共有します。リロードは進行状況と適用ルールを復元します（直前の表示本文は保持せず、再要求で表示します）。

ブラウザはgatewayの許可されたAPIに要求します。専用workerが、内部のHTTPサーバの `/profile?id=...` をAのまま読みます。画面にはブラウザ要求と内部GETの区別・対象ID・実応答を表示します。修正は、サーバ上のデータ形式のpolicyを変更します。コード修正、実VM、実AWS、別攻撃者ホスト、ネットワーク機器の防御を体験したとは表現しません。

- `runtimes/stackstack/app/access-policy.mjs` は本編Defendからそのまま抽出した、strictなpolicy検証とdefault-deny/deny優先の評価器です。本編と導入が同じ実装を使います。他のscenarioはこれをimportしません。
- workerは固定候補の設定をpolicyデータへ変換します。任意コード、ファイルパス、URL、HTTPメソッド、外部リクエスト先を入力するAPIはありません。
- 即時の8 HTTP probeで、A→A / B→Bの200と**完全な正しい本文**、A→B / B→Aの403を、既存IDと毎回新しい乱数IDの両方で確認します。事前の本人・漏えいの観測も必要です。全許可・全拒否・停止503・制限429・観測IDだけの許可は不合格です。設定の変更で過去の合格は失効し、再確認します。
- verifierはworker内の関数です。制御はIPCのみで、公開 `/verify`・admin・任意reset・本編 `/api/settings` はありません。結果は今回のチェックの観測で、持続的な安全性や第三者による監査の保証ではありません。60秒の負荷確認を導入で待たせません。
- 検証失敗・timeoutは502/エラー表示となり合格にしません。再試行、継続失敗時は終了→開始を案内します。

## セッション境界・上限（実装済み）

- gatewayと別のOSプロセスを各sessionに割り当てます。既定4、設定上限8枠。開始のawait前に枠を予約し、**プロセスのexitを観測するまで枠を再利用しません**。満員は503＋再試行案内です。オートスケールも待ち行列もありません。
- TTL既定5分、設定上限10分。期限を延長する操作はありません。終了・期限切れ・エラーで資格情報を無効化してworkerをkill。新sessionは乱数ID/資格情報で初期状態から始まります。メモリ以外に状態は保存しません。
- 256-bit乱数のsession資格情報はHttpOnly・SameSite=Strict Cookieのみ（HTTPS originではSecure）。URL、localStorage、レスポンス本文、ログへ出しません。内部HTTPにも別の乱数資格情報が必要です。workerにはgatewayのsession Cookieを渡しません。
- クライアントが他sessionを指定する引数はなく、state・policy・採点・終了はCookieが指すworkerだけに到達します。入力は `target: self/other` と固定の `scope` のみです。パスとメソッドを完全一致で許可し、query付き・未知のAPIは404です。
- 変更操作は厳密なOrigin一致とカスタムheaderが必要です。Hostも構成したoriginと一致必須。CORSなし、CSP、no-store、no-referrer、textContent表示。1 KiB JSON、8 KiB header、5秒request/header/socket timeout、4秒IPC timeout、1.2秒probe timeout、1 session 1実行、全体32処理・48接続、socketごと100要求。全体300要求/分・20新規開始/分（固定window）です。上限応答429/503も画面へ表示します。IP別Mapは作りません。
- workerはNode heap上限64 MiB、標準入出力を閉じ、環境変数はTZのみ。Docker socket、ホスト秘密、クラウド資格情報、親の環境変数を渡しません。workerは入力を評価・実行せず、ファイルアクセスや外部宛てfetchをしません。
- OSプロセス分離はコード実行を許すsandboxではありません。同じOSユーザーからの攻撃やNode自体の侵害までは隔離しません。gatewayとworkerを機密のない専用実行環境に置くことが公開前の前提です。

環境変数: `PORT`（既定18090）、`PUBLIC_ORIGIN`（厳密な外向きorigin）、`MAX_SESSIONS`（1〜8）、`SESSION_TTL_MS`（1〜600000）。loopback bindは固定です。TLS終端proxyも同じ実行環境からloopbackへ接続する想定です。サブパス配信は未対応です。複数gatewayを起動すると上限はプロセスごとに増えるため、単一gatewayを運用上固定します。

## 公開前に必要な運用・未実施項目

ここに書く内容は**実装済みのクラウド設定ではありません**。

- TLS終端reverse proxyで専用originを使い、Hostを維持。外部からgatewayの許可APIだけへ到達させ、worker loopback・本編Simulator・管理・メトリクスを公開しない。HTTPS Cookie動作、CSRF、proxy越しのtimeout/切断/停止を再テストする。
- 専用非rootユーザー、秘密なし・read-only filesystem、capability禁止、PID/CPU/RSS/FD上限をOS/containerで設定する。workerのheap制限はRSS/CPUの強制上限ではない。Docker socket・ホストmount・クラウドのinstance credentials/metadata到達権を渡さない。ネットワークnamespace/firewallで外部egressを拒否し、内部loopbackだけ許可する。これらはローカルMac上で適用・検証していません。
- 単一gateway・最大枠固定、reverse proxy側の同時接続・body・rate・送信量制限、運営の停止スイッチ、アラートと停止手順を検証する。SIGTERM/Ctrl-Cで全workerを止める実装はありますが、クラウド側の停止操作は未構築です。
- VM、CPU/メモリ、ディスク、TLS/proxy、ログ、外向き転送、DDoSなどが費用要因です。Region・provider・利用契約は未選択。固定台数や予算アラートは請求の絶対上限ではありません。無料・絶対上限は保証しません。拒否応答にも転送費が発生し得ます。公開前に契約上/技術上の上限と停止責任者を決めてください。
- access/errorログからCookie/Authorization/本文を除外。現状は起動URL以外をログに出さず、外部analyticsを実装しません。入口到達・開始・初問成功・本編開始の評価は、将来、本文/回答/認証情報を含めない設計で別途実装します。
- 初見者の補助なしplaytestを実施し、開始〜成功の時間、つまずき、本人の言葉での被害/修正/練習内容を記録する。人間計測・学習評価・動画は未実施です。本Issue全体の完了とは扱わずDraftでレビューします。

## 検証と再撮影

自動テストはpolicy評価、実HTTP一連、正負両方向、新規ID、偽修正、session間分離、TTL/再利用、上限と並列開始、CSRF、bad input/body、rate、私有route非公開、本編Defendのdrill/hold/正当なpublish/resetを確認します。`make agent-gate`へ追加してCIでも実行します。JSは`node --check`で構文確認します。独立した型検査/lint設定はありません。

ブラウザ確認: 接続Macのin-app browser、PCと390×844幅で開始→観測→修正→8件成功、全拒否失敗、リロード、やり直し、終了を確認。390px幅でdocument横幅とscroll幅はともに390pxでした。実スマートフォン、他ブラウザ、クラウド、長時間負荷は未検証です。ブラウザ操作は自動/エージェントによる確認であり、人間の3分計測ではありません。

再撮影台本: 開始画面の「実HTTP」「3分は目標」を映す→自分Aの200→他人Bの200とID差分→所有者を比べるルールに変更→HTTP確認のA/A 200、A/B 403、B/A 403、B/B 200と新規ID→学びの一文。生のCookie・tokenやDevToolsのrequest headerを映さないでください。静止画/動画そのものはこのPRには含めません。

検証実行環境: 接続MacのNode 22.23.5と26.13.0。全体rate枠を使い切った場合も、認証済みの終了操作は可能です。

成功後だけ表示する任意の「実務ではどう実装する？」補足で、設定→実HTTP処理と共通評価器→本人許可/他人拒否の実テストの対応を示します。例は実装済みコードからの抜粋で、対応をテストで固定しています。業務の所有者・所属・例外権限の確認、サーバでの認証/認可、APIごとの正負テストへ橋渡しします。所属や管理者の例外を本演習で実装したとは扱いません。
