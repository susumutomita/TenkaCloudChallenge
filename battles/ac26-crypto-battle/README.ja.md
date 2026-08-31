# PROVE / LEAK / HUNT — 暗号バトル

秘密の破片を公開してすぐ得点するか、計算して守るかを選ぶリアルタイム Battle です。

## 最初の3分

1. 青い **ORDER** カードを1枚選ぶ。
2. **LEAK** か **PROVE** を選ぶ。
3. 送信後、Public Ledger に何が残ったかを見る。

- **LEAK**: 計算なしで得点。ただし秘密の破片（share）が公開される。
- **PROVE**: 計算して同じ得点。share は公開されない。

最初から全ルールを覚える必要はありません。Portal の「練習とヘルプ」では、小さい数字の無得点チュートリアルを任意に開けます。

## ゲームの目的

各チームの secret は5枚の share に分かれ、同じ世代の異なる3枚がそろうと復元できます。

- 相手が3種類を公開したら、計算して **HUNT** を狙う。
- 自分の公開が危なくなったら **ROTATE** して新しい世代へ移る。
- 得点しながら、自分の現行世代を復元されないようにする。

同じ index を何度公開しても1種類です。異なる世代の share は混ぜられません。

## ORDER の種類

| カードの依頼 | 画面で行うこと |
| --- | --- |
| share を出す | LEAK または PROVE |
| 暗号文のまま足す | 2つの組を成分ごとに足し、p で割った余りを提出 |
| 覆面つき小計 | 自分の数 + 受信マスク - 送信マスクを p で割った余りを提出 |

カードには期限、得点、依頼内容、使える方法が表示されます。カードにない方法は、その仕事または公開条件を満たしません。

## 6つの操作

| 操作 | 意味 |
| --- | --- |
| LEAK | 指定 share を公開して ORDER を完了 |
| PROVE | Schnorr 証明で share を公開せずに完了 |
| FHE | 暗号文を復号せずに加算 |
| MPC | 各拠点の値を隠したまま合計用の小計を提出 |
| HUNT | 公開情報から復元した secret または再利用 nonce の鍵を提出 |
| ROTATE | secret と share を新しい世代へ更新 |

PROVE と HUNT の式、定数、実行可能な Python は Portal の完全なルール内にあります。PROVE は `ac26-w3-schnorr`、share からの HUNT は `ac26-w2-secret-sharing` と同じ計算です。

## 画面の読み順

1. **Order Belt** — いま選べる依頼
2. **MAKE A MOVE** — 選んだ依頼への操作
3. **My Vault** — 自分の世代と share
4. **Public Ledger** — 全員が公開した記録
5. **公開記録からできる次の作戦** — 材料が出たときだけ開く
6. **練習とヘルプ** — 必要なときだけ開く

HUNT、nonce 再利用 HUNT、ROTATE は、関連する公開材料がない開始直後には表示しません。

## データ境界

- match secret と完全な match state は TenkaCloud の trusted 側だけに置く。
- ブラウザは必ず `projectForTeam` の結果だけを受け取る。
- 自チームの vault と ORDER は自チームだけに見せる。
- 相手の未公開 share、secret、match secret は投影しない。
- Public Ledger に出すのは、参加者が公開を選んだ artifact だけ。

本番の隠し値はサーバー専用 `matchSecret` から導出します。`eventId` は公開情報なので使いません。ローカルだけは `local-play-not-secret:<eventId>` という明示的な非secret fallbackを使います。

## ローカルUI確認

```bash
cd battles/ac26-crypto-battle/dev
bun install --frozen-lockfile
bun test
bun run typecheck
bun run dev                 # http://localhost:5644
```

このハーネスは実 reducer と実 Portal component を使いますが、認証と永続化は fake です。UI確認には使えますが、tenant isolation や実AWS E2Eの証拠にはなりません。

ゲーム本体:

```bash
cd ../game
bun install --frozen-lockfile
bun test
bun run typecheck
```

## 完了条件

リリースゲートは game / dev のテスト・型検査と、実 Portal component を使うブラウザハーネスです。ハーネスでは participant-visible input だけで初手・操作・結果を確認します。実AWSでの通し操作と独立した第三者の試遊は、開催前の任意リハーサルであり、未実施でも開発・mergeを止めません。

## 関連ファイル

- `game/src/reducer.ts` — ルール、判定、team projection
- `game/src/types.ts` — state / op / projection
- `coordination/crypto-battle.ts` — platform adapter
- `portal/` — 参加者UI
- `dev/` — ローカルUIハーネス
- `OPERATOR.md` — 現在の運用境界と検証手順
