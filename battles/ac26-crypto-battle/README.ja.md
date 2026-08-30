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
  (非対話型 Schnorr proof) だけで得点する手段。同じ Contract を LEAK で
  完了した場合と全く同じ得点になります。LEAK と違い secret を復元できる
  material は一切公開されません — ただし証明そのもの (proof transcript) は
  監査のために Public Ledger に記録され、誰でも検証を再実行できます。

## 3 つのレーン

- **Contract Queue** — 今まさに自チーム宛に届いている LEAK 依頼の一覧。
  どの share index を要求しているか、得点、期限が示されます。期限内に
  応じないと失効します。
- **My Vault** — 自チームの現行 secret、この世代の全 share、スコア、
  ROTATE クールダウンの残り時間。他チームには一切見えません。
- **Public Ledger** — 全チームがこれまでに LEAK した share と、PROVE した
  proof transcript の全公開履歴。HUNT はここから始まります — 相手チームが
  現行世代のしきい値を超えて share を晒していないか監視してください。
  PROVE のエントリには、secret の復元に使える情報は一切含まれません。

## Order とその条件

参加者向けの表記では、依頼を **Order** と呼びます（Issue #645）。内部の
TypeScript 型は `Contract` のままです — モデルを広げるのと同時に全 reducer test を
書き換えないための意図的な判断です。ただし参加者が読む文面に "Contract" は残って
いません。この語は CloudFormation や smart contract を連想させ、このゲームとは
無関係だからです。

Order は、**task**（依頼内容とその公開ペイロード）、期限、報酬、**privacy
constraint**、そして **その両方を満たす method** を持ちます。

task は 3 種類あり、`tick()` が 4 件周期で確定的に回します（確率ロールではありません
— 短い試合で FHE や MPC に一度も当たらない参加者が出ると、#645 の学習の階段が
成立しないため）。

| task | 依頼内容 | 受け付ける method |
| --- | --- | --- |
| `reveal-share` | この share index を処理せよ | LEAK / PROVE |
| `homomorphic-sum` | この 2 つの暗号文を復号せずに足せ | FHE |
| `masked-total` | 覆面をかけた小計を出せ | MPC |

privacy constraint はそこからさらに絞ります。

| 条件 | 受け付ける method | 依頼主が言っていること |
| --- | --- | --- |
| `none` | LEAK / PROVE | 方法は任せる。 |
| `no-raw-disclosure` | task に応じて PROVE / FHE / MPC | 生の値は公開しないでほしい。 |

`allowedMethods` は「その task を実行できる method」∩「その条件を満たす method」です。
この 2 段構えは意図的で、参加者に返すメッセージが変わります — 「この Order は LEAK を
受け付けません」は**規則**、「LEAK ではこの仕事はできません」は**事実**であり、どちらな
のかを区別できることが #645 のねらいそのものです。

`no-raw-disclosure` はおよそ 4 件に 1 件で、他の Order 属性と同じく match seed から
導出されます（= 決定的、replay 可能）。条件は method を選ぶ**前**に Order カードへ
表示され、LEAK は非表示ではなく理由付きで無効化されます。提出して初めて条件を知る
UI は、カードに書けたことを参加者の時間を使って教えることになるためです。

モデルの土台は `game/src/methods.ts` です。`allowedMethods` は常に条件から導出し、
手書きしません。後から追加した method が、満たせる Order にだけ自動的に現れ、
満たせない Order からは自動的に外れるようにするためです。#645 の後続フェーズで
FHE / MPC がここに加わります。Phase 1 で新しい暗号方式を足していないのは意図的で、
土台の部品を完全に検証できるうちに抽象化が自然かどうかを確かめるためです。

## FHE Order の仕組み（Phase 2）

`game/src/fhe.ts` の加法準同型暗号です。素体 F_p 上で、入力ごとの鍵 `k_i` に対して

```text
Enc_i(m; r) = (r, m + k_i*r mod p)      r != 0   (鍵は入力ごと)
Dec_i(r, y) = y - k_i*r mod p
```

暗号文どうしを成分ごとに足すと、平文の和の暗号文になります。参加者の作業はその
足し算だけで、§12b の算術（足し算・掛け算・余り）の範囲に収まります。

