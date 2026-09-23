# 3 / ヒント3 — 原因を止めてから再検証する

調査フェーズのauditorで原因の内容を確認し、そのパスを保存します。

```bash
cat /srv/nightshift/app/startup.d/40-compat.sh
printf '/srv/nightshift/app/startup.d/40-compat.sh\n' > /srv/nightshift/submissions/startup.txt
```

運営側で`submit`した後、修復フェーズのoperatorでは次のように古い起動処理を無効化できます。`.disabled`はこの演習の起動対象である`.sh`に一致しません。

```bash
mv /srv/nightshift/app/startup.d/40-compat.sh /srv/nightshift/app/startup.d/40-compat.disabled
chmod 0640 /srv/nightshift/backup/settlement.key
printf 'export PATH=/srv/nightshift/app/bin:/usr/bin:/bin\n' > /srv/nightshift/app/config/runtime.env
```

ミッション2で残した実証用コマンドと、その書き込み権限も片付けます。最後に運営へ採点を依頼してください。再起動後の安全性と、実際の注文が正しく処理できることの両方を確認します。
