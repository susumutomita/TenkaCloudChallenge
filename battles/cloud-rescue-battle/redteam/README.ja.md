# Cloud Rescue Battle 運営ガイド

> English: [README.md](./README.md)

この文書はoperatorまたはred team向けです。Battle開始前に参加者へ配布しません。

## 障害カタログ

| ID | 対象 | 操作 | 参加者が見る症状 | 自動revert |
| --- | --- | --- | --- | --- |
| `frontend-down` | 対象teamのEC2 | nginxを停止 | APIが正常なままfrontend probeが失敗する | 600秒後にnginxを起動 |
| `api-down` | 対象teamのEC2 | `tenkacloud-api`を停止 | frontendが正常なままAPI probeが失敗する | 600秒後にAPIを起動 |

## 発火前の確認

- 対象teamが2つのendpointを登録し、最初の得点を得ている
- 解決した`InstanceId`が対象teamのstackに属している
- 同じ障害のrevertが待機中ではない
- team、disruption ID、実行時刻、command結果、revert予定時刻を記録する

Security Group、IAM、VPC、別teamのaccountは変更しません。

## 参加者の復旧経路

参加者はSSM Session Managerで接続し、最初に証拠を確認します。

```bash
systemctl status nginx tenkacloud-api
journalctl -u nginx -u tenkacloud-api --no-pager -n 50
```

想定する復旧操作は次です。

```bash
sudo systemctl start nginx
sudo systemctl start tenkacloud-api
```

commandの終了codeだけでなく、Participant Portalの外形probeで復旧を確認します。

## 中止条件

次の場合は追加発火を止めます。

- SSM commandが失敗するかpendingのままになる
- 対象teamまたはinstanceを誤る
- 1つのservice停止で両endpointが失敗する
- 自動revertを予約できない
- 参加者がSSM Session Managerへ接続できない

必要なserviceを手動で起動し、外形probeの成功まで確認します。全ての操作を対象teamのEC2内で完結させます。
