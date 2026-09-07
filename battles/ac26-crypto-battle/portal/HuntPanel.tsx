import RotorHunt from "./RotorHunt.tsx";
import RsaHunt from "./RsaHunt.tsx";
import type { PublicRsaKey } from "../game/src/rsa.ts";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CryptoBattleOp, CryptoBattleProjection, RpsHuntTarget, RotorPairArtifact } from "../game/src/types.ts";
import { ALL_CIPHER_RUNGS, exposedKeyPositions, validCipherKey, rungSpec, type CipherRung } from "../game/src/ladder.ts";
import { CONSTRAINT_GROUPS } from "../game/src/sudoku.ts";
import { cipherHuntCandidates, huntBudgetFor, ledgerTargets, sudokuHuntCandidates, type CipherHuntCandidate, type SudokuHuntCandidate } from "./hunt-targets.ts";
import HuntGuide from "./HuntGuide.tsx";
import { RpsHuntCandidate } from "./RpsHunt.tsx";
import { describeRevealGroup, emptyCells, parseCells, SudokuBoard, SudokuInput } from "./SudokuGrid.tsx";
import { DieRow } from "./DieFace.tsx";

type Locale = "ja" | "en";
type Mode = "share" | "sudoku" | CipherRung | "rps" | "rsa" | "rotor";
type Status = "waiting" | "ready" | "completed" | "exhausted" | "pending" | "unknown";
export interface HuntOption {
  readonly key: string; readonly teamId: string; readonly generation: number; readonly mode: Mode;
  readonly status: Status; readonly detail: { readonly ja: string; readonly en: string };
  readonly left?: number; readonly points?: number; readonly rotor?: readonly RotorPairArtifact[];
  readonly sudoku?: SudokuHuntCandidate; readonly cipher?: CipherHuntCandidate; readonly rps?: RpsHuntTarget; readonly rsa?: PublicRsaKey;
}
const labels = {
  ja: { rotor: "Rotorの初期位置", share: "シェア（秘密分散）", sudoku: "ZK数独の公開マス", caesar: "シーザー暗号", vigenere: "Vigenère暗号", rps: "じゃんけんの予測", rsa: "RSAの因数分解", waiting: "材料待ち", ready: "攻撃できる", completed: "攻撃済み", exhausted: "回数切れ", pending: "攻撃済み・開封待ち", unknown: "状態を更新中" },
  en: { rotor: "Rotor initial positions", share: "Secret shares", sudoku: "ZK Sudoku openings", caesar: "Caesar cipher", vigenere: "Vigenère cipher", rps: "RPS prediction", rsa: "RSA factorization", waiting: "Waiting for evidence", ready: "Ready to attack", completed: "Already attacked", exhausted: "No attempts left", pending: "Submitted · waiting for openings", unknown: "Refreshing status" },
};

