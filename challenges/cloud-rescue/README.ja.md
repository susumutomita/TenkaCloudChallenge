# Cloud Rescue

> English: [README.md](./README.md)

顧客向けfrontendが応答しない一方、同じEC2上のAPIは正常です。既存環境を作り直さず、症状と証拠から停止serviceを特定して復旧します。

## 学習目標

- frontendとAPIの症状差から原因範囲を狭める
- SSM Session ManagerでSSHなしに接続する
- `systemctl`と`journalctl`で状態を確認する
- 復旧後に外形確認を行う

## 進め方

1. `FrontendUrl`と`ApiUrl/healthz`の応答を比較する
2. `SsmStartSessionCommand`でEC2へ接続する
3. service状態とlogを確認する
4. 停止中のfrontendを復旧する
5. `curl http://localhost:8080/recovery`でflagを取得し、Portalへ提出する

`/recovery`はEC2内のlocalhostからだけ利用できます。nginxがHTTP 200を返すまではHTTP 503を返します。Challengeのflagは調査と復旧の導線を作る確認値であり、sudo利用者に対する秘密境界ではありません。継続状態の評価は`cloud-rescue-battle`で行います。

## 安全性と削除

- SSH portは公開しない
- 操作対象は問題stackのEC2だけ
- 新しい課金リソースを参加者に作らせない
- CloudFormation stack削除でEC2とnetwork/IAMリソースを回収する
