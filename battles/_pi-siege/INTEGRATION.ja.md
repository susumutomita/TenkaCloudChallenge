# TenkaCloud競技として使うための残り

このPRだけで、同じPortal componentとcoordination pluginを使った日本語2席対戦をローカルで遊べる。4ラウンド、公開前の試行、券の配分、反例、精算、終了解説、通信再送まで確認した。**主催者が問題を選んでイベントを作り、参加者が本体の認証と公式得点で競う状態は未完成**。以下を満たす連携変更が完了条件である。

## 監査と突破案の体験

監査対象はプレイヤーの主張であり、原稿そのものではない。例えば「4枚を一種類に集めた指数6だから、すべての混ぜ方も6以上」というプレイヤーの一般化を、2種類に2枚ずつの指数4で破る。これは有限模型の保証の誤りで、原稿の定理の反例ではない。

原稿の突破案へつながる体験は、(1)ゼロではない数に整数由来の下限を付ける、(2)種類を集める場合と散らす場合の両方を扱う、(3)二つの評価が両立する配分を作る、という部分。πの近似をただ探すだけでは越えられない壁を小さい数で体験する。補間の定理、複数方向の共有予算、係数・全項の和・余り、無限の論証は移していない。

原稿は定理の証明を主張し形式化ソースを公開しているが、ここでは全Leanビルド・公理監査・Comparatorを実行していない。競技の採点は初等的な分数計算と有限の条件だけを使う。監査が成功しても原稿の反証にはならず、模型の構築に成功しても原稿の主定理を証明した意味にはならない。

## 現行コードで確認した境界

参照した本体: TenkaCloud `05ffed84`。本体は読取のみで変更していない。

| 現行の場所 | 現行動作 | 必要な変更 |
| --- | --- | --- |
| `scripts/local-host/coordination-runtime.ts:coordinationCatalog` | 暗号Battle 1件を固定IDでbundleし、既存`LocalPluginLoader`へ渡す | レビュー済みID一覧へ`pi-siege`を追加し、同じloaderで`coordination/pi-siege.ts`をbundleする |
| `scripts/local-host/browser-metadata.ts` | 公開カタログ・native runtime表示・dashboard公開・Portal globとモジュール許可が暗号Battleだけ | レビュー済みπ問題だけを追加。Portalと公開content/CSSを許可し、`game/math.ts`・`game/reducer.ts`・tests・運営資料をブラウザへ入れない |
| Challenge `SCHEMA.json` / `scripts/validate-problems.ts:checkCrossRefs` | `runtime`は形として予約を許すが、実検査はCFnかコンテナ。`local/bun`を宣言するだけでは使えない | 本体対応と同時にnative coordinationの狭い検査分岐を追加。既存plugin/slot相互参照を行い、AWS templateやDocker verifierを要求しない |
| `scripts/local-host/service.ts` / `coordination.ts` | イベントにcoordination Battleは最大1件。認証、queue、SQLite状態と得点の同時保存、終了/lock制限は既存 | この2チームゲームのrosterを作成/開始前に検査。3チームで突然plugin例外になる経路を提供しない。初期化前に両者のjobをCOMPLETEにする |
| `apps/participant-portal/src/plugins/loader.ts` / `PortalPluginSlots.tsx` | metadataのslotを実componentへ解決し、認証済みcoordination clientを注入 | πのmetadata/allowlistで実slotを解決する。本PRのcomponentとpluginを再利用し、`dev/app.tsx`の席URLやresetを本体へ持ち込まない |
| `scripts/local-host/coordination-core.ts` / `score.ts` | 既存hookの`teamScores`から差分を保存。未指定floorは符号付き点を保持 | −3を含む試合でplugin・Portal・本体順位表・監査履歴の値を一致させる |

新しい採点kind、数学専用API、別reducerは不要。既存の`initialState / validateOp / applyOp / projectForTeam / teamScores`とStatusPanel slotを使う。既存hostの認証・状態保存・採点窓も再利用する。まずAWSなしの**本体local host**を対象とし、クラウド実行やAWS配布をこの完了条件に含めない。

## 問題側の登録変更

1. 本体の対応変更と同時に`battles/_pi-siege`を`battles/pi-siege`へ戻し、日英metadataを追加。学習内容の名前・タグ・背景・最初の操作・勝敗条件を記す。日本語画面だけである現状を登録時に解消し、localeによる日英画面・ヒント・feedbackを確認する。
2. 既存の形で`interTeamCoordination.plugin = coordination/pi-siege.ts`、`dashboard.slots.StatusPanel = portal/StatusPanel.tsx`を指定。提案するnative宣言は`runtime = {provider: local, engine: bun, entry: coordination/pi-siege.ts}`だが、**本体/validator対応まで未登録**。free-form schemaを通っただけで実行対応とは扱わない。
3. 2チーム・全4ラウンドの最大長合法履歴でstateのbyte量を各遷移で測り、測定に基づく`stateBudget`を固定。最大入力、監査成功/失敗、行・目盛り強化、replay履歴、得点台帳を含む。推定値をmetadataへ書かない。
4. 起動・待機・無料ヒントで0点、未公開試行の非表示、公開後の証拠、終了解説、scoreReasonsの公開情報境界を本体の参加者経路で確認。問題を読み、無料例から手計算できることも確認する。

`_pi-siege`は暫定の非カタログ名である。通常名のmetadataなしディレクトリだと、本体browserカタログが全ディレクトリのmetadataを読む際にENOENTになる不良を確認した。underscoreはそのIDフィルタから外れるため既存カタログを壊さない。架空のmetadataで登録済みと見せず、連携PRでのみ正規名へ移す。

## 競技としての完了条件

- 本体の主催者カタログからπ包囲戦を選び、AWSなしで1イベント・2チームを作成/開始できる。暗号Battleを選んだ既存イベントも継続して動く。
- 2つの別の参加者ログインから本体Portalで4ラウンドを完走する。席URLの変更では他人になれない。第三チーム・別イベント・未開始・終了後・lock中の操作を所定の理由で拒否する。
- 待機/ヒント0点、券切れ、pass、正しい/誤った主張、成功/失敗監査、比較点、二重送信、同時書込みを検査する。pluginの符号付き得点と本体順位表・履歴が一致する。
- hostを途中で停止/再起動し、状態・私的試行・公開主張・同一requestのreceiptが復元される。再送が二重加点にならない。終了・lock・teardownは既存hostの管理経路を通る。
- participant bundleを検査し、採点関数・他人の試行・運営の期待値を含まない。日英・desktop/mobile・数学用語・ヒント・終了解説を確認する。
- 問題側gateと本体側のcatalog/bundle/coordination HTTP/Portal/SQLite/browser検査が同じ登録済みrevisionで成功する。READMEの「登録済み」表記はこの証拠を得てから更新する。

本PR専用CIは問題テスト・型検査・独立計算・Linuxの実2席ブラウザを実行する。ただしそのgreenは上記の本体統合条件を満たした意味ではない。[実施記録](EVIDENCE.md)と区別する。
