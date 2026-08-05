# 主張と、それを反証できる実験

> このトラックは Advanced Cryptography Program 2026 の非公式・独立した companion です。講座および
> その運営者とは提携しておらず、承認も受けていません。問題文、コード、fixture、図はすべて独自に
> 作成しています。このトラックに関する質問は講座運営ではなく TenkaCloud リポジトリへお願いします。

**Track:** `advanced-cryptography-2026` · **Order:** 720 · **Chapter:** Week 7 / Capstone Build
· **Role:** `synthesis` · **想定時間:** 180〜360 分 · **配点:** 300
· **前提:** `ac26-w7-capstone-design`

## ストーリー

Week 7 の設計問題は選定で終わりました。これはその実装です。

複数の party がそれぞれ数を 1 つ持っていて、和が欲しい。誰も自分の数を他人に渡さない。protocol を
実装し、そのうえで **それが主張どおりのことをして、それ以上はしていない証拠** を出します。

protocol 自体は短いほうです。加法的 share を配る 1 ラウンドと、部分和を開く 1 ラウンド。作業の大半
は、計算ではなく **提示** を求める 4 つの checkpoint にあります。

## randomness の契約

`run` は randomness を明示的な tuple で受け取ります。`random` は呼びません。

これは作法ではなく、privacy を測れるようにするためです。randomness が固定長で有限なら、toy field
の確率空間を全数え上げして、同じ和を持つ 2 つの入力で coalition の見え方を比較できます。`random`
の呼び出しは数え上げられず、数え上げられない privacy の主張は、主張したというだけのものです。

```text
randomness は setting.randomness_length 個、各要素は [0, modulus)
party i は randomness[setting.slice_for(i)] を引く -- ちょうど parties - 1 個
それが最初の parties - 1 個の share。最後の 1 個は、自分の入力に足し戻る値
```

## 採点を決める 3 つのこと

**正しい答えは、正しい protocol の証拠ではありません。** この問題の mutation のうち半分近くは、和を
正しく返します。`transcript` checkpoint が訊くのはそこです。公開された値は、その party が実際に受け
取ったものの和になっているか。公開値の総和は、報告された出力と一致するか。この 2 つを見ないと、
「出力だけ正しく返して transcript は別の run を記述している」実装が通ります。

**1 つの coalition は、全部の coalition ではありません。** randomness を一切引かない protocol を考え
ます。各 party の share は `[0, …, 0, x]` になり、最後の 1 人が全員の入力を平文で受け取ります。一方
party 0 から見れば受信は全部 0 で、公開値も 2 つの世界で同じ。**party 0 に対しては完全に private
です。** 1 つの coalition しか調べない実験は、これを private だと報告します。だから掃きます。

**閾値は欠陥ではありません。** `parties - 1` 人が結託すると残り 1 人の入力が出ます。和から自分たち
の入力を引けば、残るのは 1 人分だけだからです。和を計算するどんな protocol もこれより良くはできま
せん。defect list ではなく scope に書くものです。

## Participant Portal での進め方

1. Participant Portal で問題を起動する。同じ画面に問題エディタが表示される。
2. **証拠を調べる**で、この deploy 固有の fixture と公開された証拠を読む。
3. Portal のエディタで starter のソースを編集する。
4. **公開テストを実行**を押し、直接回答欄があれば証拠から埋める。
5. 各 checkpoint をそのまま提出する。Portal が現在のファイルと回答を準備して送る。

checkout、ターミナル、ローカルエディタ、別画面、コピペは不要です。code checkpoint は現在の
エディタ内容を使います。直接回答は現在の deploy seed へ結び付くため、別 deploy からコピーした
値は拒否されます。

## 採点

8 つの checkpoint を独立に採点します。誤答は 1 回 15 点です。

