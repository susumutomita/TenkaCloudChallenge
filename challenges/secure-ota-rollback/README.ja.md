# Northstar OTA復旧任務

## はじめに

Northstar車両は明日が量産判定だが、仮想車両の更新が正規発行物であること、
互換性を満たすこと、中断後に安全に再開すること、起動失敗から復旧すること、
監査で説明できることをまだ証明できない。1台のTCU、2台のECU、user-space
車載bus、分離されたOTAとsigning serviceを引き継ぐ。controlは意図的に危険な
初期状態から始まる。

これはAWSを使わないlocal-play Challengeである。Uptane適合実装や法規適合を
主張するものではなく、実機、production cloud、外部accountを必要としない。
すべてDocker内で動作する。

## 最初の一手

TenkaCloud repositoryから起動する。

```bash
make local PROBLEM=secure-ota-rollback
```

引き継いだcontrolとA/B slotを確認し、正規更新を実行する。

```bash
curl -s http://127.0.0.1:18100/api/state
curl -s -X POST http://127.0.0.1:18100/run \
  -H 'content-type: application/json' \
  -d '{"scenario":"signed-ordered"}'
```

設定値を当てずっぽうで変更しない。manifestのdependency、bus配信順、ECU slot、
install回数、correlation IDを比較する。

## ゴール

`PATCH /api/config`で既存のTCU/ECU controlを修正し、次の5つのbehavioral
checkpointをすべて通す。

1. 正規のupdateをECU A、その後に依存するECU Bへ届ける。
2. 改ざん、unsigned、downgrade packageでECU stateを変えない。
3. 一時的なbus切断では完了済み作業を再実行せず再開し、長い切断ではboundedな
   retry上限で停止する。
4. 起動失敗時にknown-good slotへ戻る。
5. signing、OTA、TCU、bus、ECU A、ECU Bを1つの監査timelineで結ぶ。

各checkpointはParticipant Portalから個別に提出する。container verifierは新しい
behavioral probeを実行し、設定flagや暗記した答えを信用しない。

## 安全境界

- 名称、車両、package、eventはすべて架空である。
- hostへ公開するのは`127.0.0.1:18100`（workshop）と
  `127.0.0.1:18101`（verifier）だけであり、非loopback addressへbindしない。
- 6 serviceのnetworkはDocker internalであり、external networkへのrouteを持たない。
  OTAはそのnetworkから2つのloopback portだけを公開する。
- containerはnon-rootで動き、Linux capabilityをすべてdropし、権限昇格を禁止し、
  read-only root filesystemとCPU、memory、PID、一時disk上限を使う。
- signing private keyはruntimeにsigning processのmemory内で生成し、そのprocessから
  出さない。ECUはDocker internal service network経由でpublic keyだけを取得する。
- host mount、production credential、commit済みsecret、malware、実車interfaceはない。

## アーキテクチャと責任境界

labは6つのprocessを別containerとして動かす。

| Component                 | 所有する責任                                                           | 所有してはいけない責任                      |
| ------------------------- | ---------------------------------------------------------------------- | ------------------------------------------- |
| Signing                   | Ed25519 private keyとcanonical manifest署名                            | 車両state、配信、install、rollback判断      |
| OTA / workshop / verifier | campaign fixture、学習者API、監査収集、behavioral check                | ECUの受け入れ判定やboot判断                 |
| TCU                       | dependency順序、bounded delivery retry、完了集合、root correlation伝播 | signing keyやECU slot promotion             |
| User-space bus            | address付き配信と決定的な切断注入                                      | package trustやcampaign policy              |
| ECU A                     | local package検証、A/B install、health gate、known-good state          | ECU Bのinstallやcloud campaign policy       |
| ECU B                     | 同じlocal判断とECU Aへのdependency                                     | TCUから届いたことを真正性の証明とみなすこと |

state machineとtrust boundaryは[ARCHITECTURE.ja.md](./ARCHITECTURE.ja.md)、
OEM/supplier/operator/SOCの引き継ぎは[RACI.ja.md](./RACI.ja.md)、
参加者向け構成図は`diagram.svg`を参照する。

## Workshop API

### 観測する

```bash
curl -s http://127.0.0.1:18100/api/state
curl -s http://127.0.0.1:18100/api/scenarios
curl -s http://127.0.0.1:18100/api/audit
```

`/api/state`は現在のTCU policy、両ECUのpolicyとslot、最後のcampaign、bus fault、
delivery attempt、audit eventを返す。

### bounded scenarioを実行する

```bash
curl -s -X POST http://127.0.0.1:18100/run \
  -H 'content-type: application/json' \
  -d '{"scenario":"resume"}'
```