**隠蔽の強さ**: `r != 0` かつ `k` が未知なら、任意の候補平文 `m'` に対して
`k' = (y - m') * r^-1` が存在します。したがって暗号文 1 個は平文について**情報を一切
持ちません** — 計算量的仮定ではなく情報理論的です。

**鍵は入力ごとに別**で、これは本質的です。本 PR の初期版は Order の 2 入力に同じ鍵を
使い、それでも対として完全に隠れていると（「式 2 本、未知数 3 個」という理由で）主張して
いました。これは誤りでした。鍵が共通だと誰でも `r2*y1 - r1*y2 = r2*m1 - r1*m2` を計算でき、
`(m1, m2)` が直線上に絞られます（`p^2` 通りではなく `p` 通り）。漏れるのは値ではなく関係
であり Order の偽造もできませんが、「隠れているように見えて隠れていない」はまさにこの問題が
見抜けるようにしたい対象なので、その構成では出しません。鍵が独立なら同じ量に
`r1*r2*(k1-k2)` が乗るため、何も絞られません。

`fhe.test.ts` は単体ではなく**対としての**主張を実行して確かめ、さらに共有鍵の関係式が
旧構成では成立し現行構成では成立しないことを両方確かめます（弱いテストしか無かったことが、
誤った主張を通してしまった原因です）。

鍵は Order にも束縛されているため、ある Order について後から何を知っても別の Order は
開きません。

**なぜ実用 FHE ライブラリを使わないか**: #645 の non-goals が
「実用 FHE / MPC ライブラリの性能 benchmark を競うこと」を明示的に範囲外としています。
必要なのは「読めないデータに対して計算し、判定は運営が行う」という体験で、BFV/CKKS
依存はメガバイト単位の追加と、この階層では教えるもののない noise 予算という失敗様式と、
参加者が手で確かめられない数値をもたらします。**完全準同型ではありません** — 暗号文
どうしの掛け算はできず、参加者向け文面も「暗号文のまま足す」としか書いていません。

**なぜ嘘の答えを出せないか**: 判定は**両成分**を見ます。まず提出された左成分が Order の
2 入力の左成分の和かを確かめ、次に Order の合成マスクで復号して期待値と比較します
（#645 の判定要件）。期待する和を知っていれば直接出せますが、平文は seed 由来の全域の
体要素なので約 2^61 分の 1 の当てずっぽうになります。それ以外の経路には鍵が要り、
鍵は上記のとおり得られません。

**この節が主張しきれない前提が 1 つあります。** 上の議論はすべて「match の seed が
推測できない」ことを前提にしています。実際には推測できます — `initialState` は
`seed: ctx.eventId` を設定し、`CoordinationContext` には他に何もなく、`eventId` は
参加者のブラウザまで届きます。本リポジトリは公開されているため、ここにある導出は
eventId を知る者なら誰でも再現できます。FHE の平文と鍵も、そして（本 PR より前から）
`deriveTeamGeneration` 経由で全チームの secret もです。修正には platform 側が注入する
match ごとの秘密値が必要で、TenkaCloudChallenge#652（TenkaCloud#3133 待ち）で追跡して
います。それが入るまで、この節の隠蔽に関する主張は**方式についての主張**であって、
実際に動いている match についての主張ではありません。

## MPC Order の仕組み（Phase 3）

`game/src/mpc.ts` の覆面つき加算（secure summation）です。3 拠点が順序対ごとの覆面
`m[i][j]` を共有し、各拠点は

```text
partial[j] = x[j] + Σ(受け取った覆面) - Σ(送った覆面)   mod p
```

を公開します。各覆面はちょうど 2 回（一方の足し算と他方の引き算に 1 回ずつ）現れるため
相殺し、3 つの partial の和は入力の総和になります。

公開される partial は、任意の候補入力と整合します（覆面が一様で未知のため）。つまり
**入力について情報を持ちません**。`mpc.test.ts` はこれも実行して確かめます。

参加者の私的な材料（自分の数と 4 つの覆面）は `projectForTeam` が**その Order の持ち主
にだけ**導出して渡し、state には保存しません。したがって Public Ledger にも他チームの
projection にも構造的に現れません。

