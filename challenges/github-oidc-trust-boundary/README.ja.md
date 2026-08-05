# そのトークンは、どのworkflowのもの？

> TenkaCloud Challenge · 難易度3 · 45–60分 · ローカルDocker · multi-verify（6 checkpoint・200点）

production roleから長期AWS secretは消えました。しかしstarter trust policyは、同じGitHub
owner配下の全repository・branch・pull request・environmentを許可し、AWS向けaudienceも
確認しません。GitHubやAWSへ接続せず、この境界を修正します。

## やること

1. starter claim matrixを実行し、4つの誤許可を記録する。
2. GitHub OIDC providerと`sts:AssumeRoleWithWebIdentity` actionを正確に保つ。
3. `token.actions.githubusercontent.com:aud`を単一stringの`sts.amazonaws.com`へ一致させる。
4. `token.actions.githubusercontent.com:sub`を
   `repo:tenkacloud/production-app:environment:Production`へ完全一致させる。
5. 別repository、branch、PR、wrong/missing claim、複数audience、承認済みreusable workflowを
   使う未承認callerを拒否する。
6. matrixの順序を変えて再評価しても結果を変えない。

GitHub公式文書はissuerを`https://token.actions.githubusercontent.com`、AWS向けaudienceを
`sts.amazonaws.com`とし、IAMはroleを引き受けられるworkflowを絞るためGitHubの`sub`
condition評価を推奨しています。environment jobは`repo:ORG/REPO:environment:ENVIRONMENT`、
branchとpull requestは別のsubject形式です。一次資料は
[GitHub AWS OIDC guide](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws)、
[GitHub OIDC reference](https://docs.github.com/en/actions/reference/security/oidc)、
[AWS GitHub OIDC role guidance](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create_for-idp_oidc.html)、
[AWS OIDC provider guidance](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_create_oidc.html)です。

## modelの境界

これは決定論的な教材であり、AWS IAM・STS・JWT署名検証のemulatorではありません。1つの
Allow statement、federated provider、web-identity action、`aud`/`sub`に対する
`StringEquals` / `StringLike`だけをmodel化します。実GitHub tokenには多数の追加claimが
あるため追加claim自体は拒否しません。conditionが必要とするclaimの欠落・非stringは
fail closedにし、このラボではaudienceを単一stringに限定します。

AWS role trust policyはGitHub custom claimを利用できません。`job_workflow_ref`はreusable
workflowのidentityとして観察しますが、既定`sub`はcaller repository contextを持ちます。
未承認repositoryが承認済みreusable workflowを呼んでも、それだけで承認callerにはなりません。
environmentへ入れるbranch/tagの追加制御にはGitHub Environment protection ruleを使います。

## architectureとcleanup

```text
Browser Workbench (participant image, 127.0.0.1:18122)
  -> starter policy、観察matrix、editor
  -> loopbackでpublic caseと提出値生成

Verifier image (127.0.0.1:18123)
  -> reference policy、hidden matrix、mutation、6 checkpoint grader
```

imageは分離され、non-root、read-only、capability全削除です。seccompで外向きnetwork syscallも
拒否します。participant imageにはreference policy、hidden matrix、mutation suite、graderを
含めません。

    docker compose -f challenges/github-oidc-trust-boundary/local/docker-compose.yml up --build

`http://127.0.0.1:18122/`を開きます。終了時:

    docker compose -f challenges/github-oidc-trust-boundary/local/docker-compose.yml down --volumes --remove-orphans

推定費用は0 USDです。cloud resourceのCREATE / UPDATE / REPLACE / DELETEはありません。

## 保証範囲

local playはhonor-system verificationです。参加者はhost、Docker daemon、image、filesystemを
制御できます。committed referenceとhidden verifierのparticipant imageからの分離は通常の学習経路を
保つためで、host ownerから到達不能にするものではありません。local結果をcompetition、examination、
certificationの根拠にはできません。trusted remote verificationはIssue #271で追跡しています。

自動CIとagent操作のlocal flowはsource/runtime evidenceです。人間の学習者が最後まで実施して
記録しない限り、human playtest passedとは扱いません。
