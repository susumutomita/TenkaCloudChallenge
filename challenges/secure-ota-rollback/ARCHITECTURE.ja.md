# Secure OTA rollbackアーキテクチャ

## 対象範囲

これはupdateのprotect、detect、recoverを決定的に再現する教育用縮小modelである。
1台の車両、1台のTCU、2台のECUを扱う。cellular network、hardware root of trust、
production key ceremony、secure boot ROM、Uptane metadata role、法規承認はmodel化しない。

## Topology

```text
learner / verifier
       |
       v
OTA workshop -----> signing service
       |
       v
      TCU -----> user-space bus -----> ECU A
                         |-----------> ECU B (ECU A versionに依存)
```

host portを持つのはOTA containerだけである。内部service名はexternal routeを持たないDocker
internal networkだけで解決する。signing private keyはsigner memoryだけに存在し、ECU
containerは起動時に内部endpointからpublic keyを取得する。

## Package contract

signing serviceは次を含むmanifestをcanonical化して署名する。

- campaign ID
- 対象ECU ID
- 単調増加を比較できるversion
- ECU dependencyとminimum version
- SHA-256 payload hash

boot healthはECU localの観測であり、publisherが制御するmanifestには含めない。
Ed25519はcanonical manifestの発行者を認証し、SHA-256はpayloadが認証済みmetadataと一致
するかを確認する。どちらも、ECU側のtarget、version、dependency認可の代わりにはならない。

## ECU state machine

```text
known-good active slot
        |
        v
target + hash + signature + version + dependencyを検証
        |
        v
inactive slotへwrite -> boot/health gate
                         | healthy   -> active + known-goodへ昇格
                         | unhealthy -> 失敗証拠を保持し、
                                        activeをknown-goodへ戻す
```

初期policyでは複数の受け入れcheckが無効で、boot-failure scenario後にunhealthy imageが
activeのままになる。resetは常にslot Aのversion 1、空のslot B、install回数0、元の危険な
policyを再構成する。

## TCU state machine

TCUはdependency graphからpackage順を決め、bus経由で各packageを送る。ECU Bは受け入れ前に
ECU Aのlive internal stateを独立に読み、delivery callerが渡したinventoryは無視する。一時的な
delivery失敗はbounded retry cycleを増やす。hardened resumeは完了ECU集合を維持して未完了だけを
queueへ戻すが、引き継ぎpolicyは集合を消して完了済みinstallも繰り返す。

learner policyが危険でもlocal resourceを無制限に消費しないよう、lab serviceはhard retry
ceilingを常に強制する。

## Fault model

user-space busは1台のECUに対するbounded counterを持つ。対象deliveryごとにcounterを減らし、
決定的な一時切断を返す。randomなmessage改変はしない。package改変、署名欠落、downgrade、
dependency失敗は別々のOTA fixtureとする。health失敗はinactive slotへのwrite後にECU内で
注入・観測し、publisher metadataとboot evidenceを分離する。

## Audit contract

各eventはtimestamp、component/actor、action、result、correlation IDを持つ。valid traceは
signing、OTA、TCU、bus、ECU A、ECU Bで同じroot correlation IDを使い、scenario startから
finishまで非減少の時系列になる。component固有detailは追加できるがroot operation IDの
代わりにはならない。

## Trust boundary

1. **Release boundary:** private keyを持つのはsigningだけで、OTAはkey materialではなく
   signed packageを受け取る。
2. **Cloud-to-vehicle boundary:** TCUはschedule/retryするがpackageを正規発行物にはできない。
3. **Vehicle-bus boundary:** deliveryは各ECUへのuntrusted inputで、ECUがlocalに再検証する。
4. **Boot boundary:** image writeだけではpromotionを許可せず、health gateがactive/known-good
   pointerを制御する。
5. **Evidence boundary:** HTTP成功だけでは不十分で、相関したcomponent eventと最終ECU stateが
   必要である。

## Resource上限

各containerは0.5 CPU、96 MiB memory、64 PID、16 MiB tmpfs、read-only root filesystemを
上限とする。HTTP request body、bus delivery log、audit state、retry、同時operationはbounded
である。host pathとexternal networkはmountしない。
