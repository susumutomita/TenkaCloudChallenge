# 同じ数を、別の鍵の言葉で言う

> このトラックは Advanced Cryptography Program 2026 の非公式・独立コンパニオンです。
> コース運営とは無関係で、承認も受けていません。問題文・コード・fixture・図はすべて独立に書いています。
> このトラックへの質問はコース運営ではなく TenkaCloud リポジトリへお願いします。

**Track:** `advanced-cryptography-2026` · **Order:** 550 · **Chapter:** Week 5 / Sample
Extraction and Key Switching · **Role:** `mechanism` · **想定時間:** 75〜105 分 ·
**配点:** 300 · **前提:** `ac26-w5-cmux-blind-rotation` · **Status:** draft

## 物語

blind rotation は RLWE 暗号文を残します。使えるようになるまでにあと 2 つ。
係数 1 つを LWE sample として取り出すことと、その sample を別の鍵・別の次元へ移すこと。
**中身を変えずに**。

その手前を作り直すわけではありません。`participant.fhe` が環・RLWE・RGSW・
external product・CMUX・回転ループをすべて正しい形で提供します。扱う accumulator は
本物の blind rotation の出力で、それが持つ noise もそのまま乗っています。

## extraction

phase 多項式は `b - a*s` です。その係数 `k` は、環の secret の係数を並べた vector に対する
LWE phase として書き直せます。

```text
phase_k = b_k - sum_j c_j * s_j
```

`(a*s)_k` には、添字が**環の中で** `k` に集まる積 `a_i * s_j` が集まります。そして環は
negacyclic なので、そのうちいくつかは符号が反転して届きます。どれが、なぜ反転するのかが
この checkpoint の全部です。復号は起きず noise も増えません。取り出した phase は
係数**そのもの**です。

そして取り出した sample の secret は `(s_0, ..., s_(N-1))`、環の secret を vector として
読んだもので、次元は `degree` です。これはシステムの他の部分が使う鍵ではありません。
だから後半があります。

## key switching

switching key は old index `j` と level `l` ごとに次を持ちます。

```text
ksk[j][l] = LWE_(s_new)( B^(L-1-l) * s_old[j] )
```

old の mask を分解して対応する entry を引くと、phase から `<mask, s_old>` がちょうど消えます。
分解の規約は `ac26-w5-rgsw-external` のままです。桁は大きい重みが先頭 (MSB 先頭)、
gadget は `(B^(L-1), ..., B, 1)` の降順 — 講義スライド 30 の並びです。

**どちらの端の secret も渡りません。** 環の secret も、source key も、target key も。
それでも phase は通ります。key switching が復号して再暗号化する操作に見えるなら、
この導出のどこで何かが復号されているかを探してください。

## 最後の係数は例外的に易しい

mask のスロットが巻き戻るのは、その secret の添字が取り出す index より**上**のときです。
`degree - 1` では上にスロットが 1 つも無いので、巻き戻りが起きません。符号を完全に無視した
実装でも、そこでは、そこでだけ phase が一致します。index 0 はその逆で、1 つを除く全スロットが
巻き戻ります。

public test は 4 つとも最後の係数を使っています。意図的で、そう書いてあります。
hidden test は全 index を回し、しかも extraction を mask ではなく phase で採点するので、
数を保つならば vector の作り方は自由です。

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

8 つの checkpoint を独立に採点します。誤答は 1 回 15 点。

| Checkpoint | 配点 | 検査内容 |
|---|---:|---|
| `phase` | 30 | `b - a*s` の全係数。accumulator と新規暗号文の両方、index 範囲の拒否 |
| `extract` | 50 | **全 index** で phase を保存、mask は secret の係数ごとに 1 スロット、body は `b` 由来、結果は既約 |
| `trace` | 35 | スロットごとに 1 レコード、値が mask そのもの、wrap の境界が index に一致 |
| `decompose` | 25 | 係数ごとに 1 タプル、MSB 先頭、ちょうど `levels` 個、桁は `[0, base)` |
| `switch` | 55 | 全 index で target key の下に message が残る、両方向の交差、不整合な鍵の拒否、鍵 ID を名乗り secret を持ち出さない |
| `domains` | 35 | source・target・次元、整合 1 件と不整合 2 件の区別、noise の bound |
| `endtoend` | 40 | RLWE 係数・extracted・switched の 3 つが一致し、switch が実際に動かしている |
| `transfer` | 30 | 見たことのない degree・次元・base・modulus で上記すべて |

