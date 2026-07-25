# 同じ R が二度出たら、それは鍵である

> このトラックは Advanced Cryptography Program 2026 の非公式・独立した companion です。講座および
> その運営者とは提携しておらず、承認も受けていません。問題文、コード、fixture、図はすべて独自に
> 作成しています。このトラックに関する質問は講座運営ではなく TenkaCloud リポジトリへお願いします。

**Track:** `advanced-cryptography-2026` · **Order:** 340 · **Chapter:** Week 3 / Nonce Reuse and
Special Soundness · **Role:** `transfer` · **想定時間:** 60〜90 分 · **配点:** 300
· **必須前提:** `ac26-w3-schnorr`

## ストーリー

署名サービスが audit log を残していました。1 署名につき、message、public key、commitment `R`、
response `z`。秘密鍵はありません。それが log というものです。

どこかで、1 人の signer が同じ commitment を二度使っています。

```text
z1 = k + e1*x
z2 = k + e2*x
```

方程式が 2 本、未知数が 2 つ。片方はもう手元にあります。

## これは乱数の話ではありません

nonce 再利用は「弱い乱数生成器は危険」として語られることが多いです。それは症状であって、理由では
ありません。

理由は **special soundness** です。commitment を共有し challenge が異なる 2 本の受理 transcript
から witness が抽出できる。これは Sigma protocol が proof of knowledge であることの定義そのもの
であり、「証明者は本当に `x` を知っている」を保証している当の性質です。抽出器が存在するから健全で
あり、抽出器が存在するから再利用が致命的になります。1 つの事実の 2 つの帰結です。

## R の共有は必要条件であって十分条件ではありません

log にはわざと noise を入れてあります。

- **malformed な行**。入力を信じる parser は最初の 1 行で死にます。
- **きれいに parse できて検証を通らない行**。拒否される transcript の中の再利用は何も証明しません。
- **同じ R を使った別の signer の行**。鍵が違えば 2 本の式は 1 つの未知数についての式ではなく、
  攻撃すると誰のものでもない scalar が出ます。

だから復元は必ず `P = xG` で確認します。算術は間違った組に対しても成功します。

`e1 = e2` のとき逆元が無いのは、同じ challenge への 2 回の応答が同じ式を 2 回書いただけだからです。

## 遊び方

```bash
make inspect            # log と、重複した commitment
make test               # 公開テスト
make reset              # starter/recover.py を元に戻す
```

編集するのは `local/starter/recover.py` の 1 ファイルです。

## 採点

8 つの checkpoint を独立に採点します。誤答は 1 回 15 点減点です。

| Checkpoint | 配点 | 何を検査するか |
|---|---:|---|
| `parse` | 30 | 正当な行を読み、malformed な行を明示的に拒否する |
| `detect` | 35 | 同一 signer かつ両方が検証を通る組だけを挙げる |
| `extract` | 50 | 鍵の復元と、transcript の順序への非依存 |
| `confirm` | 30 | 公開鍵での確認。誤った scalar を確認しない |
| `reject` | 40 | `e1 = e2`、別 signer、再利用の無い log |
| `hunt` | 40 | noise を含む log からの復元と、誰の鍵かの特定 |
| `collision` | 40 | 切り詰めた生成器の実測と、値域との突き合わせ |
| `repair` | 35 | 衝突してはいけないものが衝突しない生成器 |

hint は 8 つ中 5 つにあり、いずれもその checkpoint の 50% 上限内です。

## 3 つの nonce generator

| 生成器 | log 上の見た目 | 実際 |
|---|---|---|
| `fixed_nonce` | 明らかにおかしい | 即死 |
| `truncated_nonce` | **完全にランダム** | birthday bound で衝突 |
| `deterministic_nonce` | 名前が不安 | これが安全 |

`truncated_nonce` が面白いところです。どの `k` も違って見え、すべての署名が検証を通り、目で見て
おかしいところがありません。**ランダムに見えることは entropy があることではありません。**

`deterministic_nonce` は名前が最も不安に見えて、正しいものです。同じ鍵と同じ message は同じ nonce
を生みますが、それは同じ署名を生むだけで新しい情報は漏れません。異なる message はハッシュ衝突なしに
衝突しません。鍵もハッシュに入れるのは、入れないと 2 人の signer が同じ message で同じ nonce を使う
からです。

## 群位数と、書けないテスト

repair checkpoint は **secp256k1** で回します。これは偶然ではありません。toy 群は scalar が 50 個
未満しかなく、60 通の message に相異なる nonce を割り当てることが鳩の巣原理で不可能です。40 元の群に
安全な nonce 生成器は存在しません。群が小さいこと自体が脆弱性です。不可能なことを assert するテストは、
テストの失敗ではなく設計の失敗です。

truncation も「60 サンプルが全部相異なるか」では捕まりません。16 bit でも 60 draws が全部相異なる
確率は約 97% で、大半の実行をすり抜けます。**値域**が決め手です。256 bit の位数に対して全出力が
2^64 未満に収まる確率は 2^-11000 程度で、これは偶然ではなく証拠です。

## コスト

ゼロです。クラウドアカウントも AWS リソースも使いません。

## 作問者向け

`make reference-test` が mutation suite を実行します。壊した実装 9 種類があります。うち 3 つは、この
問題を書いている最中に hidden test の本物の穴を見つけました。log に非受理の重複が無かったこと、
別 signer の重複が無かったこと、nonce space の検査が値域ではなく相異性だったことです。4 つ目
「確認せずに復元を報告する」は単独では等価変異と分かり、依存する検証と組にして変異させています。
