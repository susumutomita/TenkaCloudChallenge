# 同じ R が二度出たら、それは鍵である

署名サービスの audit log には message、public key、R、z がある。秘密鍵は無い。同じ R が二度出ている 1 組を見つければ、秘密鍵は連立方程式を解くだけで出る。

Week 3 の 4 問目、 role は transfer。 nonce 再利用を 「乱数の品質の問題」 として覚えるのではなく、 Sigma protocol の special soundness そのものとして扱う。

z1 = k + e1*x と z2 = k + e2*x から k が消え、 x = (z1 - z2) * (e1 - e2)^-1 mod n が出る。 これは protocol を proof of knowledge たらしめている性質と同じもので、 「健全性の根拠」 と 「再利用が致命的である理由」 が同一の事実であることを実装で確認する。

題材は noisy な audit log。 malformed な行、 きれいに parse できるが検証を通らない行、 そして**別の signer が同じ R を使っている行**が入れてある。 R の共有は必要条件であって十分条件ではない — 鍵が違えば解くべき未知数が 1 つではない。

nonce generator は 3 種類。 `fixed_nonce` は即死、 `truncated_nonce` は log 上では完全にランダムに見えて birthday bound で衝突する、 `deterministic_nonce` は名前が最も不安に見えて実際には安全。 「ランダムに見える」 は entropy ではない、 が collision checkpoint の主題。

**群位数の扱い**: repair checkpoint は secp256k1 で回す。 toy 群は scalar が 50 個未満しかなく、 60 通の message に 60 個の異なる nonce を割り当てることが鳩の巣原理で不可能だから。 40 元の群に安全な nonce 生成器は存在せず、 群が小さいこと自体が脆弱性である。 不可能なことを assert する test は書かない。

同様に、 nonce space の truncation は 「60 サンプルが全部相異なるか」 では検出できない (16 bit でも 97% の確率で相異なる)。 検出は値域で行う — 256 bit の位数に対して全出力が 2^64 未満になる確率は事実上ゼロ。

## ブラウザでの進め方

1. Participant Portal で問題を起動し、**Browser Workbench** を開く。
2. `inspect` で deploy 固有の fixture と公開された証拠を読む。
3. 画面内の starter を編集し、`test` で公開テストを実行する。
4. 表示された直接回答欄を、inspect と実験結果から埋める。
5. `prepare` で全 checkpoint の提出値を作り、Portal へ貼る。

直接回答は `prepare` により現在の deploy seed へ結び付けられます。

## 学習目標

- 同じ commitment を持つ 2 本の transcript を log から特定できる
- z1 と z2 の差から秘密鍵を代数的に抽出できる
- e1 - e2 の逆元が必要な理由と、存在しない場合の意味を説明できる
- 復元した鍵を P = xG で確認し、確認なしに主張しない
- R の共有が必要条件であって十分条件でないことを説明できる
- 「ランダムに見える」ことと entropy が別物であることを実験で示せる
- 決定的な nonce 生成が安全である条件を述べられる

## Checkpoint

| Checkpoint | 内容 | Points |
| --- | --- | ---: |
| `parse` | 外から来た log を読む | 30 |
| `detect` | 攻撃できる組だけを挙げる | 35 |
| `extract` | 2 本の式から鍵を解く | 50 |
| `confirm` | 復元した鍵を確認する | 30 |
| `reject` | 解けない組を解けないと言う | 40 |
| `hunt` | noise の中から見つけ出す | 40 |
| `collision` | 見た目のランダムさを測る | 40 |
| `repair` | 生成器を直す | 35 |

## 解説

## これは乱数の話ではない

nonce 再利用は 「弱い乱数生成器を使うと危ない」 として語られることが多い。 それは症状の説明であって、 理由の説明ではない。

理由は special soundness である。 同じ commitment に対して異なる challenge へ 2 回応答すると、 その 2 本の transcript から witness が抽出できる。 これは Sigma protocol が proof of knowledge であることの定義そのもので、 「証明者は本当に x を知っている」 を保証している当の性質だ。 抽出器が存在するから健全であり、 抽出器が存在するから再利用が致命的になる。 同じ 1 つの事実の 2 つの側面である。

## R の共有は十分条件ではない

log には別の signer が同じ R を使っている行が入れてある。 鍵が違えば、 2 本の transcript は 1 つの未知数についての 2 本の式ではない。 攻撃すると 「誰のものでもない scalar」 が出る。 だから復元は必ず P = xG で確認する。 算術は間違った組に対しても成功する。

同様に、 きれいに parse できるが検証を通らない行も入れてある。 拒否される transcript の中の再利用は何も証明しない。

e1 = e2 のときに逆元が存在しないのは、 同じ challenge への 2 回の応答が同じ式を 2 回書いただけだから。 情報が増えていない。

## 3 つの nonce generator

- `fixed_nonce`: 毎回同じ。 即座に死ぬ。
- `truncated_nonce`: 本物のハッシュを取り、 数ビットに切り詰める。 **log 上では完全にランダムに見える**。 どの k も違って見え、 すべての署名が検証を通り、 目視では何もおかしくない。 それでも birthday bound で衝突する。
- `deterministic_nonce`: 秘密鍵と message のハッシュ。 名前が最も不安に見えて、 これが安全なもの。 同じ鍵と同じ message は同じ nonce を生むが、 それは同じ署名を生むだけで新しい情報は漏れない。 異なる message はハッシュ衝突なしには衝突しない。 鍵も入れるのは、 message だけだと 2 人の signer が同じ message で同じ nonce を使ってしまうため。

## 群位数と、書けない test

repair checkpoint は secp256k1 で回す。 toy 群は scalar が 50 個未満しかなく、 60 通の message に相異なる nonce を割り当てることが鳩の巣原理で**不可能**だから。 40 元の群に安全な nonce 生成器は存在しない。 群が小さいこと自体が脆弱性であって、 生成器の欠陥ではない。 不可能なことを assert する test は、 テストの失敗ではなく設計の失敗である。

nonce space の truncation も、 「60 サンプルが全部相異なるか」 では捕まらない。 16 bit でも 60 draws が全部相異なる確率は約 97% で、 大半の実行をすり抜ける。 検出は値域で行う — 256 bit の位数に対して全出力が 2^64 未満に収まる確率は 2^-11000 程度で、 これは偶然ではなく truncation の証拠になる。

## 次につながるところ

Week 4 以降の証明系でも 「同じ commitment に 2 つの challenge」 は繰り返し現れる。 そこでは抽出器は攻撃ではなく安全性証明の道具として出てくるが、 中身は同じ引き算である。

## 作問・検証

参加者は checkout を必要としません。リポジトリ保守者向けの検証手順は Makefile と CI を正とします。
