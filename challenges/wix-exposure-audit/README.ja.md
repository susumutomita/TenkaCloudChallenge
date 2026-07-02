# 公開設定の置き土産

> TenkaCloud Challenge · `wix-exposure-audit` · 難易度1 · 約40分 · `multi-verify`

SaaSで作った模擬business siteをbrowserだけで監査する、AWS不要の教材です。実際のWixなどの
SaaSには接続せず、実在する顧客dataも使いません。3つの独立した公開・権限不備と、設定変更後の
再検証を4つのcheckpointとして採点します。

## runtimeと安全境界

| address | 用途 |
| --- | --- |
| `127.0.0.1:18080` | 公開siteと、所有者が使う正規設定画面 |
| `127.0.0.1:18081` | loopback限定の`/verify` |

両portはDockerでloopbackだけにbindします。flagとcapability tokenはデプロイごとの
`FLAG_SEED`から導出し、正解をrepositoryへ保存しません。

## scenario

Aoi Design Studioは外部制作会社からsiteを引き継ぎました。site builder自体は正常ですが、
次の3つの管理境界が整理されていません。

1. 顧客確認用pageが公開`sitemap.xml`へ残っている。
2. 「linkを知る全員」が読める受信箱URLが公開HTML sourceへ残っている。
3. 契約終了済み制作会社のSite manager権限が有効なままである。

これは公開範囲、capability URL、collaborator lifecycleという別々のcontrolです。最後の
checkpointでは、所有者が3つをすべて是正した実状態を採点します。

## checkpoint

| ID | 証跡 | 点 |
| --- | --- | ---: |
| `preview-indexing` | `sitemap.xml`から到達できるreview pageの合言葉 | 20 |
| `shared-inbox` | 漏れたshare URLから読める顧客受信箱の合言葉 | 20 |
| `stale-collaborator` | 有効なままの制作会社access pageの合言葉 | 20 |
| `settings-remediation` | 3つの所有者設定を是正した後のhidden state検査 | 40 |

設定を閉じると証跡へ到達できなくなるため、先に3つの合言葉を集めます。

## 監査手順

1. 問題を起動します。

   ```sh
   make local PROBLEM=wix-exposure-audit
   ```

2. `http://127.0.0.1:18080/robots.txt`と、そこから案内される`sitemap.xml`を確認し、
   想定外の顧客確認pageへ進みます。
3. `/`のHTML sourceを表示します。制作会社のcommentに
   `/admin/inbox?share=...`が残っています。
4. `/humans.txt`を確認します。運用引き継ぎ記録から制作会社のaccess URLへ進みます。
5. 各`TC{...}`を対応するPortal checkpointへ提出します。
6. 所有者として`http://127.0.0.1:18080/owner/settings`を開き、次を実行します。

   - previewの検索公開を停止する。
   - 受信箱のshare linkを失効する。
   - 制作会社collaboratorを削除する。

7. `settings-remediation`へ`VERIFY`を提出します。

## 是正後に確認できること

3設定を直すと、次の状態になります。

- `sitemap.xml`からreview pageが消え、直接accessも`404`になる。
- 古い受信箱share URLは`403`になる。
- 古い制作会社access URLは`403`になる。
- `/verify`は是正checkpointの`VERIFY`を成功として判定する。

containerを再起動すると、意図的に不備を持つ初期状態へ戻り、新しいflagが生成されます。

## なぜ重要か

managed SaaSが減らすのはinfrastructure作業であり、access governanceの責任ではありません。
capability URLは失効するまで権限として働き、検索engineはsitemapに載せたpageをたどり、
外部collaboratorは削除するまで権限を持ち続けます。公開前確認では3つを別々に棚卸しする
必要があります。

## 関連file

- `local/app/server.mjs` — 公開不備、所有者control、採点
- `local/docker-compose.yml` / `local/Dockerfile` — loopback限定runtime
- `metadata.json` — 日英checkpoint label、hint、採点
