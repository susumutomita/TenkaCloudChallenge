import type { Locale, Projection as WireProjection } from "../game/types.ts";
export function localizeProjection(p: WireProjection, locale: Locale) {
  const texts = (lines: { ja: string; en: string }[]) => lines.map(line => line[locale]);
  return { ...p, me: { ...p.me, feedback: texts(p.me.feedback), previews: p.me.previews.map(v => ({ ...v, facts: texts(v.facts) })) }, claims: p.claims.map(c => ({ ...c, facts: texts(c.facts) })), ledger: p.ledger.map(e => ({ ...e, text: texts(e.text) })) };
}
