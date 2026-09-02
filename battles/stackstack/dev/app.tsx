import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { PortalLocale } from "@tenkacloud/portal-plugin-sdk";
import StatusPanel from "../portal/StatusPanel.tsx";
import { SCENARIO_IDS, SCENARIO_LABELS, scenarioProps, type ScenarioId } from "./scenarios.ts";

function App() {
  const [scenario, setScenario] = useState<ScenarioId>("unregistered");
  const [locale, setLocale] = useState<PortalLocale>("ja");
  return (
    <>
      <header className="dev-chrome">
        <strong>DEV HARNESS</strong>
        <label>
          状態
          <select value={scenario} onChange={(event) => setScenario(event.target.value as ScenarioId)}>
            {SCENARIO_IDS.map((id) => <option key={id} value={id}>{SCENARIO_LABELS[id][locale]}</option>)}
          </select>
        </label>
        <label>
          言語
          <select value={locale} onChange={(event) => setLocale(event.target.value as PortalLocale)}>
            <option value="ja">ja</option>
            <option value="en">en</option>
          </select>
        </label>
      </header>
      <div className="dev-banner">ローカル表示確認専用です。AWS・採点・認証・チーム分離は再現しません。</div>
      <main><StatusPanel {...scenarioProps(scenario, locale)} /></main>
    </>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
createRoot(root).render(<App />);