公開scenarioは次のとおり。

| Scenario         | 観測対象                                   |
| ---------------- | ------------------------------------------ |
| `signed-ordered` | dependency順序と最終version                |
| `tampered`       | 署名後にpayloadとmanifestを改変したpackage |
| `unsigned`       | 発行者署名の無いpackage                    |
| `downgrade`      | active versionより古いversion              |
| `resume`         | ECU B直前に起きる1回の決定的なbus切断      |
| `health-failure` | 書き込み後のhealth gateに失敗するimage     |
| `audit-trace`    | end-to-end event timeline                  |

各`/run`はcontrol policyを保持したままECU dataとbus logをresetする。scenarioは
再現可能で、前のscenarioのstateに隠れて依存しない。

### controlを変更する

`PATCH /api/config`は`tcu` object、`ecu` object、または両方を含むpartial objectを
受け付ける。field名と現在値は`/api/state`で確認できる。仮説を1つずつ送信し、
対応するscenarioを再実行して、stateが変わった理由を説明する。不正なfield値は
HTTP 400でfail closedになる。

### checkpointを検証する

通常はParticipant Portalがverifierを呼ぶ。contractを直接smoke testする場合は次を使う。

```bash
curl -s -X POST http://127.0.0.1:18101/verify \
  -H 'content-type: application/json' \
  -d '{"checkpointId":"signed-ordered-install","submission":"VERIFY","context":{}}'
```

responseは`checkpointId`をechoし、behavioral verdictだけを返す。5つのcheckpoint IDは
`metadata.json`と一致する。

### reset

```bash
curl -s -X POST http://127.0.0.1:18100/reset
```

resetはidempotentである。繰り返してもfactory version、active A slot、空のaudit/bus
log、元の危険なpolicyへ同じように戻る。10分という受入上限より十分短い数秒で完了する。

## A/B、version、dependency、retry model

- 両ECUはhealthyなversion 1をslot Aで起動し、slot Bは空である。
- packageはcampaign、対象ECU、version、dependency、payload hashをcanonicalなsigned
  manifestに持つ。boot healthはECU localに測定し、publisherがmanifestで指定できない。
- install先はinactive slotだけである。healthy bootでknown-goodへ昇格でき、failed boot
  は失敗imageを証拠として残しつつactive pointerを前のknown-goodへ戻す必要がある。
- ECU B updateはECU Aが要求versionへ到達することに依存する。TCUの順序制御と、ECU Bが
  ECU Aのlive stateを確認する検証は別々のcontrolであり、caller提供inventoryは無視する。
- bus fault counterは決定的である。verifierは1回の中断と長い中断の両方を使い、resumeと
  unbounded retryを区別する。
- TCUはcampaign attempt内の完了状態を保持し、resume中に完了ECUを二重installしない。

## 自動採点と人手review

5つの`multi-verify` checkpointは合計300点である。Hintは観測、診断、設計原則の順に
進む。verifierはsecret flag比較ではなくlive state transitionとnegative caseを評価する。

自動採点はarchitecture説明の質を採点しない。checkpoint後に次を含む短いreportを作る。

- OEM architect、ECU supplier、OTA operator、SOC analystのRACI
- asset、actor、trust boundary、abuse case、証拠を示すThreat model
- このMVPから除外したproduction controlとResidual risk
- 結論を支えるcorrelation IDとevent sequence

facilitatorは[FACILITATOR.ja.md](./FACILITATOR.ja.md)の100点rubricで別に評価する。
自動check合格は必要条件だが、人手評価点を自動的に得るものではない。

## Resourceとcost上限

各serviceは0.5 CPU、96 MiB RAM、64 PID、16 MiB一時filesystemを上限とする。learnerが
修正する前でも、最悪の宣言値をserviceのhard capが制限する。audit/bus logとHTTP bodyは
boundedで、operationは直列化する。AWS resourceを作らないためcloud costは0であり、
local DockerのCPU/disk利用だけがcostになる。

## DockerとCodespaces smoke test

Docker Desktop、Compose v2付きDocker Engine、GitHub Codespacesは同じentrypointを使う。

```bash
docker compose -f challenges/secure-ota-rollback/local/docker-compose.yml up -d --build
curl -fsS http://127.0.0.1:18100/healthz
curl -fsS http://127.0.0.1:18101/healthz
docker compose -f challenges/secure-ota-rollback/local/docker-compose.yml down -v
```

Codespacesではterminalから実行し、port visibilityをprivate/loopbackから変更しない。この
演習はforwardされたpublic portを必要としない。