8 つのうち 7 つに hint があり、いずれもその checkpoint の 50% 上限の内側です。

## switch の検査を交差させる理由

`decompose_mask` の digit の順序**と** `key_switch` の読み順を両方逆にすると、
自分の分解を自分の switch に通すテストはすべて通ります。そこで hidden test は交差させます。
fixture の sample をあなたの switch へ、あなたの sample を fixture の switch へ。

## `compatible` を metadata から決めるのは手抜きではない

どちらの secret も手元に無いので、switch を試して復号できるかで判定することはできません。
できたとしても、それは secret を最も置いてはならない場所に置くということです。
noise を測定値ではなく bound で報告するのも同じ理由で、測るには phase が要り、
phase には鍵が要ります。

## 構造的に起こりえない leak

ここで artifact を作る関数 — `extract_sample`、`extract_trace`、`key_switch`、
`domain_report` — はどれも、どちらの端の secret も渡されません。鍵が渡るのは
`phase_coefficient` だけで、それは整数を 1 つ返します。つまり
「生の secret が暗号文の metadata に入った」はこの問題が持ちうる欠陥ではありません。
取り繕わずに書いておくと、**mutation の候補が 1 つ、書けないという理由で外れました**。
hidden suite は返された artifact をどちらの secret についても走査し続けるので、
将来 secret を通す作者が出ればそこで分かります。

もう 1 つは equivalent として外しました。switch の内側で桁 0 を飛ばしても何も変わりません。
entry を 0 個引くのは reference が既にやっていることです。

## 対象外

production の switching key 生成、圧縮された switching key、noise-security パラメータ解析、
multi-key や proxy re-encryption。

## これは安全ではない

パラメータは全列挙できる大きさで、両方の secret は線形代数で復元できます。
機構の toy であって、困難性の toy ではありません。

## 出典との対応

Week 5 の教材は公開済みなので、 `courseAlignment` は `week5/README.md` を `lecture`、
`week5/problems/tfhe-toy-python/README.md` を `assignment` として pin しています。
`spoilerPolicy` は `independent-reimplementation` で、 API・パラメータ生成・記述は独自であり、
公式課題から関数名も fixture も skeleton も取っていません。

## 保証範囲

ローカル実行は**自習用の honor-system 検証**です。マシンも Docker デーモンも
あなたの管理下にあるので、 あなたが build したものはあなたに対して秘匿されていません。
`reference/` と `tests/hidden/` を bind-mount しないのは、あなたの git checkout に
紛れ込ませないためであって、手が届かなくするためではありません。

そのうえでデプロイが行うのは、事故で手渡さないことです。 container は 2 つです。
あなたが話す Workbench は starter、 public test、 供給される TFHE 一式である
`participant/fhe.py`、 `show.py` を持ちます。 採点側の image は `fixtures/`、
`tests/hidden/`、 verifier を持ち、 ポートを一切公開せず、 gateway のない Docker network に
置かれます。 `show.py` は、 このデプロイのパラメータ・抽出 trace・鍵切り替え後の sample を
verifier の `GET /public` から読みます。 そこが返すのは実演であって checkpoint の期待値では
ありません。 `fixtures/generate.py` はそれらを導出するために `phase_coefficient`、
`extract_sample`、 `extract_trace`、 `decompose_mask`、 `key_switch`、 `domain_report` を
実装する必要があります。 これは `starter/extract.py` が書かせる名前のすべてなので、
あなたが実行する image には入りません
（[#543](https://github.com/susumutomita/TenkaCloudChallenge/issues/543)）。

verifier が実際に保証するのはもっと狭く、そして本物です。提出コードは verifier を
ハングさせたりクラッシュさせたりできません。 checkpoint は echo した id しか加点できません。
結果は期待値を漏らしません。 fixture はこのデプロイの seed 由来なので、暗記した答えは持ち越せません。

これは自習と誠実な練習を支えます。競技順位・試験・修了判定は**支えません**。
それらには participant が管理しない verifier が必要で、
[#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271) で追跡しています。

## コスト

ゼロ。クラウドアカウントも AWS リソースも不要です。

## 作問者向け

`make reference-test` が mutation suite を走らせます。29 個の壊れた実装のうち 1 つは
最後の係数でだけ正しく、それ以外で間違っています。この問題が捕まえるために作られている形です。
