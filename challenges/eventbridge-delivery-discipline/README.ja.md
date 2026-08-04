# 二度届いて、前後する

> TenkaCloud Challenge · 難易度3 · 45–60分 · ローカルDocker · multi-verify（6 checkpoint・200点）

EventBridge風の注文consumerが、重複した`PaymentCaptured`を二重計上し、遅れて届いた
`OrderCreated`で状態を巻き戻し、同versionの衝突を黙って上書きし、retry枯渇後のeventを
捨てています。このラボでは、これらを明示的で決定論的なdelivery状態機械へ直します。
合成eventだけを使い、AWS account、credential、production data、外向きnetworkは不要です。

## architectureと信頼境界

```text
Browser Workbench (participant image, :18120)
  -> vulnerableな合成streamを観察
  -> delivery-policy JSONを編集
  -> loopback CORSでpublic-test / prepareを呼ぶ

Verifier image (:18121, 別internal network)
  -> 公開caseとsubmission encoder
  -> hidden permutation / mutation / checkpoint別 /verify
```

2 containerはnon-root、read-only、Linux capability全削除で、別々のDocker networkへ
接続します。host portは`127.0.0.1`だけにbindし、seccompも外向き`connect`、
`sendto`、`sendmsg`、`sendmmsg`を拒否します。participant imageに入るのはWorkbench、
starter policy、状態機械の基本処理だけです。reference policy、公開期待値、hidden grader、
`/verify`実装はverifier imageだけに入ります。

## delivery model

policyでは7つの判断を分離します。

1. vulnerable runで見つけた現象
2. 元eventのidentityとatomicな副作用ledger
3. aggregate versionの単調性とversion gap
4. canonical payloadによるsame-version conflict
5. 有限retry budgetと決定論的backoff metadata
6. 完全で再処理可能なDLQ receipt
7. 2回目のreplayでも変化しない永続化

6つの採点checkpointは独立です。部分修正は満たしたcheckpointだけ得点します。hidden testは
正常系・異常系・shuffle・malformed・retry枯渇・mutationを含みます。固定回答、timestamp sort、
event IDだけ、versionだけのpolicyでは全checkpointを通過できません。

AWS EventBridgeはretriableなtarget delivery失敗をpolicyに従って再試行し、文書上の既定値は
最大24時間・185回、exponential backoffとjitterです。枯渇後はDLQが無ければeventがdropされます。
target DLQはStandard SQSで、error code、exhausted condition、retry attempts等の属性を持ちます。
AWS公式の[retry policy](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-rule-retry-policy.html)、
[DLQ](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-rule-dlq.html)、
[delivery monitoring](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-monitoring-events-best-practices.html)を参照してください。
このラボは時間を圧縮し、採点を再現可能にするためjitterなしの決定論的backoffを使います。
AWS service自体のemulatorではありません。

## 起動とcleanup

    docker compose -f challenges/eventbridge-delivery-discipline/local/docker-compose.yml up --build

`http://127.0.0.1:18120/`を開き、壊れたstreamの観察、policy修正、公開test、提出値生成の順に進みます。

    docker compose -f challenges/eventbridge-delivery-discipline/local/docker-compose.yml down --volumes --remove-orphans

推定費用は0 USDです。cloud resourceのCREATE / UPDATE / REPLACE / DELETEはすべてなし。
作成するのは使い捨てのlocal container、image、Docker networkだけです。

## playtest status

CIと実装PRには自動検証とagent操作のlocal flowを記録します。人間の学習者が最後まで実施して
記録しない限り、human playtest passedとは扱いません。