/** Public records open a worksheet; no solver or verdict is run for the participant. */
export function huntOptions(projection: CryptoBattleProjection): readonly HuntOption[] {
  const shares = ledgerTargets(projection), sudokus = sudokuHuntCandidates(projection), ciphers = cipherHuntCandidates(projection);
  return Object.values(projection.teams).filter(team => team.teamId !== projection.vault.teamId).flatMap(team => {
    const { teamId, generation } = team;
    const budget = huntBudgetFor(projection, team), sudokuBudget = projection.sudokuHuntAttempts[teamId];
    const left = budget ? Math.max(0, budget.max - budget.spent) : undefined;
    const sudokuLeft = sudokuBudget?.generation === generation ? Math.max(0, sudokuBudget.max - sudokuBudget.spent) : undefined;
    const status = (mode: Mode, ready: boolean, remaining?: number): Status => {
      if (mode !== "rps" && projection.completedHunts === undefined) return "unknown";
      if (projection.completedHunts?.some(h => h.targetTeamId === teamId && h.generation === generation && h.via === mode)) return "completed";
      if (remaining === 0) return "exhausted";
      return ready ? "ready" : "waiting";
    };
    const entry = (mode: Mode) => ({ key: `${teamId}:${generation}:${mode}`, teamId, generation, mode });
    const indices = shares.find(t => t.teamId === teamId)?.shareIndices ?? [];
    const old = new Set(projection.publicLedger.flatMap(a => a.kind === "share" && a.teamId === teamId && a.generation !== generation ? [a.generation] : []));
    const missing = Math.max(0, projection.threshold - indices.length);
    const share: HuntOption = { ...entry("share"), left, points: projection.huntWinPoints, status: status("share", missing === 0, left), detail: {
      ja: `番号 ${indices.length ? indices.map(i => `#${i}`).join("・") : "なし"} · ${indices.length}/${projection.threshold} 個。${missing ? `あと ${missing} 個。同じ世代の別番号を、相手が公開して答えると増えます。` : "番号ごとの値を下の式に入れます。"}${old.size ? ` 旧世代 ${[...old].join("・")} の材料は使いません。` : ""} 同じ番号の重複は1個です。`,
      en: `Indices ${indices.length ? indices.join(", ") : "none"} · ${indices.length}/${projection.threshold}. ${missing ? `${missing} more: the opponent must LEAK a new index in this generation.` : "Use each value in the worksheet."}${old.size ? ` Ignore old generations ${[...old].join(", ")}.` : ""} Duplicate indices count once.`,
    }};
    const sudoku = sudokus.find(t => t.teamId === teamId);
    const tags = new Map<string, SudokuHuntCandidate["reveals"]>();
    for (const reveal of sudoku?.reveals ?? []) tags.set(reveal.tag, [...(tags.get(reveal.tag) ?? []), reveal]);
    const reused = [...tags.values()].filter(group => group.length >= 2);
    const hasRepeatedTag = reused.length > 0;
    const sudokuOption: HuntOption = { ...entry("sudoku"), sudoku, left: sudokuLeft, points: projection.huntWinPoints, status: status("sudoku", hasRepeatedTag, sudokuLeft), detail: {
      ja: `公開グループ ${sudoku?.reveals.length ?? 0} 件。${hasRepeatedTag ? "同じ印の公開マスを公開問題と照合して解きます。解を一つに決められない間は提出せず、別のマスの公開を待ちます。" : "同じ印で2回以上の公開が必要です。相手が同じ付け替え表で証明すると増えます。"} 必要な総数は固定ではありません。`,
      en: `${sudoku?.reveals.length ?? 0} opened groups. ${hasRepeatedTag ? "Compare cells with the same tag against the public puzzle. If you cannot determine one solution, wait for more opened cells before submitting." : "Need two openings with one tag, from an opponent reusing a relabelling."} There is no fixed total required.`,
    }};
    const cipherOptions = ALL_CIPHER_RUNGS.map((rung): HuntOption => {
      const cipher = ciphers.find(c => c.teamId === teamId && c.generation === generation && c.rung === rung);
      const count = new Set(projection.publicLedger.flatMap(a => a.kind === "cipher-pair" && a.teamId === teamId && a.generation === generation && a.rung === rung ? [a.contractId] : [])).size;
      const spec = rungSpec(rung);
      const positions = exposedKeyPositions(projection.publicLedger.filter(a => a.kind === "cipher-pair" && a.teamId === teamId && a.generation === generation && a.rung === rung).filter(a => a.kind === "cipher-pair"), rung);
      return { ...entry(rung), cipher, points: spec.huntBonus, status: status(rung, !!cipher), detail: rung === "vigenere" ? {
        ja: `周期3 · 公開された鍵の位置：${positions.map(p => p + 1).join("・") || "なし"}（${positions.length}/3）。${cipher ? "各位置を引き算し、鍵1・2・3の順で入力します。" : "異なる3位置の公開を待ちます。同じ位置だけ増えても残りの鍵は決まりません。"}`,
        en: `Period 3 · published key positions: ${positions.map(p => p + 1).join(", ") || "none"} (${positions.length}/3). ${cipher ? "Subtract at each position; enter keys 1, 2, 3 in order." : "Wait for all three distinct positions. Repeating one position does not determine the others."}`,
      } : {
        ja: `元の列と暗号化した列 ${count}/${spec.pairsToBreak} 組。${cipher ? "同じ位置の数字を引いて鍵を計算できます。" : `あと ${Math.max(0,spec.pairsToBreak-count)} 組。相手がこの方式のお題を公開して答えると増えます。`}`,
        en: `Plaintext/ciphertext pairs ${count}/${spec.pairsToBreak}. ${cipher ? "Subtract matching positions to recover the key." : `${Math.max(0,spec.pairsToBreak-count)} more: wait for the opponent to LEAK this cipher's Order.`}`,
      }};
    });
    const rps = projection.rpsHunt?.targets.find(t => t.targetTeamId === teamId && t.generation === generation && t.remainingMs > 0);
    const pending = projection.rpsHunt?.pending.some(t => t.targetTeamId === teamId);
    const lastRpsResult = projection.rpsHunt?.lastResult?.targetTeamId === teamId;
    const openings = projection.publicLedger.filter(a => a.kind === "rps-open" && a.teamId === teamId);
    const reusedR = openings.some(a => a.kind === "rps-open" && openings.some(b => b.kind === "rps-open" && a.duelId !== b.duelId && a.randomness === b.randomness));
    const rpsOption: HuntOption = { ...entry("rps"), rps, left, points: projection.rpsHunt?.winPoints, status: rps ? status("rps", true, left) : pending ? "pending" : left === 0 ? "exhausted" : lastRpsResult ? "completed" : "waiting", detail: {
      ja: rps ? "別の2対戦で同じ隠す数 r が公開され、今回の封じた数もあります。今回も同じ r という仮定で予測します。" : pending ? "予測は変更できません。両者の開封後に採点します。" : lastRpsResult ? "直近の予測は終了しました。次の対戦で、相手が数字を封じてから両者の手が公開されるまでの受付を待ちます。" : reusedR ? "過去の使い回しを確認。相手が次の数字を封じ、両者の手が公開される前の受付を待ちます。" : `過去の開封 ${openings.length} 件。別の2対戦で同じ隠す数 r が公開されることが必要です。過去の開封は世代をまたいで参照できます。`,
      en: rps ? "Two past duels reused r, and the current sealed number is available. Predict assuming reuse again." : pending ? "Prediction is final; scoring waits for both openings." : lastRpsResult ? "The latest prediction is finished. Wait for the next duel to be sealed, before both hands become public." : reusedR ? "Past reuse found. Wait for the next sealed number, before both hands become public." : `${openings.length} public openings. Need equal r in two different duels. Past openings may span generations.`,
    }};
    const rsa = projection.publicRsaKeys?.find(key => key.teamId === teamId && key.generation === generation);
    const rsaOption: HuntOption = { ...entry("rsa"), rsa, points: projection.huntWinPoints,
      status: projection.publicRsaKeys === undefined ? "unknown" : status("rsa", !!rsa), detail: {
        ja: rsa ? `公開鍵 n=${rsa.n}・e=${rsa.e}。nを異なる素数2個の積に分けて攻撃します。LEAK不要です。` : "終盤になると公開鍵が表示されます。",
        en: rsa ? `Public key n=${rsa.n}, e=${rsa.e}. Factor n into two distinct primes to attack. No LEAK needed.` : "Public keys appear in endgame.",
      } };
    const pairs = projection.publicLedger.filter((a): a is RotorPairArtifact => a.kind === "rotor-pair" && a.method === "leak" && a.teamId === teamId && a.generation === generation);
    const rotorOption: HuntOption = { ...entry("rotor"), rotor: pairs, left, points: projection.huntWinPoints,
      status: left === undefined ? "unknown" : status("rotor", pairs.length > 0, left), detail: {
        ja: `現世代の公開${pairs.length}組。${pairs.length ? "公開列から最初の車輪の位置を計算します。1組でも特定できる場合があります。" : "相手がRotorのお題をLEAKすると元と答えが公開されます。"} 候補が複数なら別の公開を待ちます。`,
        en: `${pairs.length} public pair(s) this generation. ${pairs.length ? "Calculate initial wheel positions from the rows; one pair may suffice." : "An opponent's Rotor LEAK publishes the original and answer."} Wait for more evidence if candidates remain.`,
      } };
    return [share, ...(projection.proofProtocol === "schnorr-v1" ? [] : [sudokuOption]), ...cipherOptions, rotorOption, rsaOption, rpsOption];
  });
}

