# MCP Origin Guardian — 信頼できる入口はどこ?

> TenkaCloud Challenge · 難易度3 · 45–60分 · ローカルDocker · verify採点

MCP風OAuth protected resourceのauthority境界を扱う、ブラウザ完結の防御ラボです。
実OAuth provider、実credential、cloud account、外向きnetworkは使用しません。

## 起動するもの

| bind | 用途 |
| --- | --- |
| 127.0.0.1:18110 | Browser Workbenchと合成resource API |
| 127.0.0.1:18111 | TenkaCloudが使うloopback verifier |

コンテナはread-only、non-root、Linux capability全削除で動き、両portはloopbackだけに
bindされます。

## ミッション

初期サービスは受信requestからallowed Hostとprotected-resource metadataの両方を
作ります。値は一致しますが、共通の入力源を攻撃者が制御できます。Workbenchで次を
行います。

1. 正規authorityと攻撃者指定authorityを比較する
2. 運用者承認済みproduction HTTPS originを設定する
3. 未知Host、Origin、forwarded authorityを拒否する
4. loopback例外を明示development modeの背後に置く
5. 公開ケースを実行し、Participant Portalへの提出値を作る

提出値はpolicy JSONのbase64url表現で、credentialやflagを含みません。verifierは
正常系と異常系を再実行するため、常時許可や常時拒否では合格できません。

## cleanupとコスト

AWSリソースは作らず、推定費用は0 USDです。停止・削除:

    docker compose -f challenges/mcp-origin-guardian/local/docker-compose.yml down --volumes --remove-orphans

物理影響: CREATE / UPDATE / REPLACE / DELETE はすべてなし。ローカルcontainerのみです。
