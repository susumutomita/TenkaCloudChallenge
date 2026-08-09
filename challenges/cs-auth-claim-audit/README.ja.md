# 署名は通った。それは、その要求を通してよいという意味ではない

**Track:** `cs-foundations` · **Order:** 10 · **章:** 1. 信用の境界 · **所要:** 45-75 分 ·
**配点:** 200 · **前提問題:** なし

## 状況

ある API gateway が数か月、本番で動いている。期限切れの token を拒否する。payload を書き換えた
token を拒否する。token が持っていない操作を拒否する。誰からも苦情は出ていない。

先週、ある会社の人間が別の会社の文書を開いた。その要求はログに残っている。gateway は通していた。

あなたに渡されるのは、その gateway の決定ログ、署名鍵、そして `authorize.py` である。

## 署名検証が答えている質問

1 つだけである。

> この bytes 列は、この鍵を持つ者が作ったか。

それだけだ。そこから「だからこの要求を通してよい」へ進む一歩は、検証が言ったことではなく、読んだ人が
足したものである。足した瞬間に、token の**中**に書かれている主張が、token の**外**の事実と照合され
ないまま通る。たとえば、この文書が誰のものか。

監査対象の gateway は、公開テストを通し、本番でも正常な要求を処理している。それでも許可判断は間違い得る。

## この gateway の契約

`authorize.py` が要求される条件は次のとおりである。

- token は、空でない 3 つの base64url セグメントからなり、header と payload は JSON object である。
- 検証方式は gateway 側で HMAC-SHA256 に固定する。検証対象の token に方式を選ばせない。
- `kid` は `keys` の同名の鍵を選ぶ。鍵の切り替え中は、保持しているどちらの鍵で作られた token も正当である。
- 時刻は `nbf <= now < exp` のときだけ有効で、時刻 claim は整数である。
- `action` は `scope` に含まれていなければならない。
- token の `tenant` と、要求対象の `resource["tenant"]` は完全一致しなければならない。
- 読めない入力は例外にせず拒否し、理由は `authorize.py` の docstring にある順序で返す。

決定ログと starter が、この契約のどこまでを本当に確かめているかを監査する。上の一覧は仕様であり、
実装の点検結果ではない。

## 公開テストは starter を通す

これは事故でも、直すべき穴でもない。これが演習そのものである。

公開テストは代表的な正常系と拒否系を見るが、契約にある条件の組み合わせをすべて訊いてはいない。
緑が意味するのは 1 つだけ —
**テストを書いた人が考えた範囲では壊れていない**。

AI に書かせたコードを読むときも、AI に書かせたテストを読むときも、確認するのは同じ一点になる。
このテストは、何を訊いていないか。

## token の形

base64url の 3 セグメントをドットでつなぐ。

```text
<header>.<payload>.<signature>

header   {"alg": "hs256", "kid": "k-417"}
payload  {"sub": "u-3391", "tenant": "t-208",
          "scope": ["read:doc"], "nbf": 1000042, "exp": 1000431}
```

署名は `"<header>.<payload>"` という**その文字列そのもの** — token に現れるとおりの、符号化されたままの
2 セグメントとドット — に対する HMAC-SHA256 で、鍵は `kid` が指す gateway の秘密である。

`nbf` は使えるようになる最初の瞬間、`exp` は使えなくなる瞬間。この 2 つの日本語は同じ比較演算子には
ならず、checkpoint の 1 つはそこを訊いている。

## Participant Portal での進め方

1. Participant Portal で問題を起動する。問題文と同じ画面に問題エディタが出る。
2. 「証拠を調べる」で、この deploy の token・claims・署名鍵・決定ログを読む。
3. Portal エディタで `authorize.py` を編集する。
4. 「公開テストを実行」を押し、直接回答の欄を証拠から埋める。
5. 各 checkpoint をそのまま提出する。Portal が現在のファイルと回答を準備して送る。

すべてこの deploy の seed 由来である。別の起動で出した番号は当たらない。

## ローカルでの進め方

```bash
make build            # 参加者用イメージをビルド
make inspect          # この deploy の token・鍵・決定ログ
make test             # 公開テスト (starter を通す)
make test-one ID=...  # 名前の部分一致で 1 件だけ
make reset            # starter/ を出荷時の状態へ戻す
```

作者と CI のみ:

```bash
make reference-test   # hidden suite と mutation suite をイメージ内で実行
```

## Checkpoint

| id | 訊いていること |
| --- | --- |
| `environment` | Portal エディタが出す合言葉 |
| `window` | 表示された token が通る最初と最後の `now` を `[最初, 最後]` で |
| `audit` | gateway が allow したうち、通してはいけなかった行の番号を昇順で |
| `verify` | この gateway が発行した token かどうかを判定できる `authorize.py` |
| `isolate` | token は本物として、この要求を通してよいかを判定できる `authorize.py` |
| `generalize` | 書き上げた `authorize.py` |

`verify` / `isolate` / `generalize` は同じファイルを提出する。別々の checkpoint なのは、採点に使う
hidden phase が違うからであって、入力が違うからではない。

## 保証範囲

ローカル実行は**自習用の honor-system 検証**です。マシンも Docker デーモンも image も
あなたの管理下にあるので、 image の中身はあなたに対して秘匿されていません。
`reference/` と `tests/hidden/` を bind-mount しないのは、あなたの git checkout に
紛れ込ませないためであって、手が届かなくするためではありません。参加者用 image には
`reference/` も mutation suite も入っていませんが (`local/Dockerfile` の `author` stage を
参照)、 これは誤配の防止であって秘匿ではなく、 その stage をビルドすれば中身はすべて読めます。

verifier が実際に保証するのはもっと狭く、そして本物です。提出コードは verifier を
ハングさせたりクラッシュさせたりできません。 checkpoint は echo した id しか加点できません。
結果は期待値を漏らしません。 fixture はこのデプロイの seed 由来なので、暗記した答えは持ち越せません。

これは自習と誠実な練習を支えます。競技順位・試験・修了判定は**支えません**。
それらには participant が管理しない verifier が必要で、
[#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271) で追跡しています。

## この先につながるもの

「検証は通った、だから通してよい」の飛躍は、この track で服を替えて何度も出てくる。トランザクションが
commit されたことは、読んだ人が見た状態が正しかったことを意味しない。cache が hit したことは、その値が
今も正しいことを意味しない。どれも同じ形の間違いで、どれもテストは緑になる。
