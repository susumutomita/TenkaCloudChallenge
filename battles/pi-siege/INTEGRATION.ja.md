# 本体ローカル競技の接続と検証

正規pathは`battles/pi-siege`。日英metadata、`coordination/pi-siege.ts`、`portal/StatusPanel.tsx`を、連動するTenkaCloud本体branchのレビュー済みカタログへ登録する。問題だけのPRを既存本体へ適用しても実行対応にはならない。本体baseは`05d29d12`、問題試作の参照元は`05ffed84`。[実施記録](EVIDENCE.md)を参照。

## 監査と突破案の体験

監査対象は有限ゲームのプレイヤーの主張であり、研究原稿そのものではない。一種類の4枚なら次数0,1,2,3で指数6。2種類へ2枚ずつなら種類の合計2と次数の合計2で指数4。「どの配置でも6以上」という一般化を破るが、実際の項が非零・大きいとは証明しない。

原稿へつながるのは、非零数に整数由来の下限を付ける、集める場合と散らす場合を両方扱う、二つの評価が両立する配分を探す体験である。補間の定理、複数方向の共有予算、全項の和・余り、無限の論証は移していない。原稿は証明を主張し形式化ソースを公開しているが、全Lean依存ビルド・公理監査・Comparatorは未実施。採点は初等的な分数計算と有限条件だけに依存する。

## 接続契約

| 場所 | 実装 |
| --- | --- |
| 問題metadata | Battle / `local` / `bun`、pluginとruntime entryが同じ、StatusPanel、空exposedPorts、日英の操作・ゴール |
| 本体coordination catalog | 明示したレビュー済みIDだけを、既存loaderでbundle。イベントに固定したbundle/digestを保持 |
| 本体browser catalog | 公開metadata、実Portalと日英content/CSSのみ。game/math/reducer、dev、tests、運営資料は不許可 |
| 共通schema/validator | `local/bun`専用の狭い分岐でplugin/slot/日英参照を検査。AWS/Composeの既存検査は保持 |
| 本体イベント管理 | 作成・準備・開始・match初期化で正確に2チームと状態予算を検査。1イベントのcoordination Battleは1件 |
| 認証・採点・保存 | 既存のteam-key認証、event queue、符号付き差分、SQLite transaction、終了/lock制限を再利用 |

`initialState / validateOp / applyOp / projectForTeam / teamScores`とStatusPanelを再利用し、新しい数学専用APIや採点kindは追加しない。Private試行は本人のprojectionだけ、公開主張と台帳は共有。余計なidentity/clock/score入力は拒否する。

## 状態形式と容量

形式2は旧形式1の最大50受理操作を再生し、旧日本語・構造との一致を確認してから移行する。実旧版のscope監査と混合指数4<6のfixtureで、得点・履歴・同一再送を保持する。不一致や未対応形式を黙って初期化しない。

最大長ID・名前を使い、全50操作を通る4合法ルートを各遷移でJSON復元・計測した。監査ルート55,814 bytes、強化51,996、成立44,516、試行34,502。64KiB（baseBytes 0 / bytesPerTeam 32,768 / 2チーム）の宣言をテストで固定する。測定したルートの上限であり、全入力の厳密な最大値とは扱わない。本体の実保存は既存2MiB guardで検査する。

## 本体で試す

1. 連動する本体branchと固定した`problems`revisionを使い、TenkaCloudで`make install`、`make local`。
2. 主催者がπ包囲戦を選び、2チームを作成。各チームキーを渡し、問題を準備してScheduleを開始。
3. 参加者はそれぞれのキーでPortalへログイン。π包囲戦を開き、両者が準備完了。
4. 最初はp=3、q=1のまま分数を試す。誤差と1/q³の比較を読み、無料の例・3段階ヒントで次の手を考える。
5. 途中終了は本体を停止。同じデータディレクトリで再起動すると続行できる。公式順位は本体Scoreboard、数学の根拠は競技内の得点・判定履歴で確認。

## 確認できた経路

本体HTTP/SQLite試験は未認証・未開始・不正identity・1/3チーム・状態予算超過・lockを拒否し、監査の−3/+4を公式点へ反映。DBを閉じて開き直し、同じoperationの再送で二重加点がないことを確認した。

本体実ブラウザは主催者の選択、独立した2席の認証、未公開試行の非表示、受理後の応答喪失と同一再送、別hostプロセス/新しいブラウザへの途中再起動、4ラウンド・8主張、公式順位1対27、得点履歴、日英切替、390px幅、page errorなしを確認した。練習入口は別の任意経路であり、URLで席を選ぶ無認証・メモリ内の動作を本体の証拠に使わない。

AWS配布・全Lean検証・独立した人間の試遊は未実施。マージ・リリース・AWSデプロイは行わない。
