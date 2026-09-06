/** Optional reference on a separate scroll surface. The live answer form stays mounted. */
import { useRef, useState } from "react";
import type { PortalSlotProps } from "@tenkacloud/portal-plugin-sdk";
import ConceptExplanation from "./ConceptExplanation.tsx";
import CoreHelpDrawer from "./HelpDrawerCore.tsx";
import QuickRules from "./QuickRules.tsx";
import TutorialWalkthrough from "./TutorialWalkthrough.tsx";

const TOPICS = ["play", "concepts", "practice", "reference"] as const;
type Topic = typeof TOPICS[number];
const LABELS = {
  ja: { play: "遊び方", concepts: "暗号を図と式で見る", practice: "一桁の穴埋めで練習", reference: "ルール一覧" },
  en: { play: "How to play", concepts: "Cryptography in diagrams and formulas", practice: "One-digit practice", reference: "Rules reference" },
} as const;

export default function BattleHelp(props: PortalSlotProps) {
  const ja = props.locale === "ja";
  const locale = ja ? "ja" : "en";
  const labels = LABELS[locale];
  const dialog = useRef<HTMLDialogElement>(null);
  const [topic, setTopic] = useState<Topic | null>(null);
  const close = () => dialog.current?.close();
  const open = (next: Topic) => { setTopic(next); dialog.current?.showModal(); };
  return <>
    <style>{`
      .tc-help-entry{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;max-width:1080px;margin:0 auto 8px;color:#16212e}
      .tc-help-entry button,.tc-help-dialog button.tc-help-control{font:inherit;font-size:13px;background:#fff;color:#245986;border:1px solid #b8c9db;border-radius:6px;padding:7px 10px;cursor:pointer}
      .tc-help-entry button:focus-visible,.tc-help-dialog button:focus-visible{outline:3px solid #0972d3;outline-offset:3px}
      .tc-help-dialog{box-sizing:border-box;width:min(960px,calc(100% - 24px));max-height:calc(100dvh - 24px);border:1px solid #b8c9db;border-radius:12px;padding:0;background:#fff;color:#16212e;overflow:auto;overscroll-behavior:contain}
      .tc-help-dialog::backdrop{background:rgb(15 28 44 / .55)}
      html:has(.tc-help-dialog[open]){overflow:hidden;scrollbar-gutter:stable}
      .tc-help-dialog header{position:sticky;top:0;z-index:1;display:flex;justify-content:space-between;align-items:center;gap:12px;padding:14px 20px;background:#fff;border-bottom:1px solid #dce3ec}
      .tc-help-dialog h2{font-size:20px;margin:0}.tc-help-content{padding:16px 20px}
      .tc-help-notice{font-size:12px;color:#526277;margin:0 0 14px}
      @media(max-width:560px){.tc-help-dialog header,.tc-help-content{padding:12px}.tc-help-entry{justify-content:flex-start}.tc-help-dialog h2{font-size:17px}}
    `}</style>
    <nav className="tc-help-entry" aria-label={ja ? "任意の解説と練習" : "Optional explanations and practice"}>
      {TOPICS.map(item => <button type="button" key={item} aria-haspopup="dialog" onClick={() => open(item)}>{labels[item]}</button>)}
    </nav>
    <dialog ref={dialog} className="tc-help-dialog" aria-labelledby="tc-help-title" onClose={() => setTopic(null)}>
      <header>
        <h2 id="tc-help-title">{topic ? labels[topic] : ""}</h2>
        <button type="button" className="tc-help-control" onClick={close}>{ja ? "閉じてお題へ戻る" : "Close and return to the Order"}</button>
      </header>
      <div className="tc-help-content">
        <p className="tc-help-notice">{ja ? "解説と練習では得点は変わりません。開始済みの試合の時間は進みます。" : "Explanations and practice do not change your score. An ongoing match keeps running."}</p>
        {topic === "play" && <QuickRules locale={locale} />}
        {topic === "concepts" && <ConceptExplanation locale={locale} embedded />}
        {topic === "practice" && <TutorialWalkthrough locale={locale} embedded onDone={close} />}
        {topic === "reference" && <CoreHelpDrawer {...props} />}
      </div>
    </dialog>
  </>;
}
