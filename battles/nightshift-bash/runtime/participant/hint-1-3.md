# 1 / ヒント3 — 実証と修復を分ける

調査フェーズのauditorで次を実行します。値はこの演習専用です。

```bash
ls -l /srv/nightshift/backup/settlement.key
cat /srv/nightshift/backup/settlement.key > /srv/nightshift/submissions/leak.txt
```

運営側で`submit`し、修復フェーズへ移った後のoperatorで権限を修復します。

```bash
chmod 0640 /srv/nightshift/backup/settlement.key
```

ファイルはoperator所有、workloadグループです。batchもworkloadグループとして動くため、グループの読み取りは残します。運営にauditorのシェルを開いてもらい、`cat`がPermission deniedになるか確認してください。採点で再び読める状態へ戻る場合は、ミッション3の起動設定も調べます。
