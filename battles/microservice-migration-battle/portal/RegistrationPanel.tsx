/**
 * ADR-012 Phase 5 / ADR-028 (#1420): microservice-migration-battle 専用 RegistrationPanel plugin。
 *
 * 競技者が users / orders / catalog の 3 slot を順次 Lambda / ECS / App Runner に移行する際、
 * 切り出した service の URL を override として登録する form。 form は label 表示のみで、
 * 実際の override 反映は portal API (= POST /portal/me/problems/<id>/endpoints/<slot>) を
 * 叩く必要がある (= Phase 5 では link 案内のみ、 form 送信は Phase 6 で integrate)。
 *
 * #1420 で **サービスルーターへの公開登録** を追加。 切り出した service の公開 URL を
 * `props.coordinationClient.submitOp({ kind: "register", service, url })` で coordination
 * dispatcher に登録すると、 全チームの StatusPanel の route directory に反映される (= 簡易
 * service mesh)。 portal が team の credential で client を束縛するので plugin は URL/token を
 * 持たない (= 認証は infra 層、 INVARIANT_AUTH_INJECTED_AT_INFRA_LAYER 準拠)。 未配線
 * (= client undefined) の環境では section ごと出さない (= fail-closed)。
 *
 * 設計判断: 本 plugin は instructional purpose + coordination 登録に絞る。 endpoint override の
 * 実際の input form は portal の標準 EndpointOverrideForm 経由 (= Phase 3.A で実装済) を使う想定。
 * plugin 側で別 form を実装すると 2 重メンテになるので避ける。 plain HTML + inline style で書く
 * (= Cloudscape は portal 本体側が provide、 plugin で import すると bundle 二重化する)。
 */

import type { PortalSlotProps } from "@tenkacloud/portal-plugin-sdk";
import { useState } from "react";

/** router.ts (coordination plugin) が受け付ける service 名。 register op の service field に渡す。 */
const SERVICES = ["users", "orders", "catalog"] as const;

export default function RegistrationPanel(props: PortalSlotProps) {
  const { endpoints, coordinationClient } = props;
  const [service, setService] = useState<string>(SERVICES[0]);
  const [url, setUrl] = useState<string>("");
  const [result, setResult] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);

  const register = async () => {
    if (!coordinationClient || submitting) return;
    setSubmitting(true);
    setResult(null);
    const outcome = await coordinationClient.submitOp({ kind: "register", service, url });
    // discriminated union を message に写す (= ok は directory 反映、 rejected は理由表示)。
    setResult(
      outcome.kind === "ok"
        ? "登録しました (route directory に反映されます)"
        : outcome.kind === "rejected"
          ? `登録できません: ${outcome.error}`
          : `coordination: ${outcome.kind}`,
    );
    setSubmitting(false);
  };

  return (
    <section
      style={{
        border: "1px solid #d5dbdb",
        borderRadius: "8px",
        padding: "16px",
        background: "#fff8e5",
      }}
    >
      <h3 style={{ margin: "0 0 12px 0", fontSize: "16px" }}>
        Microservice Migration — Endpoint Registration
      </h3>
      <p style={{ margin: "0 0 12px 0", fontSize: "13px", color: "#414d5c" }}>
        各 slot を切り出したら override で登録すると、 scoring engine が新 endpoint に
        切り替わります。 登録は portal の標準 "Endpoint override" form から行います。
      </p>
      <ul style={{ margin: "0", paddingLeft: "20px", fontSize: "13px" }}>
        {endpoints.map((ep) => (
          <li key={ep.slot} style={{ marginBottom: "4px" }}>
            <strong>{ep.label ?? ep.slot}</strong>
            {ep.description && <span style={{ color: "#5f6b7a" }}>: {ep.description}</span>}
          </li>
        ))}
      </ul>

      {coordinationClient && (
        <div
          style={{
            marginTop: "16px",
            paddingTop: "12px",
            borderTop: "1px solid #f0e0b0",
          }}
        >
          <h4 style={{ margin: "0 0 8px 0", fontSize: "13px", color: "#0972d3" }}>
            サービスルーターに登録 (他チームと共有)
          </h4>
          <p style={{ margin: "0 0 8px 0", fontSize: "12px", color: "#5f6b7a" }}>
            切り出した service の公開 URL を登録すると、 全チームの route directory に表示されます。
          </p>
          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
            <select
              aria-label="service"
              value={service}
              onChange={(e) => setService(e.target.value)}
              style={{ padding: "4px 8px", fontSize: "13px" }}
            >
              {SERVICES.map((svc) => (
                <option key={svc} value={svc}>
                  {svc}
                </option>
              ))}
            </select>
            <input
              aria-label="service url"
              type="url"
              placeholder="https://..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              style={{ padding: "4px 8px", fontSize: "13px", flex: "1 1 220px" }}
            />
            <button
              type="button"
              onClick={() => void register()}
              disabled={submitting || url.length === 0}
              style={{ padding: "4px 12px", fontSize: "13px" }}
            >
              {submitting ? "登録中…" : "登録"}
            </button>
          </div>
          {result && (
            <p style={{ margin: "8px 0 0 0", fontSize: "12px", color: "#414d5c" }}>{result}</p>
          )}
        </div>
      )}
    </section>
  );
}
