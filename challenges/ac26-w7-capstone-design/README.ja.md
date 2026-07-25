# 道具から決めない

> このトラックは Advanced Cryptography Program 2026 の非公式・独立した companion です。講座および
> その運営者とは提携しておらず、承認も受けていません。問題文、コード、fixture、図はすべて独自に
> 作成しています。このトラックに関する質問は講座運営ではなく TenkaCloud リポジトリへお願いします。

**Track:** `advanced-cryptography-2026` · **Order:** 710 · **Chapter:** Week 7 / Capstone Design
· **Role:** `synthesis` · **想定時間:** 120〜180 分 · **配点:** 300

## ストーリー

brief が 1 つ渡されます。actor、asset、誰が何を知ってよくて誰が知ってはいけないか、誰が自分で計算
していない値を信じるのか、締切の条件が書いてあります。

primitive の名前は 1 つも書いてありません。

それがこの問題です。「ZK にするか MPC にするか」から設計を始めれば、その質問には答えが出ます。出た
答えが問題に合っているかどうかは別の話で、たいていは手遅れになってから訊かれます。

## 何を書くか

設計を、コードとして書きます。`local/starter/design.py` の 8 つの関数は、いずれも目の前の brief から
答えを導きます。

```text
classify_assets       誰の何で、どこまで隠すのか
required_properties   6 つの性質のうち、この brief が実際に要求するもの
compare_alternatives  選択肢すべて -- 使わない場合も含めて
select_primitive      brief が必要とした分だけ
architecture          typed data-flow graph: 何がどの境界を、どの形で越えるか
attack_plan           どう壊れるかを、観測できる形で
property_matrix       各性質を担う component と、その根拠
revise                前提が動いた brief に対して、上を全部もう一度
```

設計を散文で書くと検査できません。検査できない設計文書があるから、privacy が「それを提供しない
component」に委ねられたまま完成します。コードで書けば、同じ設計にテストが越えられる境界ができます。

## checkpoint が本当に見ているもの 3 つ

**privacy と zero knowledge は別の欄です。** lender に balance を見せたくない。しかし lender は計算に
参加せず、答えを読むだけです。これは「計算する側から隠す」(privacy) ではなく「自分で計算していない値
を信じてもらう」(soundness) であり、信じてもらう値が隠したい値から導かれているときに初めて zero
knowledge が要ります。soundness だけなら、ただの署名で足ります。

**最小性。** 選んだ組から 1 つ外してみてください。まだ全部の要求を満たしているなら、その 1 つは何も
していません。そして何もしていない primitive は無害ではありません。前提が 1 つ、攻撃面が 1 つ、説明
すべきことが 1 つ増えます。6 つの brief のうち 1 つは、暗号をまったく必要としません。

**`non_goals` は飾りではありません。** FHE は鍵管理を無くしません。復号鍵を持つ誰かがいて、その誰かは
脅威モデルの登場人物のままです。MPC は結託の仮定を無くしません、置き換えるだけです。ZK proof は
public input を隠しません。component に責任を持たせる前に `PRIMITIVES` を見てください。

## 遊び方

```bash
make inspect            # 自分の brief と、前提が 1 つ動いた同じ brief
make test               # public tests
make reset              # starter/design.py を戻す
```

編集するのは `local/starter/design.py` の 1 ファイルだけです。

## 採点

8 つの checkpoint を独立に採点します。誤答は 1 回 15 点です。

| Checkpoint | 配点 | 何を見るか |
|---|---:|---|
| `assets` | 30 | 全 asset を所有者つきで分類し、秘密を public と書かない |
| `requirements` | 45 | brief が要求する性質だけ — それ以上は要求しない |
| `alternatives` | 30 | 非暗号案を含め、選択肢を正直に比較する |
| `selection` | 50 | 被覆・許容・最小、そして不要なら暗号を選ばない |
| `architecture` | 45 | 全 asset が flow に現れ、秘密が平文で届かない |
| `attacks` | 35 | 必要な性質すべてに、観測できる攻撃仮説がある |
| `matrix` | 35 | 各性質を、それを実際に提供する component が担う |
| `revision` | 30 | 見たことのない brief に対して、同じ 4 つの artifact が正しい |