type Props = { readonly projection: CryptoBattleProjection; readonly locale: Locale; readonly submitting: boolean; readonly onSubmit: (op: CryptoBattleOp) => Promise<void> };
export function huntOpponentPage(projection: CryptoBattleProjection, options: readonly HuntOption[], query: string, readyOnly: boolean, page: number) {
  const ready = new Set(options.filter(o => o.status === "ready").map(o => o.teamId));
  const search = query.trim().toLocaleLowerCase();
  const all = Object.values(projection.teams).filter(t => t.teamId !== projection.vault.teamId
    && (!readyOnly || ready.has(t.teamId)) && `${t.teamName} ${t.teamId}`.toLocaleLowerCase().includes(search))
    .sort((a, b) => Number(ready.has(b.teamId)) - Number(ready.has(a.teamId)) || a.teamId.localeCompare(b.teamId));
  const lastPage = Math.max(0, Math.ceil(all.length / 5) - 1);
  const currentPage = Math.min(Math.max(0, page), lastPage);
  return { items: all.slice(currentPage * 5, currentPage * 5 + 5), total: all.length, page: currentPage, lastPage, ready };
}

export default function HuntPanel(props: Props) {
  const { projection, locale } = props;
  const [selected, setSelected] = useState("");
  const [query, setQuery] = useState("");
  const [readyOnly, setReadyOnly] = useState(false);
  const [page, setPage] = useState(0);
  const options = useMemo(() => huntOptions(projection), [projection]);
  const listing = huntOpponentPage(projection, options, query, readyOnly, page);
  const firstTeam = listing.items[0]?.teamId;
  const choice = options.find(o => o.key === selected) ?? options.find(o => o.teamId === firstTeam && o.status === "ready") ?? options.find(o => o.teamId === firstTeam);
  // Keep the inspected team and worksheet stable when new evidence arrives.
  useEffect(() => { if (choice && choice.key !== selected) setSelected(choice.key); }, [choice?.key, selected]);
  const target = choice?.status === "ready" ? choice : undefined;
  const ja = locale === "ja", copy = labels[locale];
  const name = (id: string) => projection.teams[id]?.teamName || id;
  const readyTeams = new Set(options.filter(o => o.status === "ready").map(o => o.teamId)).size;
  const chooseTeam = (id: string) => setSelected((options.find(o => o.teamId === id && o.status === "ready") ?? options.find(o => o.teamId === id))!.key);
  return <section className="tc-hunt-entry" aria-label={ja ? "相手を攻撃する HUNT" : "Attack an opponent with HUNT"}>
    <h2>{ja ? "相手を攻撃する（HUNT）" : "Attack an opponent (HUNT)"}</h2>
    <p>{ja ? "相手を選ぶ → 公開材料で秘密を計算 → 答えを送る" : "Choose an opponent → calculate from public evidence → submit"}</p>
    <p className="tc-hunt-notice" role="status" aria-live="polite">{ja ? `材料を確認できる相手：${readyTeams}チーム。` : `Opponents with available worksheets: ${readyTeams}.`}{!readyTeams && (ja ? "材料が集まるまでは、自分のお題を進めましょう。" : "Work on your Orders while evidence accumulates.")}</p>
    <h3>{ja ? "1. 相手を選ぶ" : "1. Choose an opponent"}</h3>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
      <label>{ja ? "チーム名で検索 " : "Search teams "}<input type="search" value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} /></label>
      <label><input type="checkbox" checked={readyOnly} onChange={e => { setReadyOnly(e.target.checked); setPage(0); }} />{ja ? "材料のある相手だけ" : "With evidence only"}</label>
    </div>
    <div className="tc-hunt-opponents" style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "12px 0" }}>
      {listing.items.map(team => <button type="button" key={team.teamId} className="tc-target-chip" aria-pressed={choice?.teamId === team.teamId} onClick={() => chooseTeam(team.teamId)}>
        {name(team.teamId)} · {team.score}{ja ? "点" : "pt"} · {listing.ready.has(team.teamId) ? (ja ? "材料あり" : "Evidence available") : (ja ? "材料待ち・状況を確認" : "Waiting · inspect status")}
      </button>)}
    </div>
    {listing.total === 0 && <p role="status">{ja ? "条件に合う相手はいません。検索や絞り込みを変更してください。" : "No matching opponents. Change the search or filter."}</p>}
    {listing.lastPage > 0 && <nav aria-label={ja ? "相手一覧のページ" : "Opponent pages"}>
      <button type="button" disabled={listing.page === 0} onClick={() => setPage(listing.page - 1)}>{ja ? "前の5件" : "Previous five"}</button>
      <span> {listing.page + 1} / {listing.lastPage + 1} · {listing.total}{ja ? "チーム" : " teams"} </span>
      <button type="button" disabled={listing.page === listing.lastPage} onClick={() => setPage(listing.page + 1)}>{ja ? "次の5件" : "Next five"}</button>
    </nav>}
    {choice && <section aria-label={ja ? "選択中の相手と攻撃方法" : "Selected opponent and method"}>
      <h3>{ja ? "2. " : "2. "}{name(choice.teamId)} · {ja ? "攻撃方法と材料を確認" : "Choose a method and inspect evidence"}</h3>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{options.filter(o => o.teamId === choice.teamId).map(option => <button key={option.key} type="button" className="tc-target-chip" aria-pressed={choice.key === option.key} onClick={() => setSelected(option.key)}>{copy[option.mode]} · {(option.mode === "sudoku" || option.mode === "rotor") && option.status === "ready" ? (ja ? "材料を確認して解く" : "Inspect evidence and solve") : copy[option.status]}</button>)}</div>
      <p>{choice.detail[locale]}</p>
      {(choice.status === "completed" || choice.status === "exhausted") && <p>{ja ? "この方法では今は攻撃できません。別の方法か相手を選んでください。" : "This method is unavailable now. Choose another method or opponent."}</p>}
      {choice.status === "unknown" && <p role="status">{ja ? "攻撃済み状態を更新中です。次の更新まで操作を待ってください。" : "Refreshing completed attacks. Wait for an updated response before acting."}</p>}
      {target && <div className="tc-hunt-workspace"><h3>{ja ? "3. 材料から計算して、答えを送る" : "3. Calculate from the evidence and submit"}</h3><HuntWorkspace key={`${projection.vault.teamId}:${target.key}:${target.rps?.duelId ?? ""}`} {...props} target={target} /></div>}
    </section>}
  </section>;
}

