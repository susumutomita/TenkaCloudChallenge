# 先に聞かれたら、何でも通せる

証明系の骨格は commit・challenge・open の 3 手とその順序。順序が逆なら prover は聞かれる場所だけ正しくしておける。Merkle commitment で順序と binding を実験する。

Week 4 の 2 問目。 Week 4 の教材は pinned commit 時点で未公開のため、 公開されている主題だけを手がかりにした bridge 問題で、 role は GOVERNANCE.md §6 が許す transfer。

主題は 3 手の順序 (commit → challenge → open) と、 その順序が意味を持つために commitment へ何が binding されていなければならないか。 **polynomial commitment ではない**し、 1 箇所の開示は聞かれなかった行について何も言わない。 writeup で明記している。

Merkle 木を使うが、 木そのものは道具であって主題ではない。 主題は 3 つ。

1. **順序**。 challenge を先に知った prover は、 聞かれる場所以外に何を入れてもよい。 adaptive checkpoint でこの vector を構成させる。
2. **葉の binding**。 index が入っていなければ、 葉はどこから来たことにもできる。 区切りが無ければ (1, 23) と (12, 3) が同じ葉になる。 弱い符号化は fixtures 側に固定してあり、 participant 自身の弱いコードを攻める答えは成立しない。
3. **path の方向**。 各段で兄弟が左か右かが決まっていなければ、 verifier は 2 通りに hash でき、 prover は都合のよい方を選べる。

**等価変異について**: verify_opening の index 範囲検査と path 長検査は、 domain tag (LEAF_TAG / NODE_TAG) が既に葉と内部節点の取り違えを防いでいるため、 外しても検出できない。 mutation suite には入れていない。 代わりに Session.receive_challenge の範囲検査を変異させている — こちらは負の index が黙って巻き戻り、 聞かれていない行が開示されるので実際に検出できる。 検出できない変異を一覧に残すと、 suite 全体が無視されるようになる。

query は 1 回なので、 当てずっぽうの prover は 1/length で勝つ。 これは健全性の増幅を扱っていないためで、 writeup に書いてある。

## ブラウザでの進め方

1. Participant Portal で問題を起動し、**Browser Workbench** を開く。
2. `inspect` で deploy 固有の fixture と公開された証拠を読む。
3. 画面内の starter を編集し、`test` で公開テストを実行する。
4. 表示された直接回答欄を、inspect と実験結果から埋める。
5. `prepare` で全 checkpoint の提出値を作り、Portal へ貼る。

直接回答は `prepare` により現在の deploy seed へ結び付けられます。

## 学習目標

- commitment・challenge・opening を区別できる
- commitment の後に challenge が選ばれる必要性を反例で示せる
- Merkle root と authentication path から開示を検証できる
- index・値・方向を commitment へ binding できる
- binding と hiding が異なる性質であることを説明できる
- challenge の transcript に何を binding すべきかを述べられる
- 1 箇所の開示が他の行について何も言わないことを説明できる

## Checkpoint

| Checkpoint | 内容 | Points |
| --- | --- | ---: |
| `encoding` | 葉の符号化を一意にする | 35 |
| `root` | commitment を作る | 30 |
| `opening` | 一箇所だけ開示して検証する | 45 |
| `order` | 順序を強制する | 40 |
| `adaptive` | challenge が先に来たら何ができるか示す | 45 |
| `ambiguity` | 符号化の曖昧さを反例で示す | 40 |
| `transcript` | challenge を transcript から導く | 35 |
| `transfer` | 見たことのない設定でも成立させる | 30 |

## 解説

## 順序が protocol である

commitment は 「あとから変えられない」 と言っているだけで、 それ自体は何も証明しない。 意味を与えるのは、 challenge が commitment の**あと**に来ることだ。 逆なら prover は聞かれる場所だけ正しくして、 残りを好きにできる。 adaptive checkpoint で作る vector は 16 要素中 15 要素が嘘で、 それでも開示は検証を通る。

## 葉に何が入っていなければならないか

**index**。 入っていなければ、 葉は 「どこから来たか」 を主張していない。 prover は同じ葉を都合のよい位置から来たことにできる。

**区切り**。 index と value を区切り無しで並べると、 (1, 23) と (12, 3) がどちらも "123" になる。 異なる 2 つの主張に 1 つの commitment が対応する。 弱い符号化は fixtures 側に固定してある。 自分で書いた弱いコードを自分で破るのは反例ではない。

**方向**。 path の各段で兄弟が左か右かが決まっていなければ、 verifier は (sibling, node) と (node, sibling) のどちらでも hash でき、 prover は root に合う方を選べる。

## 等価変異の話

verify_opening の index 範囲検査と path 長検査は、 外しても検出できない。 LEAF_TAG と NODE_TAG があるので葉のハッシュと節点のハッシュが一致することはなく、 長さの違う path は root と異なる値に再計算されて比較で落ちるからだ。 したがって mutation suite に入れていない。

代わりに Session.receive_challenge の範囲検査を変異させている。 こちらは負の index が黙って巻き戻り、 聞かれていない行が開示されるので、 実際に検出できる。

検出できない変異を一覧に残すと、 「survived は無視してよい」 を教えることになる。 だから残さない。

## これは polynomial commitment ではない

Merkle root は列に commit する。 多項式の評価を証明するものではない。 また 1 箇所の開示は、 聞かれなかった行について何も言わない。 query が 1 回だけなので、 当てずっぽうの prover は 1/length で勝つ。 健全性の増幅 (複数 query など) はここでは扱っていない。

## binding と hiding は別

Merkle root は binding を与えるが、 hiding は自動では付かない。 値の空間が小さければ root から中身を総当たりできる。 隠したければ、 各葉に別途 randomness を入れる必要がある。

## 作問・検証

参加者は checkout を必要としません。リポジトリ保守者向けの検証手順は Makefile と CI を正とします。
