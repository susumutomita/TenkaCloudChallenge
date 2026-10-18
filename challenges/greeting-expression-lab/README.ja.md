# 来訪者カード、公開してよい？

**Draft・配信経路の確認待ち。** 検証host（Docker Engine29.6.1 / Compose5.3.1）では、2つのinternal network内のサービスはhealthyになりましたが、host公開portは有効になりませんでした（NetworkSettings.Portsがnull）。internalを弱めずプラットフォームの入口を確認するまでは実大会で選択しないでください。内部HTTPの確認と、Portal/host portからの到達確認は別です。

受付の来訪者カードを引き継いだ保守担当として、公開前の不具合を調査する入門Challengeです。
記号を含む名前で失敗し、別の入力では行が増えたという報告から、単なる表示不具合か、公開を止めるべき
情報漏えいかを証拠で判断します。初期問題文には攻撃手法名や非公開設定のキー名を出しません。

入口は普通の名前/プレビュー画面で、そこから実在する `/handover` の「引き継ぎメモ」を読めます。
現在の文字列組み立て断片、必要な小言語の仕様、公開値と値を伏せた非公開設定の一覧を公開します。
隠しURLや未公開文法の当て物ではありません。正常名、無害な記号、引用符の失敗、連結結果の変化、
追加行、公開値の参照、非公開値への影響を比較しながら仮説を検証します。

完了条件は入力/出力の比較、運用確認コード、根拠付きの原因・修正説明です。
正解100点、不正解1回5点、ヒント20/30点減点。**自動採点はコードだけ**で、原因説明は演習ノートを
主催者と確認します。文章の質を自動評価したとは扱いません。

## TenkaCloudから起動する

プラットフォームのカタログ取得元設定でこのrevisionを選びます。TenkaCloud側で `make local` を
起動し、この問題を含む大会を作り、チームキーを配布します。参加者はPortalから問題を起動・再開し、
保護されたアクセス先の **Web** を開きます。各チームのportと秘密はプラットフォームが割り当てます。
下記の開発用固定portを参加者へ配布しないでください。

既存のDocker Compose + `verify` 契約を使い、native runnerは変更しません。
Docker Engine/Composeが必要で、Codespacesのnative public modeではCompose問題は除外されます。
遠隔Composeにはプラットフォーム対応のnative Linux隔離が必要です。loopback待受だけで
参加者PCや家庭LAN全体が隔離されるわけではありません。起動のためにVPN/firewall設定を変更したり、
採点口を公開したりしないでください。

## 構成と安全境界

- `local/app/lab.mjs`: 参加者画面と限定教材インタプリタです。入口は名前と出力だけの通常UIで、リンクされた `/handover` に実装断片と文法の手掛かりがあります。
  `print("Hello, <name>!");` へ名前を直接連結する、意図的な欠陥があります。
  言語は文字列・`+`・`print`・許可した2つの辞書キー参照だけです。JavaScriptのeval/Function/vm、
  属性走査、実OS環境変数、ファイル、シェル、通信、メモリ参照の機能は持ちません。
  入力・命令数・式の項数・出力に上限があり、HTML出力も別途エスケープします。
- 教材用 `env` 辞書には公開値 `COLOR` と架空の `FLAG` だけを入れます。**process.envではありません**。
  起動時だけ注入済み `FLAG_SEED` を読み、形式を確認し、用途を分けたHMACで架空FLAGを作ります。
  その後seedをprocess環境から削除します。固定FLAGや既定seedはなく、本物の認証情報は注入しません。
- `local/app/verifier.mjs`: 別コンテナが同じseedから正解を導出します。
  POST `/verify` は `{ "submission": "..." }` を受け、`{ "correct": boolean }` だけを返します。
  不正解の理由や期待値は返しません。
- Composeは2つの別々のinternal network、loopback限定公開、非root、read-only root、capability削除、
  権限昇格禁止、リソース制限、health checkを使います。host mountやDocker socketはありません。
  参加者imageへは `lab.mjs` だけをcopyし、採点実装・テスト・metadata・解説・参照解答を含めません。