/** Actual selected form; exported to render its gate against real projected states in tests. */
export function HuntWorkspace({ target, ...props }: Props & { readonly target: HuntOption }) {
  const { projection, locale, submitting, onSubmit } = props;
  const [answer, setAnswer] = useState("");
  const [cells, setCells] = useState<readonly string[]>(emptyCells);
  const ja = locale === "ja", name = projection.teams[target.teamId]?.teamName || target.teamId;
  if (target.status !== "ready") return null;
  if (target.rotor) return <RotorHunt {...props} target={{ ...target, pairs: target.rotor }} />;
  if (target.rsa) return <RsaHunt {...props} target={target.rsa} />;
  if (target.rps) return <RpsHuntCandidate {...props} target={target.rps} />;
  const grid = parseCells(cells);
  const validNumber = /^(0|[1-9]\d*)$/.test(answer) && answer.length <= 100;
  const limit = target.cipher ? BigInt(rungSpec(target.cipher.rung).symbols.length) : BigInt(projection.prime);
  const keyParts = answer.trim().split(/\s+/);
  const recoveredKey = target.cipher?.rung === "vigenere" ? keyParts.map(Number) : Number(answer);
  const valid = target.mode === "sudoku" ? !!grid : target.cipher
    ? keyParts.every(token => /^(0|[1-9]\d*)$/.test(token)) && validCipherKey(recoveredKey, target.cipher.rung)
    : validNumber && BigInt(answer) < limit;
  const submit = () => {
    if (!valid || submitting) return;
    const op: CryptoBattleOp = target.mode === "sudoku" && grid ? { kind: "hunt-sudoku", targetTeamId: target.teamId, generation: target.generation, solution: grid }
      : target.cipher ? { kind: "hunt-cipher", targetTeamId: target.teamId, generation: target.generation, rung: target.cipher.rung, recoveredKey }
      : { kind: "hunt", targetTeamId: target.teamId, generation: target.generation, recoveredSecret: answer };
    void onSubmit(op);
  };
  return <section className="tc-hunt-card" aria-label={`${name} · ${labels[locale][target.mode]}`}>
    <h3>{name} · {labels[locale][target.mode]} · {ja ? "世代" : "Generation"} {target.generation}</h3>
    <div className="tc-attack-flow"><span>1. {ja ? "公開材料" : "Public evidence"}</span><b aria-hidden="true">→</b><span>2. {ja ? "式・図で計算" : "Calculate"}</span><b aria-hidden="true">→</b><span>3. {ja ? "答えを入力して攻撃" : "Enter answer and attack"}</span></div>
    {target.mode === "share" && <HuntGuide projection={projection} locale={locale} target={target} />}
    {target.sudoku && <SudokuHuntGuide target={target.sudoku} locale={locale} />}
    {target.cipher && <CipherHuntGuide target={target.cipher} locale={locale} />}
    <p className="tc-hunt-confirm">{ja ? `攻撃相手：${name}（世代 ${target.generation}）` : `Target: ${name} (generation ${target.generation})`} · {target.points === undefined ? (ja ? "得点情報を更新中" : "Refreshing reward") : `+${target.points} ${ja ? "点" : "pt"}`} · {target.cipher ? (ja ? "不正解は減点0・回数制限なし、成功は1回" : "Wrong key: no deduction or attempt cap; one success") : (ja ? `不正解 −${projection.wrongHuntCost} 点（0点未満にはなりません）・残り ${target.left ?? "?"} 回` : `Miss −${projection.wrongHuntCost} (score floor 0) · ${target.left ?? "?"} attempts left`)}</p>
    {target.mode === "sudoku" ? <SudokuInput value={cells} onChange={setCells} ariaLabel={ja ? "相手の数独の解" : "Recovered opponent sudoku"} /> : <label className="tc-answer-label">{ja ? (target.cipher ? "計算した鍵" : "計算した秘密の数") : (target.cipher ? "Your recovered key" : "Your recovered secret")}<input data-testid={target.cipher ? "fast-hunt-cipher-key" : "fast-hunt-secret"} placeholder={target.cipher?.rung === "vigenere" ? (ja ? "鍵1 鍵2 鍵3（空白区切り）" : "key1 key2 key3 (spaces)") : undefined} inputMode="text" value={answer} onChange={e => setAnswer(e.target.value)} /></label>}
    <button type="button" className="tc-submit-small" disabled={submitting || !valid} onClick={submit}>{ja ? `${name}を攻撃する` : `Attack ${name}`}</button>
  </section>;
}

