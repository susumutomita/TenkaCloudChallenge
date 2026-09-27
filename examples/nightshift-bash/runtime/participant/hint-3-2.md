# 3 / ヒント2 — 上書きする側を探す

例：手作業で値をBへ直しても、起動スクリプトが毎回Aを書けば、再起動後はAになります。起動スクリプトを安全な値Bへ直すか、不要な古い処理を無効化する必要があります。

次のコマンドで、権限を変える処理やPATHを書き出す処理を探せます。

```bash
grep -R -n -E 'chmod|PATH|runtime.env' /srv/nightshift/app/startup.d
cat /srv/nightshift/logs/batch.log
```

修復フェーズへ移る前に、原因ファイルの絶対パスを証拠として提出します。