スコープは加算のみです。#645 は Beaver 乗算も候補に挙げていますが、「見てはいけない
データを計算する」という考えを運ぶ最小の縦切りは加算で、初見の参加者が追える算術に
収まります。乗算は Order model を変えずに task payload を足すだけで追加できます。

## nonce 再利用 HUNT（Phase 5）

#645 の HUNT の原則は「正しく使った暗号を破らせるゲームにはしない。誤用を見抜かせる」
です。nonce 再利用 HUNT はまさにその形をしています。

同じ世代の proof transcript が 2 つ、同じ commitment `R` を持っていれば、1 つの nonce が
2 つの challenge に答えたということで、witness が解けます。

```text
z1 = k + e1*w,  z2 = k + e2*w   ->   w = (z1 - z2) / (e1 - e2)   mod q
```

攻撃側は Public Ledger だけからこれを導出し（`buildNonceReuseHuntOp` は他を読みません）、
判定側は対象チームの公開 commitment に対して `g^w == Y` を検査します。

**人間にも同じことができなければ意味がなく、当初はできませんでした。** 各 `e` は
`H(domain, teamId, contractId, generation, R, Y)` で決まりますが、この 6 つのうち 2 つが
参加者の画面のどこにも出ていませんでした — ledger の行は依頼 ID を落としており、`Y` は
そもそもどこにも描画されていません。数式は書いてあるのに値が無い状態で、実装はできても
プレイはできませんでした。現在は ledger に「依頼」列を追加し、Status パネルに全チームの
`Y` を表示し、本文に「どの値がどの列にあるか」を明記しています。守るのは
`hunt-playability.test.ts` です — 描画済み HTML から 5 つの値を読み取り、Help Drawer が
公開している規則から challenge を計算し直し（実装を import せず公開テキストから再実装して
いるので、**文書と実装の乖離も検出します**）、`w` を解いて提出します。
`nonce-reuse.test.ts` は配布コードを呼ぶため、この種の欠落を原理的に検出できません。
§12c が言っているのはこのことです。

このBattleが配っている prover では**起こりません** — `schnorr-prover.ts` は nonce を
contract id に束縛しています。したがって配布された手順どおりに計算したチームは狙われません。
さらに `validateOp` は「再利用が Ledger に載っていること」を受理の条件にしているため、
**他の手段で正しい witness を入手した攻撃者でも、何も間違えていないチームには使えません**。
`nonce-reuse.test.ts` はこの両方を固定しています。

## PROVE の実際の手順

PROVE は LEAK の代替となる雰囲気だけの手段ではなく、実際の暗号プロトコル
です — `ac26-w3-schnorr` で学ぶのと同じ、非対話型 **Schnorr 知識証明**
です。ある Contract を PROVE で完了するには、次の 3 ステップを踏みます。

1. **witness を導出する。** 自チームの実際の `secret` をそのまま指数として
   使うことはありません — 空間が小さすぎて安全ではないためです
   (理由は `game/src/schnorr-witness.ts` のコメントを参照)。代わりに
   secret とチーム id、現行世代をハッシュして、2048-bit 群 (RFC 3526
   Group 14) 上の witness `w` を導出します。
2. **proof を組み立てる。** `w` から、完了しようとしている特定の Contract
   に紐づいた Schnorr commitment / response のペアを構築します —
   `game/src/schnorr-prover.ts` の `createProof(secret, generation, teamId,
   contractId)` がこれを決定的に (ランダム性を一切使わずに) 行います。
3. **提出する。** 自チーム宛の open な Contract に対して有効な proof を
   提出すると、その Contract を LEAK で完了した場合と全く同じ得点が入り
   ます。proof transcript は Public Ledger に記録され誰でも独立に再検証
   できますが、transcript 単体からは secret や share を復元するための
   情報は一切得られません。

proof は特定の Contract id に紐づいているため、別の Contract への
使い回しはできません。また witness は ROTATE のたびに変わるため、
ROTATE 前に作った proof は ROTATE 後には検証を通りません。

## スコアリング、一言で

