import { useEffect, useState } from "react";

/** One short celebration per confirmed scored answer; no sound or blocked controls. */
export default function SuccessCelebration({ points, locale }: { readonly points: number; readonly locale: "ja" | "en" }) {
  const [active, setActive] = useState(true);
  useEffect(() => { const timer = setTimeout(() => setActive(false), 2600); return () => clearTimeout(timer); }, []);
  if (!active) return null;
  const colors = ["#2976d6", "#ffc857", "#27b889", "#ed6896"];
  return <div className="tc-success-celebration" aria-hidden="true">
    {Array.from({ length: 36 }, (_, i) => <i key={i} style={{ left: `${(i * 37) % 100}%`, background: colors[i % colors.length], animationDelay: `${(i % 6) * 70}ms`, transform: `rotate(${i * 29}deg)` }} />)}
    <div className="tc-success-burst">✓ <b>+{points}</b><small>{locale === "ja" ? "点獲得！" : "points earned!"}</small></div>
  </div>;
}

export const SUCCESS_CSS = `
.tc-success-celebration{position:fixed;inset:0;z-index:9999;pointer-events:none;overflow:hidden}.tc-success-celebration>i{position:absolute;top:-20px;width:9px;height:15px;border-radius:2px;animation:tc-success-confetti 2100ms ease-out forwards}.tc-success-burst{position:absolute;top:26%;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:12px;color:#fff;background:#126a49;padding:18px 28px;border:2px solid #a0efbc;border-radius:22px;box-shadow:0 12px 50px #143f4450;font-size:26px;white-space:nowrap;animation:tc-success-burst 2300ms ease-out both}.tc-success-burst b{font-size:48px}.tc-success-burst small{font-size:16px}
.tc-feedback.tc-feedback-reward{padding:20px 24px;border:2px solid #1d9767;background:linear-gradient(115deg,#e7fff2,#f2f8ff);color:#134b37;box-shadow:0 4px 20px #126a4915}.tc-reward-heading{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.tc-reward-icon{font-size:30px!important}.tc-reward-heading strong{font-size:26px}.tc-reward-points{font-size:34px!important;font-weight:900!important;margin-left:auto}.tc-feedback-total{font-size:14px!important;margin:8px 0!important}.tc-feedback-reward>span{font-size:13px;line-height:1.6}.tc-feedback-reward .tc-why{margin-top:12px}.tc-feedback-reward button{margin-top:12px}.tc-feedback-reward .tc-feedback-attempt{font-size:10px}
@keyframes tc-success-confetti{to{transform:translateY(110vh) rotate(600deg);opacity:0}}
@keyframes tc-success-burst{0%{opacity:0;scale:.75}15%,75%{opacity:1;scale:1}100%{opacity:0;scale:1.05}}
@media(prefers-reduced-motion:reduce){.tc-success-celebration{display:none}.tc-feedback{animation:none!important}}
@media(max-width:480px){.tc-feedback.tc-feedback-reward{padding:16px}.tc-reward-heading strong{font-size:22px}.tc-reward-points{font-size:28px!important}.tc-success-burst{padding:14px 18px;gap:8px}.tc-success-burst b{font-size:38px}}
`;
