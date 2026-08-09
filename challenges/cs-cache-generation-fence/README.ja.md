# 消した。それでも古い値が戻ってきた

`cs-foundations` 第4章、45〜75分のローカル問題です。

前提にするもの: Python の関数と辞書が読めること。
前提にしないもの: cache、revision、並行処理を知っていること。

## なぜこれをやるか

商品価格を更新し、cache の旧価格も削除した。それでも次の購入画面に旧価格が出た。
「削除APIが成功した」という事実だけでは、すでに origin を読んでいる途中の処理まで止められません。
この問題を終えると、**cache に入れる瞬間**に古さを判定する理由を、動くコードで説明できます。

## まず言葉をそろえる

- **origin**: 正しい値を保存する元の場所。
- **cache**: origin から読んだ値を一時的に置く辞書。
- **revision**: origin が commit するたび増える整数の版番号。
- **cache miss**: cache に値が無く、origin を読み始めること。
- **fill**: origin の read が終わり、値を cache に入れようとすること。
- **invalidate**: 「この key は更新された。古い entry を使わないで」という通知。
- **generation floor**: この数字より古い fill を入れない、key ごとの下限。

## いちばん小さい実例

```text
時刻 1  sku-314 rev 7 の cache miss。origin read が始まる
時刻 2  sku-314 rev 8 を origin へ commit
時刻 3  sku-314 を invalidate。cache entry を削除
時刻 4  時刻1の read が遅れて終了。rev 7 を fill
時刻 5  cache hit。rev 7 を返す       ← origin はもう rev 8
```

順番に `update → invalidate → read` する公開テストでは、時刻4の逆転がありません。だから壊れたstarterも
緑になります。これはテスト不足の事故ではなく、問題の入口です。

## Participant Portal で解く

1. Participant Portal から問題を起動します。
2. **証拠を調べる**を押し、このdeploy固有のrace timelineとdecision logを読みます。
3. auditでは、keyごとに最後の`origin_commit`を覚え、それより古いrevisionの`cache_hit`が持つ
   `index`値をJSON配列で答えます。画面上の行を1から数えず、ログに表示された`index`を使います。
4. editorの`cache_policy.py`で次の2関数を直します。

```python
invalidate(cache, key, committed_revision) -> None
admit_fill(cache, key, value, revision) -> bool
```

`cache` の形はstarter冒頭にあります。`admit_fill`は保存したときだけ`True`を返します。

5. **公開テストを実行**し、通常のhit/missと逐次updateを壊していないことを確認します。
6. checkpointごとに提出します。コードcheckpointは現在のeditor内容をprepare APIが渡します。

ローカルの端末で同じ入口を使う場合は、問題ディレクトリで次を実行できます。

```bash
make inspect
make test
make test-one ID=sequential
make reset
```

`make reference-test` は著者向けで、参加者の解法確認には使いません。

## 合格する性質

- invalidateしたkeyの古いentryを消す。
- invalidateのrevisionをkeyごとに覚え、古いfillを拒否する。
- floorと同じrevisionのfillは受け取る。
- より古いinvalidateでfloorを後退させない。
- 順序が逆転した古いinvalidateで、同じrevisionまたはより新しいentryを消さない。
- すでにcacheされた新しいentryを、遅い旧fillで上書きしない。
- 他keyの正常なfillを止めない。

cacheを常に使わない、TTLを0にする、全keyを1つのglobal floorで止める解答は合格しません。

## Checkpoints

| ID | 点 | 見るもの |
| --- | ---: | --- |
| `environment` | 10 | 起動したcontainerの合言葉 |
| `audit` | 30 | staleなcache responseの行 |
| `basic-invalidate` | 25 | 削除と更新世代の記録 |
| `fence` | 50 | late old fillの拒否 |
| `per-key` | 35 | key間の分離 |
| `generalize` | 50 | 未見revisionと順序 |

## 保証範囲

ローカル実行は**自習用の honor-system 検証**です。マシンも Docker デーモンも image もあなたの管理下に
あるので、image の中身はあなたに対して秘匿されていません。参加者用 image に `reference/` と mutation
suite を入れないのは誤配防止であって秘匿ではなく、`author` stage をビルドすれば読めます。

verifier は host の `127.0.0.1:18340` だけに公開され、container は non-root、read-only filesystem、
no-new-privileges、capabilities なし、外向き通信なしで動きます。提出は timeout と資源上限のある一時領域で
実行され、checkpoint は echo した id しか加点できず、結果は期待値を返しません。

これは自習と誠実な練習を支えます。競技順位・試験・修了判定は**支えません**。

## 次へ

ここで使った「順序」と「同じ論理操作の再実行」は、第5章のHTTP retry/idempotencyで再登場します。
