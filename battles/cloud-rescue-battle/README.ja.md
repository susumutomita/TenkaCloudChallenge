# Cloud Rescue Battle

> English: [README.md](./README.md)

公開直前のWebサービスを、複数チームで運用するBattleです。EC2上のnginx frontendとPython APIをParticipant Portalへ登録すると、1分ごとの継続採点が始まります。運営はチーム単位でfrontend停止またはAPI停止を注入できます。

## 学習目標

- 外形監視からfrontendとAPIのどちらが壊れたかを切り分ける
- SSM Session Managerで接続し、`systemctl`と`journalctl`で証拠を確認する
- serviceを復旧し、外形監視の成功まで確認する
- 再発時に調査手順を再利用する

## 競技の流れ

1. Stack Outputの`Ec2HostHint`を確認する
2. Portalのfrontend slotへ`http://<host>`、api slotへ`http://<host>:8080`を登録する
3. 両endpointがHTTP 200を返し、得点が増えることを確認する
4. 障害後は`SsmStartSessionCommand`でEC2へ接続する
5. 状態とlogから原因を絞り、停止serviceを復旧する
6. Portalでprobeが再び成功したことを確認する

## 障害注入

- `frontend-down`: nginxを停止し、10分後に自動復旧する
- `api-down`: `tenkacloud-api`を停止し、10分後に自動復旧する

障害は対象チームの1台のEC2内で完結します。SSH portは公開しません。

## 削除

問題stackをCloudFormationから削除すると、EC2、VPC、subnet、Internet Gateway、Security Group、IAM roleを回収できます。終了後は残存リソースを確認してください。
