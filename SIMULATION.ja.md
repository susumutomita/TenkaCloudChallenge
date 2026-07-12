# Simulation overlay 契約

> English: [SIMULATION.md](./SIMULATION.md)

TenkaCloud Simulator は provider-native IaC、IAM policy、endpoint/scoring metadata、
disruption metadata から local-play の requirement を生成します。これらから workload
または data-plane 挙動を特定できない問題だけが `simulation.json` overlay を持ちます。
overlay は compatibility 契約であり、問題定義を二重化するものではありません。

この契約は `SCHEMA.json` と独立して versioning します。`metadata.json` では参照を
明示します。

```json
{
  "simulationOverlay": {
    "schemaVersion": "1",
    "entry": "simulation.json"
  }
}
```

参照先は [`SIMULATION_SCHEMA.json`](./SIMULATION_SCHEMA.json) に適合させます。

```json
{
  "$schema": "../../SIMULATION_SCHEMA.json",
  "schemaVersion": "1",
  "requirements": [
    {
      "targetId": "default",
      "service": "http",
      "resourceType": "HTTP::Endpoint",
      "operation": "Request",
      "fidelity": "L4",
      "plane": "participant"
    }
  ]
}
```

`targetId` は必ず正規化済み runtime target を指します。single runtime は `default`、
composite runtime は対応する `runtime.targets[].id` です。Simulator scanner は target
から provider と engine を引き継ぎ、overlay requirement を source JSON pointer 付きの
`origin: "simulation-overlay"` として記録します。

## 記述できる内容

- `requirements[]` は通常の catalog source から導出できない
  provider/resource/operation/fidelity/plane の事実だけを補います。
- `workloads[]` は `image` が registry の
  `@sha256:<lowercase hex 64 文字>` で pin されている場合だけ executable OCI workload
  を宣言できます。`resourceRef`、非特権 `containerPort`、任意の `healthPath`、command、
  content-addressed repo artifact を指定できます。
- artifact は `{ "path": "...", "sha256": "..." }` です。path は problem directory
  内の symlink component を含まない regular file に限定し、digest は file bytes そのもの
  に対する SHA-256 です。artifact 単体は互換性の根拠であり、実行可能 workload では
  ありません。
- catalog 所有 workload image は cloud 問題と同じ reviewed service module から build します。
  workflow は multi-platform manifest を GHCR に publish して immutable digest を報告し、
  `simulation.json` を mutable tag へ向けません。overlay の `resourceRef` は実 stack output
  に binding し、simulator 専用の置換 handler は認めません。

overlay には scoring、answer、flag、secret、credential、environment variable、network
egress、host mount を書けません。unknown field も validation error です。これにより
採点・解答の正本を従来境界に残し、overlay を privileged execution escape にしません。

## Binding evidence と authorization inventory の分離

IAM `Allow` は principal が実行を許可された上限を表し、participant / workload / scorer /
operator が allow-list の全 operation を実際に呼ぶ証拠ではありません。Console の discovery
API、cleanup の選択肢、managed runtime の広い workflow では、1 つの正当な play path より
多くの operation を許可するのが通常です。

そのため compatibility では IAM action を non-blocking な authorization inventory として
扱います。IaC の resource relationship、構造化された scoring/disruption metadata、または
exact な overlay entry がある operation だけが binding requirement です。documented な
participant/workload command だけが実行根拠なら、その operation だけを `requirements[]` に
追加します。周囲の IAM allow-list 全体を overlay にコピーしたり、overlay で許可済み
operation を suppress したりしません。この分離により、permission の広さを runtime use と
誤認せず、本当の capability 不足だけを loud に失敗させます。

## Validation と compatibility

`bun run validate` は次を拒否します。

- entry が missing/unreadable/problem 外/symlink
- metadata reference と overlay の schema version 不一致
- unknown/duplicate な target、requirement、workload id
- digest 未固定 image、privileged port、不正な health path/command
- missing/non-regular/symlink 経由/hash drift の artifact
- 1 MiB 超の overlay または 16 MiB 超の artifact
- metadata から参照されていない `simulation.json`

compatibility workflow は pin した TenkaCloudSimulator revision を checkout し、Simulator
capability manifest を生成してこの checkout を scan します。missing、insufficient、invalid
requirement は simulation world 作成前に loud に失敗します。report は決定論的で、credential
や答えを含みません。
`bun run validate` は catalog 所有 workload workspace も lifecycle script 無効の
frozen lockfile から install してから test と strict typecheck を実行します。そのため、
fresh clone が残存する nested dependency に依存しません。

## 現行 cloud catalog の監査

baseline は TenkaCloudChallenge commit
`68516c8694283baf72267568ec2dad865700d3e5`（20 problems、cloud-backed 9 problems、
cloud target 10）です。判断は問題文だけでなく、scanner source kind と L4 requirement の
有無に基づきます。

| Problem | 既存の機械的根拠 | Overlay 判断 |
| --- | --- | --- |
| `cloudflare-api-security` | IaC は AWS evaluator を示し、instructions と生成される `evaluate.sh` は SSM/S3 read と participant `Lambda InvokeFunction` を実行する。participant 所有 `*.workers.dev` probe は他の source に無い。 | 必須: exact な participant command と external HTTP scoring probe を宣言。 |
| `hello-multicloud` | AWS/GCP IaC と target 別 `composite-probe` metadata が resource と L4 probe を示す。 | 不要。 |
| `hello-world` | solve instructions は `SSM GetParameter` を明示的に実行する。IAM permission 単独は binding execution evidence ではない。 | 必須: exact な participant read を宣言。 |
| `hello-world-battle` | IaC + endpoint/probe metadata + `ssm-run-command` は scoring/fault path を示すが、player instructions は別に `SSM StartSession` を必須とする。 | exact な participant `ssm/AWS::SSM::Session/StartSession` operation だけ必須。周囲の session IAM allow-list は昇格しない。 |
| `http-query` | instructions は Logs `FilterLogEvents` と ELB `DescribeRules` / `ModifyRule` を明示的に使う。IaC/metadata は participant の非標準 HTTP `QUERY` request path を示さない。 | 必須: exact な control-plane command と participant HTTP request behavior を宣言。 |
| `microservice-migration-battle` | IAM は広い migration authorization envelope に過ぎない。guide は `Lambda CreateFunction` を明示し、metadata は polling を示すが、participant が移行する 3 service は materialized runtime behavior を必要とする。 | 必須。catalog gateway image は同じ users/orders/catalog Hono application を import し、stack の `BaseUrl` に binding して、publish 済み multi-platform manifest digest で pin する。 |
| `security-battle-royale` | IaC + endpoints + scoring/attack probes + SSM disruption が data plane/fault を示す。 | 不要。 |
| `stackstack` | IaC + endpoints + poll/attack-probe + disruption metadata は scoring/fault を示すが、player instructions は別に SSM/S3/WAF/EC2 operation を使う。 | exact な participant operation を宣言。 |
| `x402-paywall` | IaC に Lambda handler/SSM config があり、同梱 bot-client flow は S3/SSM/STS を使って gate Lambda を invoke する。IAM authorization 単独は invocation evidence ではない。 | 必須: exact な participant operation を宣言。 |

問題変更時は overlay の横展開ではなく compatibility を再実行します。通常 source の具体的な
gap を示せる場合だけ overlay を追加します。