function CipherHuntGuide({ target, locale }: { readonly target: CipherHuntCandidate; readonly locale: Locale }) {
  const ja = locale === "ja", modulus = rungSpec(target.rung).symbols.length;
  // One public example per position keeps the worksheet bounded at three rows,
  // even when a team repeatedly LEAKs a position. A long pair can span a cycle.
  const samples = target.pairs.flatMap(pair => pair.plaintext.map((a, i) => ({
    position: ((pair.keyPosition ?? 0) + i) % rungSpec(target.rung).keyLength,
    a, b: pair.ciphertext[i]!,
  }))).filter((entry, i, entries) => entries.findIndex(other => other.position === entry.position) === i)
    .sort((a, b) => a.position - b.position);
  return <div className="tc-hunt-worksheet">
    <p>{ja ? "同じ位置で元の数字 a と暗号の数字 b を比べます。サイコロ1〜6の面を、計算では0〜5で表します。" : "Compare original a with encrypted b at the same position. Die faces 1–6 represent values 0–5."}</p>
    {target.rung === "vigenere" ? <table style={{ borderCollapse: "collapse", width: "100%", margin: "8px 0" }}>
      <thead><tr><th>{ja ? "鍵の位置" : "Key position"}</th><th>{ja ? "元 a" : "Original a"}</th><th>{ja ? "暗号 b" : "Encrypted b"}</th></tr></thead>
      <tbody>{samples.map(sample => <tr key={sample.position}>
        <th scope="row">{sample.position + 1}</th>
        <td style={{ textAlign: "center", padding: 6 }}><DieRow values={[sample.a]} size={22} /><code>{sample.a}</code></td>
        <td style={{ textAlign: "center", padding: 6 }}><DieRow values={[sample.b]} size={22} /><code>{sample.b}</code></td>
      </tr>)}</tbody>
    </table> : target.pairs.slice(0, target.pairsToBreak).map(pair => <div key={pair.id}><strong>a</strong><DieRow values={pair.plaintext} size={22} /><strong>b</strong><DieRow values={pair.ciphertext} size={22} /><code>a: {pair.plaintext.join(" ")}<br />b: {pair.ciphertext.join(" ")}</code></div>)}
    <code className="tc-hunt-formula">a → (a + k) ÷ {modulus} {ja ? "の余り" : "remainder"} = b<br />k = (b − a) ÷ {modulus} {ja ? "の余り" : "remainder"}</code>
    {target.rung === "vigenere" && <p>{ja ? "周期は3です。公開された鍵の位置ごとに式を使い、鍵1・鍵2・鍵3の順で空白区切りの3個を入力します。各位置が揃うまでは、他の位置の鍵を決められません。長い1組に3位置全部が含まれる場合は、その1組だけで回収できます。" : "The period is 3. Apply the formula at each published key position; enter keys 1, 2, 3 separated by spaces. Missing positions are undetermined. A single long pair covering all positions would suffice."}</p>}
    <p>{ja ? `kが鍵です。b−aが負なら${modulus}を足します。見本：a=4、b=1なら1−4=−3、−3+6=3。鍵は3です。同じ鍵の位置を使った、ほかの公開とも合うか確かめましょう。` : `k is the key. If b−a is negative, add ${modulus}. Example: a=4, b=1 gives 1−4=−3; −3+6=3, so k=3. Check other records using the same key position too.`}</p>
  </div>;
}

