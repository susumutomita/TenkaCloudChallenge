# LEAK → 公開記録 → HUNT / LEAK → public record → HUNT

## 参加者に最初から伝えるルール

LEAKは、システムにお題を答えてもらう代わりに、そのお題が指定する情報を公開する操作です。HUNTは、公開された値を転記する操作ではありません。公開情報からまだ見えていない値を計算し、指定された回答欄に提出します。

シーザー暗号の固定例では、チームAの鍵は3、平文は2、割る数は7です。LEAKで「平文2 → 暗号文5」を公開します。チームBは5−2＝3と計算し、HUNTには鍵3を提出します。すでに見えている平文2や暗号文5を提出するのではありません。

秘密分散の固定例では、元の秘密は1です。同じ組のかけら #1=2、#2=5、#3=3 が公開されたら、3×2−3×5＋3＝−6、7を足して1と復元します。この係数は番号1・2・3専用です。実際の番号と割る数は画面に従います。相手チーム・世代を混ぜず、同じ番号の重複は1個と数えます。

Vigenèreは3個の鍵、Rotorは車輪の初期位置a・b、RSAはnの異なる素因数2個、じゃんけんは今回の手を回答します。RSAやじゃんけんはLEAK以外の公開情報を使います。旧数独のHUNTは証明の公開マスから元の解を求めます。新規試合のSchnorrは専用のxを使う計算模型であり、シェアの値を知る証明とは同一視しません。

## 実装

- `OrderFocus.tsx`: LEAKボタンの直前に、守る対象・公開する対象・HUNTの回答対象を表示。シェアを元の秘密そのものと呼ばない。Vigenèreは鍵自体ではなく、鍵位置に対応する平文と暗号文を公開する。
- `LeakHuntRules.tsx`: 無料の基本ルールと、同じチーム・同じ数値を通した説明例。HUNT入口では最初から開き、読んだ後は閉じられる。日本語・英語に対応。
- `HuntPanel.tsx`: 基本ルールを既存のHUNTフォームの前に表示。元の実装は内容を変更せず `HuntPanelCore.tsx` に移動し、公開ヘルパーを再エクスポート。説明を操作しても既存フォームを条件付きで外したり再作成したりしない。
- `QuickRules.tsx`: 遊び方にも同じ基本ルールを使用。

採点、正解判定、公開データ、回数制限、締切、認証、保存形式は変更しません。ROTATEや常設の公開状況ストリップを復活させません。

## 確認

追加回帰テスト：`cd battles/ac26-crypto-battle/game && bun test src/information-flow.test.tsx`。
通常のゲーム・ハーネス回帰と型検査は既存CIの対象です。

ローカルでは追加した実コンポーネントをReact 18.2.0とChromiumで独立表示し、日本語・英語、2種類の説明例、折り畳みとキーボード操作、390px幅での横はみ出しなし、44px以上の例切替ボタン、ブラウザpageerror 0件を確認しました。既存HuntGuideも同じ固定シェアで表示しました。これは新しい説明UIの確認であり、実ポータル全体、オンライン採点、認証、AWSデプロイの検証ではありません。リポジトリ全体のローカル実行は行っていません。

## English summary

LEAK publishes evidence in exchange for having an Order answered by the system. HUNT asks for the value recovered from that evidence, not a copy of already-visible data. The free rules explain one complete Caesar example (plaintext 2 → ciphertext 5 → key 3) and one secret-sharing example (shares 2,5,3 → original secret 1, modulo 7). They distinguish the submission target for every existing HUNT mode, including RSA and RPS which do not require LEAK, and the legacy Sudoku model.

The existing HUNT form is kept unchanged in `HuntPanelCore.tsx`. The wrapper adds the independent rules component without conditionally mounting the form. No scoring, deadlines, security boundaries, match data or ROTATE behavior changes. Local verification covers the actual new rules component in an isolated browser view, not the complete live portal or AWS deployment. The existing CI runs normal game and harness regression tests and typechecks.
