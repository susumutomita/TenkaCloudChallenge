# PROVE / LEAK / HUNT — 暗号リアルタイム判断 Battle

> English: [README.md](./README.md)

| 項目           | 値                             |
| -------------- | ------------------------------ |
| カテゴリ       | Battle (リアルタイム PvP)      |
| 難易度         | 4 / 5 (上級)                    |
| 想定時間       | 120 分                          |
| status         | `draft`                        |

あなたのチームは `secret` を持ち、**Shamir (t, n) しきい値秘密分散**で
`shareCount` 個の share に分割して保持しています。試合中、自チーム宛に
Contract が届き続けます。share を公開する・相手の隙を突く・自分の secret を
更新する — そのどれもが実際の暗号計算であり、シミュレーションではありません。
暗号の正しさは運にしない — 実際に成立した計算だけが得点になります。

## コアループ

- **LEAK** — Contract が要求する share を公開して即座に得点する。公開した値は
  **Public Ledger** に永久に残り、全チームから見えるようになります。LEAK
  自体は減点されません — 漏洩のコストは「今」ではなく、「誰かがあなたの
  share をしきい値分集めて secret を復元したとき」に、後から発生します。
- **HUNT** — Public Ledger から相手チームの share を `threshold` 分集め、
  **Lagrange 補間**で secret を復元し、その値を提出する。実際の secret と
  一致すれば得点し、相手は減点されます。一致しなければ (share が足りない、
  当て推量、あるいは異なる世代の share を混ぜてしまった、など) 何も起こり
  ません。もっともらしい推測に部分点はありません。
- **ROTATE** — 自チームの secret を新しい世代に更新する。この時点より前に
  leak した share は、現行 secret の復元には無価値になります — 新しい世代は
  独立に導出された全く別の多項式なので、旧世代と新世代の share を混ぜても
  何も復元できません。ROTATE にはクールダウンがあり、防御として連発する
  ことはできません。
- **PROVE** — secret を一切明かさずに、その知識を持っているという証明
  (zero-knowledge 的な主張) だけで得点する手段。LEAK と違い、成功した
  PROVE は Public Ledger に一切触れません。

## 3 つのレーン

- **Contract Queue** — 今まさに自チーム宛に届いている LEAK 依頼の一覧。
  どの share index を要求しているか、得点、期限が示されます。期限内に
  応じないと失効します。
- **My Vault** — 自チームの現行 secret、この世代の全 share、スコア、
  ROTATE クールダウンの残り時間。他チームには一切見えません。
- **Public Ledger** — 全チームがこれまでに LEAK した share の全公開履歴。
  HUNT はここから始まります — 相手チームが現行世代のしきい値を超えて
  share を晒していないか監視してください。

## スコアリング、一言で

LEAK は完了した瞬間に得点、HUNT は検証済みの正しい復元でのみ得点、
ROTATE はクールダウンというコストを払う代わりに、それ以前に漏洩した
全 share を遡って無価値にします。「LEAK で今すぐ稼ぐ」と「ROTATE で
安全を確保する」の間のテンポを読みながら Public Ledger で相手の隙を
監視し続けたチームが勝ちます。

## 学習目的

- Shamir (t, n) しきい値秘密分散と Lagrange 補間を、攻撃 (HUNT) と防御
  (ROTATE) の両面から実際に使う。
- share を公開 (LEAK) するコストが即時ではなく将来の HUNT リスクとして
  発生することを理解する。
- しきい値未満の share が秘密について何も語らないことを実行可能な形で
  確認する。
- secret rotation が過去に漏洩した share を無効化する仕組みを体験する。

## 関連ファイル

- [`metadata.json`](./metadata.json) — 問題メタデータ (UI / scoring engine の
  正本)
- [`template.yaml`](./template.yaml) — 競技者アカウントにデプロイされる
  1 ページ CFn テンプレート (参加者アクセスの baseline のみ — なぜ試合状態が
  チームごとの AWS インフラではないかは `OPERATOR.md` を参照)
- [`game/`](./game/) — この Battle が動く pure game model (state / reducer /
  Shamir 実装)
- [`OPERATOR.md`](./OPERATOR.md) — 運営向けアーキテクチャと実装ロードマップ
