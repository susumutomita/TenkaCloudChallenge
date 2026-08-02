# MCP Origin Guardian — 信頼できる入口はどこ?

> TenkaCloud Challenge · 難易度3 · 45–60分 · ローカルDocker · verify採点

MCP風OAuth protected resourceのauthority境界を扱う、ブラウザ完結の防御ラボです。
実OAuth provider、実credential、cloud account、外向きnetworkは使用しません。

## 起動するもの

| bind | サービス | 用途 |
| --- | --- | --- |
| 127.0.0.1:18110 | participant | Browser Workbenchと合成resource API |
| 127.0.0.1:18111 | verifier | 公開test、提出準備、loopback `/verify` |

2サービスともread-only、non-root、Linux capability全削除で動き、portはhostの
loopbackだけにbindされます。participantとverifierは別々のDocker networkへ接続し、
両containerへ適用するcustom seccomp profileが`connect(2)` syscallを拒否します。
意図したloopback requestは受信できますが、containerから外向きTCP接続は開始できません。

participant imageにはWorkbench、観察/resource API、policy実行の基本ロジックだけを
含めます。公開testの判定、提出値の生成、hidden grader、`/verify`は別のverifier imageに
だけ入り、browserは厳密なOrigin allowlistを持つCORS経由でそれらを呼び出します。
これは採点コードを難読化する対策ではなく、Docker build targetとimageを物理的に分ける
信頼境界です。

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
公開されていない正常系・異常系も独立して再実行するため、常時許可、常時拒否、公開ケース
専用の分岐では合格できません。

## cleanupとコスト

AWSリソースは作らず、推定費用は0 USDです。停止・削除:

    docker compose -f challenges/mcp-origin-guardian/local/docker-compose.yml down --volumes --remove-orphans

物理影響: cloud resourceのCREATE / UPDATE / REPLACE / DELETEはすべてなし。
作成・削除されるのは使い捨てのローカルcontainer、image、networkだけです。