これは**限定された教材用シミュレーション**で、汎用コード実行sandboxではありません。
小さな言語へのコードインジェクションを示します。実際の環境変数の秘密を探索せず、メモリダンプも
カーネル攻撃も任意JavaScript実行も行いません。evalへの置換やhost資源の接続はしないでください。
コード・構成の境界には単体/HTTPテストがありますが、実Dockerでの通信制御は別のリハーサルです。

## 原因・取得経路・修正（作者向け）

`metadata.json` のwriteupで、引用符と命令の追加により教材辞書の値を表示する経路を解説しています。
その解説やテスト内の参照payloadは参加者imageに含めません。追加した命令が辞書を読むのであり、
メモリを吸い出す処理ではありません。

修正版 `safeGreeting(name)` は入力をデータとして直接あいさつへ組み立て、コードを作って解析しません。
疑わしい単語の禁止や引用符のエスケープに頼る修正ではありません。同じpayloadが修正版では文字列の
まま表示され、架空FLAGが出ないことを回帰テストで確認します。HTMLエスケープはこれとは別に必要です。
`local/tests/lab.test.mjs` は意図した欠陥と修正、禁止機能、上限、採点の異常系を確認します。

## 検証

このrepoのルートで実行します。

```bash
make install
make agent-gate
node --test challenges/greeting-expression-lab/local/tests/lab.test.mjs
```

問題テストはNode22以降を使います（imageはNode22）。架空seedと一時loopback listenerだけを使い、
browser・Docker・AWS・実際の秘密は不要です。HTTPテストは画面のメモリンクをたどり、正常名・無害な記号・引用符の失敗・連結・追加行・公開設定・非公開値の影響を比較します。別の採点口を確認し、
他環境のFLAG・不正/過大入力を拒否します。採点実装/ファイルのURLが公開されず、HTMLもescapeされることを
確認します。

任意の、使い捨て開発環境での内部限定Docker smoke testです。稼働中hostを再起動しません。
一時overrideで両方のhost公開portを除去します。`!override` はCompose5.3.1で確認しました。

```bash
cd challenges/greeting-expression-lab/local
export FLAG_SEED="$(node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))')"
exercise_override="$(mktemp)"
cat > "$exercise_override" <<'YAML'
services:
  web:
    ports: !override []
  verifier:
    ports: !override []
YAML
docker compose -f docker-compose.yml -f "$exercise_override" config --quiet
docker compose -f docker-compose.yml -f "$exercise_override" up --build -d --wait
docker compose -f docker-compose.yml -f "$exercise_override" exec -T web node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>{if(!r.ok)process.exit(1)})"
docker compose -f docker-compose.yml -f "$exercise_override" exec -T verifier node -e "fetch('http://127.0.0.1:8081/healthz').then(r=>{if(!r.ok)process.exit(1)})"
# 内部確認のみ。この検証hostではhost port/Portal接続は未成立。
docker compose -f docker-compose.yml -f "$exercise_override" down
rm "$exercise_override"
unset FLAG_SEED exercise_override
```

固定portが使用中なら起動しないでください。どちらもLAN/Internetへ公開しません。
単体テストやカタログCIの成功だけで、このDocker手順を実施済みとは扱いません。

## リソース・保持・終了

AWS/cloud資源やRegionはなく、金額表は使いません。2コンテナそれぞれ最大128MiB・0.5CPU・32process、
2つのinternal bridgeとloopback portを使います。image取得/buildにはディスクと起動前の通信が必要です。
演習は25分程度、永続volumeはありません。TenkaCloudの `make down` は所有環境を停止し、大会・得点・
参加者情報と再開用の保存済み秘密を保持します。明示teardownは問題のコンテナ/networkを削除します。
単独smoke testは上記 `docker compose down` でそのprojectだけを終了します。同じprojectの終了までは
seedを保持してください。seedを変えると合言葉も変わります。

このPRの検証対象は問題の単体/HTTPテストと既存カタログgateです。別途、2コンテナ内部HTTPの解答・採点リハーサルをPRへ記録します。
host port/Portal接続、遠隔チームの隔離、実競技の動作を認定するものではありません。
両internal networkを保持し、relayや通常networkへのfallbackは追加していません。
