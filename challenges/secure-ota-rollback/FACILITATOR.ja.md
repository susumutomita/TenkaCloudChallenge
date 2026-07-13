# Facilitator guide — Northstar OTA復旧任務

platformの5 checkpointは実行可能invariantを評価する。このguideはarchitecture reasoningを
別に評価する100点の人手rubricである。rubric点を自動`multi-verify`結果へ混ぜない。

## session前

1. 2つのloopback health endpointを確認し、`POST /reset`を2回実行する。
2. 初期状態の`signed-ordered`、`tampered`、`resume`、`health-failure`、`audit-trace`が
   unsafeな観測になることを確認する。
3. 公開portが18100/18101だけで、compose networkにexternal egressが無いことを確認する。
4. 架空・local-onlyであり、production vehicleやUptane compliance testではないと伝える。

## 自動評価の期待境界

意図するhardened behaviorはpublisher signature、monotonic version、target/dependency check、
dependency順序、checkpoint付きbounded resume、known-good rollback、1つのroot correlation IDを
強制する。別の設定でも全behavioral probeを満たすなら受け入れる。自動checkpointの正本は
verifierである。

## 人手rubric（100点）

### Architectureと証拠 — 25

- 0: component名だけでdata/state flowがない。
- 10: package、inventory、report flowはあるがdeliveryとtrustを混同する。
- 20: signing、schedule、transport、ECU validation、boot、audit判断を分離しtrace/slot証拠を示す。
- 25: 不足証拠を特定し、再現可能なacceptance testも提案する。

### Threat model — 25

- 0: asset/trust boundaryの無い一般的な脅威一覧。
- 10: altered/unsigned/downgrade packageまたはbus中断を扱う。
- 20: actor、asset、boundary、abuse case、control、evidenceを接続する。
- 25: 障害と攻撃を区別し、key compromise/replayとMVPで証明できない範囲を書く。

### RACIとhand-off — 25

- 0: Accountable ownerがいない、または全rowが「共同」。
- 10: OEM、supplier、OTA operator、SOC roleを割り当てる。
- 20: decisionごとに1名のAccountableを置き、hand-off artifactを示す。
- 25: stop権限、incident escalation、key/supplier移行、責任gapのacceptance testを追加する。

### Residual risk — 25

- 0: lab合格でproduction OTAがsecure/compliantになったと主張する。
- 10: secure boot、key rotation、power/storage conditionのいずれかを示す。
- 20: ownerとcompensating controlを付けてriskを優先順位付けする。
- 25: detect/recoverの証拠、長期移行、owner通知、具体的な次の検証を加える。

## Threat modelの問い

- Asset: signing key、approved manifest、firmware payload、vehicle inventory、ECU known-good
  state、audit evidence。
- Actor: OEM release authority、supplier build system、OTA operator、TCU/bus、ECU software、
  SOC analyst、malicious insider、network attacker。
- Boundary: signing-to-OTA、cloud-to-TCU、bus-to-ECU、install-to-boot、component
  telemetry-to-audit。
- Labの仮定: ECU Bはisolated service network上のECU A live stateを読む。productionでは
  認証とfreshness protectionを持つinventory attestationが必要である。
- Abuse/failure: signing-key compromise、metadata/payload改変、unsigned、downgrade/replay、
  wrong target/dependency、disconnect storm、duplicate install、health failure、分断/欠落trace。

## Residual riskの例

このMVPはsecure boot/hardware trust anchor、key ceremony/rotation/revocation、threshold release
approval、encrypted transport、vehicle identity、power/storage/thermal precondition、partial fleet
rollout、owner notification、tamper-resistant log、認証済みinter-ECU inventory attestation、
長期certificate/supplier/cloud移行、実CAN/Automotive Ethernet timingを含まない。単なる列挙では
なく優先順位を求める。

workshopはcombined policy patchを全componentへの送信前に検証するが、TCU/ECU serviceをまたぐ
distributed transactionは実装しない。mid-flightのcomponent outageではreconciliationが必要に
なる。productionではversion付きdesired stateとrollback、またはtwo-phase/reconciliationの証跡を
用意する。

## debrief

cloud/TCUが所有するdecisionと、ECU localに残す必要があるdecisionを1つずつ挙げてもらう。
failure traceとrejection traceを比較し、最後に「reportで最も強い主張を無効にする不足controlは
何か」を問う。