| Checkpoint | 配点 | 何を見るか |
|---|---:|---|
| `scope` | 30 | 2 つを主張し、2 つを非目標とし、閾値を書く |
| `correctness` | 30 | 見せていない party 数・法・入力で和が出る |
| `transcript` | 40 | 公開値が受信の和と一致し、出力へ再構成される |
| `privacy` | 55 | 確率空間を全数え上げし、閾値未満の全 coalition を掃く |
| `threshold` | 40 | 閾値で復元でき、それ未満では何も主張しない |
| `detect` | 55 | 自分の suite が、見たことのない 9 種の壊れた protocol を捕まえる |
| `measure` | 25 | 実 transcript から数え、単位と環境をつける |
| `evidence` | 25 | 各主張に実行済み実験を対応づけ、非目標も省略しない |

ヒントは 8 つ中 5 つにあり、いずれもその checkpoint の 50% 上限に収まっています。

## `detect` が採点するのは protocol ではなく test suite

自分の protocol を渡されたら `False`、見たことのない 9 種の壊れた protocol を渡されたら全部 `True`
を返す必要があります。既知の悪い例を並べた関数では通りません。

壊れ方は 3 系統あり、1 つの検査では 3 つとも捕まりません。

| 系統 | 例 |
|---|---|
| 出力が違う | 和が 1 ずれている |
| 出力は合っていて transcript が漏らす | honest な party の生 share が公開される |
| 両方まともに見えて transcript が run と食い違う | 公開値が出力へ再構成されない |

3 番目を落とすのがいちばん多いです。

## toy であることの断り

法は数え上げられる程度に小さく、つまり安全には遠く足りません。observability とのトレードです。
protocol は semi-honest 前提でもあり、自分の入力について嘘をつく party は検出されず、黙る party が
いれば run は終わりません。どちらも `scope` の非目標であり、主張すればその checkpoint が落ちます。

## 保証範囲

ローカルモードは **自習向けの honor-system verification** です。マシンも Docker daemon も
image もあなたのものなので、image の中に隠れているものはありません。`reference/` と
`tests/hidden/` を bind-mount しないのは、git checkout に紛れ込ませないためであって、
手が届かないようにするためではありません。

verifier が実際に保証するのは、もっと狭く、そして本物です。提出物が verifier を停止させたり
落としたりできないこと、checkpoint が echo した id 以外を加点できないこと、応答が期待値を
漏らさないこと、fixture がこのデプロイの seed 由来なので暗記した答えが通用しないこと。

自習と誠実な練習はこれで支えられます。しかし**競技順位・試験・修了判定は**支えません****。
それには participant が管理しない verifier が要り、
[#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271) で追跡しています。

## コスト

ゼロ。クラウドアカウントも AWS リソースも不要です。

## 作問者向け

`make reference-test` が mutation suite を実行します。壊した capstone 19 種と verifier の欠陥 2 種、
すべて kill されます。

mutation を 2 つ、baseline に足さずに削除しました。どちらも実際に試したうえでの判断です。

- privacy 実験を coalition `(0,)` だけに狭めるもの。**正しい** protocol に対してはどの coalition
  でも判定が同じなので、区別できるテストが書けません。この地面を守っているのは、hidden test が
  submission の実験を信用せず自前で掃くことと、`detect` が party 2 にだけ漏らす protocol を渡すこと
  です。
- 引いた share の `% modulus` を落とすもの。randomness の契約が全要素を範囲内に固定しているので、
  この問題が生成しうるどの入力でも no-op です。kill するには starter が述べていない堅牢性要件を
  でっち上げることになります。

「全 coalition を掃く」という要件自体が、この問題を作る過程で出てきたものです。初期版の privacy 実験
は party 0 しか見ておらず、壊れた protocol が 3 種通り抜けました。うち 1 つは全入力を最後の party へ
平文で渡します。

base image と verifier bind の修正は `ac26-w7-capstone-design` の README に書いたとおりで、この問題
にも入っています。他の AC26 問題にはまだ入っていません。
