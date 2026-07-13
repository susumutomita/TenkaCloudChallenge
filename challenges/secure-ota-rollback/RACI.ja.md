# Secure OTA RACI

このmatrixは受入責任境界の開始点であり、すべてのOEMが同じ組織を使うという主張ではない。
各rowに1名のAccountable ownerがあり、証拠とhand-offをtestできるなら、学習者は異なる割当を
提案してよい。

role: **OEM** = OEM architect/product security、**Supplier** = ECU supplier、
**OTA** = OTA platform operator、**SOC** = security operations。

| Activity / decision                                  | OEM | Supplier | OTA | SOC | Evidence / acceptance test                        |
| ---------------------------------------------------- | --- | -------- | --- | --- | ------------------------------------------------- |
| 車両compatibilityとECU dependency policyを定義       | A/R | C        | C   | I   | Version/dependency contractとordered-install test |
| ECU firmwareをbuildしtarget/version/dependencyを宣言 | A   | R        | I   | I   | 再現可能artifactとmanifest review                 |
| signing対象releaseを承認                             | A/R | C        | C   | I   | このMVP外のtwo-person release record              |
| signing keyを保護しcanonical metadataへ署名          | A   | C        | R   | I   | Key custody logとsignature verification           |
| 対象車両を選びcampaignを運用                         | A   | I        | R   | I   | Campaign targetとrollout record                   |
| 配信順序、完了checkpoint、retry上限を制御            | A   | C        | R   | I   | TCU trace、retry-limit、idempotent-resume test    |
| packageをlocal検証しinactive slotへinstall           | A   | R        | C   | I   | ECU rejection testとA/B slot state                |
| boot health gateを実行しknown-goodへ復旧             | A   | R        | C   | I   | Failed-health traceとactive-slot proof            |
| telemetry相関、異常update検知、影響調査              | A   | C        | C   | R   | 1つのcorrelation timelineとincident record        |
| key失効/rotationとsupplier/cloud handoff             | A/R | C        | C   | C   | 移行/recovery計画（自動化対象外）                 |

凡例: **R** Responsible、**A** Accountable、**C** Consulted、**I** Informed。

## 必須hand-off

- SupplierからOEM: artifact identity、対象ECU、compatibility/dependency、期待health、再現可能な
  test evidence。
- OEMからsigning/OTA: 承認済みimmutable manifestとrollout authorization。
- OTA/TCUからECU: signed packageとroot correlation ID。local verificationを迂回するcommandは
  渡さない。
- ECUからOTA/SOC: acceptance/rejection理由、slot transition、active/known-good version、同じ
  root correlation ID。
- SOCからOEM/supplier/operator: timeline、障害か攻撃か、影響範囲、containment、不足証拠。

## 学習者提出物

R/Aを変更した場合は、曖昧さがどう減るか、各hand-offをどの証拠が渡るか、誰がrolloutを
停止できるかを書く。role名だけでacceptance evidenceのないmatrixは不十分である。