LEAK と PROVE は同じ Contract を完了した場合、全く同じ得点になります —
PROVE だからといって難しい分だけ多く得点することはありません。HUNT は
検証済みの正しい復元でのみ得点、ROTATE はクールダウンというコストを払う
代わりに、それ以前に漏洩した全 share を遡って無価値にします。「LEAK で
今すぐ稼ぐ」「PROVE で安全に稼ぐ」「ROTATE で安全を確保する」の間の
テンポを読みながら Public Ledger で相手の隙を監視し続けたチームが
勝ちます。

## 学習目的

- Shamir (t, n) しきい値秘密分散と Lagrange 補間を、攻撃 (HUNT) と防御
  (ROTATE) の両面から実際に使う。
- share を公開 (LEAK) するコストが即時ではなく将来の HUNT リスクとして
  発生することを理解する。
- しきい値未満の share が秘密について何も語らないことを実行可能な形で
  確認する。
- secret rotation が過去に漏洩した share を無効化する仕組みを体験する。
- 非対話型 Schnorr 知識証明 (PROVE) を実際に構築・検証し、それが特定の
  Contract と特定の secret generation に Fiat–Shamir で紐づけられている
  理由を体感する。

## Portal の使い方

デプロイ後、Participant Portal では 3 つの panel からこの Battle を操作します。

- **Status** — スコア / 残り時間 / フェーズのヘッダに続けて、上記の 3 レーン
  (Contract Queue / My Vault / Public Ledger) を 30 秒ごとに更新表示します。
  Public Ledger に表示されるのは生データのみです — LEAK なら teamId / 世代 /
  share index / 値、PROVE なら commitment / response の transcript — 「今
  復元可能」といった判定結果を計算して見せることはありません。判断は
  あなた自身が行います。
- **Submit a move** — 操作ごとに 1 つずつ form があります。
  - **LEAK** は自チームの open な contract を一覧から選ぶだけです。
  - **PROVE** には `{ commitment, response }` の proof、**HUNT** には
    復元した secret が必要です。どちらも **form を開く前にローカルで
    作成してください** — `game/src/schnorr-prover.ts` の `createProof` と
    `game/src/shamir.ts` の `reconstruct` がその計算の参照実装です
    (PROVE の手順は上記「PROVE の実際の手順」を参照)。この portal が
    代わりに計算することはありません — そのローカル計算自体が各操作の
    本来のコストであり、UI が省略してよい作業ではありません。
  - **ROTATE** は実行前に確認を求めます。実行すると自チーム宛の open な
    contract がすべて無効化されるためです。
  - 却下された送信には理由が表示されます (例: 「contract は既に
    completed」「proof が検証に失敗」)。これは基盤側の一時的な不調とは
    別物で、その場合は代わりに再試行を促す一般的なメッセージが表示されます。
- **Help** — 上記のルールを 1 画面に凝縮した、試合中にすぐ参照できる
  早見表です。

## 試合後: replay と debrief

試合は時間切れで終わっても、そこで記録が終わるわけではありません。あなたの
チームが行った LEAK・PROVE・HUNT 成功・ROTATE はすべて、実際の時刻付きで
時系列に残ります — debrief の時間にファシリテーターがこの記録を辿りながら、
「このどの LEAK が最終的に threshold を超えて secret を復元可能にしたか」
「ROTATE によって実際に何枚の leak 済み share が無効化されたか」を具体的に
指し示すことができます。この replay は試合中に実際に起きたことだけから
構築されます — 起きていないことを見せることはなく、あなたのチームが自ら
leak していない secret や share を明かすこともありません。これは debrief
専用のツールであり、試合中に Portal 上で見えるものではありません。事後に
生成されるものです。

## 関連ファイル

- [`metadata.json`](./metadata.json) — 問題メタデータ (UI / scoring engine の
  正本)
- [`template.yaml`](./template.yaml) — 競技者アカウントにデプロイされる
  1 ページ CFn テンプレート (参加者アクセスの baseline のみ — なぜ試合状態が
  チームごとの AWS インフラではないかは `OPERATOR.md` を参照)
- [`game/`](./game/) — この Battle が動く pure game model (state / reducer /
  Shamir 実装)
- [`OPERATOR.md`](./OPERATOR.md) — 運営向けアーキテクチャと実装ロードマップ