function SudokuHuntGuide({ target, locale }: { readonly target: SudokuHuntCandidate; readonly locale: Locale }) {
  const tags = [...new Set(target.reveals.map(reveal => reveal.tag))];
  return <>{tags.map(tag => {
    const reveals = target.reveals.filter(reveal => reveal.tag === tag);
    return reveals.length >= 2 ? <SudokuHuntGroup key={tag} target={{ ...target, reveals }} locale={locale} /> : null;
  })}</>;
}

function SudokuHuntGroup({ target, locale }: { readonly target: SudokuHuntCandidate; readonly locale: Locale }) {
  const ja = locale === "ja", opened = new Array<number>(16).fill(0);
  for (const reveal of target.reveals) CONSTRAINT_GROUPS[reveal.group]?.forEach((cell, i) => { opened[cell] = reveal.cells[i] ?? 0; });
  return <div className="tc-hunt-worksheet">
    <p>{ja ? "同じ印は、数字の付け替えに同じ表を使った記録です。2つの盤面は同じ位置を対応させています。点はまだ見えないマスです。" : "Equal tags mean the same relabelling table. Compare matching positions in the two boards; dots are unknown cells."}</p>
    <div className="tc-sudoku-row"><div><strong>{ja ? "元の公開問題 A" : "Original public puzzle A"}</strong><SudokuBoard cells={target.puzzle} label={`puzzle-${target.teamId}`} /></div><b aria-hidden="true">→</b><div><strong>{ja ? "同じ印の公開マス B" : "Opened cells B with one tag"}</strong><SudokuBoard cells={opened} label={`opened-${target.teamId}`} /></div></div>
    <ul className="tc-reveal-list">{target.reveals.map(r => <li key={r.id}>{describeRevealGroup(r.group, locale)} <code>{r.cells.join(" ")}</code><span className="tc-reveal-tag">{r.tag}</span></li>)}</ul>
    <ol className="tc-visual-steps"><li>{ja ? "同じ位置のAとBが見えるマスで「元の数字 → 付け替え後」の表を作ります。" : "Where both A and B are visible, record original digit → relabelled digit."}<code className="tc-hunt-formula">A → {ja ? "付け替え表" : "table"} → B<br />B → {ja ? "逆向きの表" : "inverse table"} → A</code></li>
    <li>{ja ? "見本：元が1の場所で3が公開されたら、1→3。逆に公開された3は元の1です。1→3、2→1、3→4まで分かれば、残りは4→2。各数字は1回ずつ使います。" : "Example: an original 1 opens as 3: 1→3; reverse it to recover 1 from an opened 3. If 1→3, 2→1, 3→4, the remaining mapping is 4→2. Each digit is used once."}</li>
    <li>{ja ? "表を逆にたどってBを戻し、公開問題Aと合わせます。各行・列・2×2の箱に1〜4を1回ずつ入れて、16マスの元の解を下へ入力します。公開グループが3個あるだけでは十分とは限りません。" : "Reverse the table on B and combine it with A. Fill every row, column and 2×2 box with 1–4 once each, then enter the original 16-cell solution. Three groups alone need not suffice."}</li></ol>
  </div>;
}