ヒントは 8 つ中 4 つにあり、いずれもその checkpoint の 50% 上限に収まっています。

## 何に対して採点されるか

| 対象 | 件数 | どこにあるか |
|---|---:|---|
| repository にある brief | 6 | `local/fixtures/generate.py` |
| 前提が 1 つ動いた変種 | 18 | その 6 つから導出 |
| seed から生成される brief | 12 | どこにも無い。採点時にだけ存在する |

3 行目があるので `brief["id"]` を鍵にした対応表は通りません。2 行目があるので、導出せずに 1 度決めた
設計は最後の checkpoint で落ちます。どちらも意図的です。

## 正解は 1 つとは限りません

満たす最小の組は一意とは限りません。`delegated-scoring` は MPC でも FHE でも通ります。あなたの選択を
reference と突き合わせる処理はどこにもありません。採点が見るのは、brief の要求を被覆するか、この
brief が用意していない相手を信用していないか、余分なものが無いか、それだけです。

## toy であることの断り

`PRIMITIVES` は教材用の抽象化で、トレードオフが 1 画面に収まるように選んであります。setup 仮定、
malicious / semi-honest の別、回路規模、ciphertext の膨張は落としてあります。production の指針では
なく、実際の運用は異なります。

## コスト

ゼロ。クラウドアカウントも AWS リソースも不要です。

## 作問者向け

`make reference-test` が mutation suite を実行します。壊した設計 17 種と verifier の欠陥 2 種で、
いずれも完全でもっともらしい設計を返します。設計問題では誤答が空にならないので、そこが要点です。

執筆中に 2 件の欠陥が出ました。どちらもコードを読んで見つけたのではなく、生成 brief に対して hidden
test を走らせて出たものです。計算する component 自身が所有する input に辺が 1 本も出ず、asset が flow
から消えていた件。そして非暗号案が許容されるために operator **役割** を持つ actor を要求していたため、
1 者が自分のデータを自分で計算するだけの brief が「信用できない」と判定され、ZK proof で答えられて
いた件です。

mutation を 1 つ、baseline に足さずに削除しました。選択肢が 6 つでは greedy cover の prune が到達不能
で、reference と区別できるテストが書けなかったためです。代わりに選定を厳密な最小被覆探索にしました。
修復ではなく構成によって最小になるので、この mutation は kill できるようになりました。

### コンテナを実際に起動して見つかった 2 件 (どのテストも通る)

どちらも scaffolder の template 由来で、この問題だけでなく **すべての AC26 問題** に影響します。修正が
入っているのはこの問題だけで、他はまだ直っていません。

- **pin されている base image の digest が存在しない。** `sha256:4efa69bf…` は Docker Hub がどの
  platform に対しても 404 を返すため、`make build` が何も走る前に落ちます。CI は Docker を通らず
  `python3` を直接呼ぶので、死んだ pin はすべての検査を通過します。
- **verifier がコンテナ自身の loopback に bind していた。** publish された port はコンテナの bridge
  アドレスへ転送されるので、`HTTPServer(("127.0.0.1", port))` はコンテナ外からの接続を受けません。
  すべての要求が応答なしで閉じられ、どの checkpoint も採点できません。本来効かせたいホスト側の
  loopback 制限は `docker-compose.yml` にあり、こちらは影響を受けません。

後者のほうが教訓的です。テストは `evaluate()` を直接呼び socket を越えないので、CI ではすべての
checkpoint が通っていました。採点ロジックは正しく、そして到達不能でした。「その性質を提供しない
component に property を委ねる」のと同じ形の間違いです。
