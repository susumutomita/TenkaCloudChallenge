import { useEffect, useMemo, useState } from "react";
import type { PortalCoordinationClient, PortalCoordinationOutcome, PortalSlotProps } from "@tenkacloud/portal-plugin-sdk";
import { isCryptoBattleProjection, usePolledProjection } from "./coordination.ts";
import { submitFhe, submitHunt, submitHuntNonce, submitLeak, submitMpc, submitProve, submitRotate } from "./RegistrationPanelCore.tsx";
import { taskDetail, taskLabel } from "./orderTask.ts";
import type { ContractProjection, CryptoBattleProjection } from "../game/src/types.ts";

type Locale = "ja" | "en";
type FeedbackKind = "leak" | "prove" | "hunt" | "rotate" | "error";

interface Feedback {
  readonly kind: FeedbackKind;
  readonly title: string;
  readonly body: string;
}

const COPY = {
  en: {
    title: "MAKE A MOVE",
    selectOrder: "1. PICK AN ORDER",
    noOrder: "No Order is open right now.",
    choose: "2. CHOOSE ONE",
    leak: "LEAK",
    leakHint: "FAST / PUBLIC",
    prove: "PROVE",
    proveHint: "COMPUTE / PROTECTED",
    proveOpen: "Enter proof",
    constraintNone: "any method",
    constraintNoRaw: (methods: readonly string[]) =>
      `${methods.join(" / ").toUpperCase()} only — the raw value must not be published`,
    methodBlocked: "This Order does not accept LEAK.",
    commitment: "commitment",
    response: "response",
    hunt: "HUNT FROM LEDGER",
    huntHint: "Pick a team / generation you inspected in the Public Ledger.",
    noHuntTarget: "No opponent share is public yet.",
    recovered: "recovered secret",
    rotate: "ROTATE",
    rotateHint: "Switch to a fresh generation.",
    send: "SUBMIT",
    running: "SUBMITTING…",
    leakSuccess: "LEAK SUCCESS",
    leakBody: (points: number, shares: readonly number[]) => `+${points} · share ${shares.map((x) => `#${x}`).join(", ")} → PUBLIC LEDGER`,
    proveSuccess: "PROVE SUCCESS",
    proveBody: (points: number) => `+${points} · SHARE PROTECTED`,
    huntSuccess: "HUNT SUCCESS",
    huntBody: "Recovered secret accepted.",
    rotateSuccess: "ROTATE",
    rotateBody: (from: number, to: number) => `GEN ${from} → GEN ${to}`,
    rejected: "REJECTED",
    unavailable: "The match service is unavailable.",
    ended: "MATCH ENDED",
    fheTitle: "ENCRYPTED ADDITION",
    fheHelp: "Add the two ciphertexts position by position, then take the remainder mod p. You never see the numbers inside — and you do not need to.",
    fheInputs: "the Order's ciphertexts",
    fheAnswerR: "your answer: left part",
    fheAnswerY: "your answer: right part",
    fhe: "SUBMIT CIPHERTEXT",
    fheHint: "COMPUTE / NOTHING REVEALED",
    fheSuccess: "FHE SUCCESS",
    fheBody: (points: number) => `+${points} · ADDED WITHOUT DECRYPTING`,
    mpcTitle: "MASKED SUBTOTAL",
    mpcHelp: "Take your own number, add the two masks the other offices sent you, subtract the two you sent them, then take the remainder mod p. This subtotal is the only thing YOU submit; once the Order completes the ledger shows all three offices' subtotals and the total. Your own number never appears.",
    mpcMine: "your number (private)",
    mpcIncoming: "masks received",
    mpcOutgoing: "masks sent",
    mpcAnswer: "your masked subtotal",
    mpc: "SUBMIT SUBTOTAL",
    mpcHint: "COMPUTE / INPUT STAYS PRIVATE",
    mpcSuccess: "MPC SUCCESS",
    mpcBody: (points: number) => `+${points} · YOUR NUMBER STAYED PRIVATE`,
    prime: "p (the modulus)",
    huntNonce: "NONCE-REUSE HUNT",
    huntNonceHint: "Find two of one team's proof rows, same generation, same commitment — then the key is recoverable. Enter the key you worked out.",
    noNonceTarget: "No other team has posted a proof yet.",
    recoveredKey: "recovered key",
    huntNonceSuccess: "HUNT SUCCESS",
    huntNonceBody: "Recovered key accepted — nonce reuse punished.",
  },
  ja: {
    title: "MAKE A MOVE",
    selectOrder: "1. ORDER を選ぶ",
    noOrder: "現在 open な Order はありません。",
    choose: "2. どちらかを選ぶ",
    leak: "LEAK",
    leakHint: "速い / 公開",
    prove: "PROVE",
    proveHint: "計算 / 守る",
    proveOpen: "proof を入力",
    constraintNone: "方法は自由",
    constraintNoRaw: (methods: readonly string[]) =>
      `${methods.join(" / ").toUpperCase()} のみ — 生の値を公開してはいけない`,
    methodBlocked: "この Order は LEAK を受け付けません。",
    commitment: "commitment",
    response: "response",
    hunt: "LEDGER から HUNT",
    huntHint: "Public Ledger で見つけた相手チーム / 世代を選びます。",
    noHuntTarget: "まだ相手の share は公開されていません。",
    recovered: "復元した secret",
    rotate: "ROTATE",
    rotateHint: "新しい世代へ切り替えます。",
    send: "SUBMIT",
    running: "送信中…",
    leakSuccess: "LEAK SUCCESS",
    leakBody: (points: number, shares: readonly number[]) => `+${points} · share ${shares.map((x) => `#${x}`).join(", ")} → PUBLIC LEDGER`,
    proveSuccess: "PROVE SUCCESS",
    proveBody: (points: number) => `+${points} · SHARE PROTECTED`,
    huntSuccess: "HUNT SUCCESS",
    huntBody: "復元した secret が受理されました。",
    rotateSuccess: "ROTATE",
    rotateBody: (from: number, to: number) => `世代 ${from} → 世代 ${to}`,
    rejected: "REJECTED",
    unavailable: "試合サービスに接続できません。",
    ended: "MATCH ENDED",
    fheTitle: "暗号文のまま足す",
    fheHelp: "2つの暗号文を、左どうし・右どうし足して、p で割った余りにします。中の数は見えませんが、見る必要もありません。",
    fheInputs: "Order の暗号文",
    fheAnswerR: "答え: 左の値",
    fheAnswerY: "答え: 右の値",
    fhe: "暗号文を提出",
    fheHint: "計算 / 何も明かさない",
    fheSuccess: "FHE SUCCESS",
    fheBody: (points: number) => `+${points} · 復号せずに足した`,
    mpcTitle: "覆面をかけた小計",
    mpcHelp: "自分の数に、他の2拠点から届いた覆面を足し、自分が送った2つの覆面を引いて、p で割った余りにします。あなたが提出するのはこの小計だけです。依頼完了後の ledger には 3 拠点ぶんの小計と合計が並びます。あなたの数字そのものは出ません。",
    mpcMine: "自分の数 (非公開)",
    mpcIncoming: "受け取った覆面",
    mpcOutgoing: "送った覆面",
    mpcAnswer: "覆面をかけた小計",
    mpc: "小計を提出",
    mpcHint: "計算 / 自分の数は出ない",
    mpcSuccess: "MPC SUCCESS",
    mpcBody: (points: number) => `+${points} · 自分の数は公開されていない`,
    prime: "p (割る数)",
    huntNonce: "nonce 再利用 HUNT",
    huntNonceHint: "同じチーム・同じ世代で commitment が同じ proof 2 行を Ledger から探してください。見つかれば鍵を計算で求められます。求めた鍵を入力してください。",
    noNonceTarget: "まだ proof を出した他チームはいません。",
    recoveredKey: "復元した鍵",
    huntNonceSuccess: "HUNT SUCCESS",
    huntNonceBody: "復元した鍵が受理されました — nonce の使い回しを突きました。",
  },
} as const;

function outcomeError(outcome: PortalCoordinationOutcome, locale: Locale): string {
  if (outcome.kind === "rejected") return outcome.error;
  if (outcome.kind === "not_configured") return locale === "ja" ? "coordination が未設定です。" : "Coordination is not configured.";
  return COPY[locale].unavailable;
}

function liveProjection(outcome: PortalCoordinationOutcome): CryptoBattleProjection | undefined {
  return outcome.kind === "ok" && isCryptoBattleProjection(outcome.projection) ? outcome.projection : undefined;
}

function isClosed(projection: CryptoBattleProjection | null): boolean {
  return Boolean(projection && (projection.phase === "ended" || (projection.matchRemainingMs ?? 1) <= 0));
}

function openOrders(projection: CryptoBattleProjection | null): readonly ContractProjection[] {
  if (!projection || isClosed(projection)) return [];
  return projection.myContracts.filter((order) => order.status === "open" && order.remainingMs > 0);
}

function ledgerTargets(projection: CryptoBattleProjection | null) {
  if (!projection) return [];
  const seen = new Set<string>();
  const targets: { teamId: string; generation: number; shareIndices: number[] }[] = [];
  for (const entry of projection.publicLedger) {
    if (entry.kind !== "share" || entry.teamId === projection.vault.teamId) continue;
    const key = `${entry.teamId}:${entry.generation}`;
    let target = targets.find((candidate) => `${candidate.teamId}:${candidate.generation}` === key);
    if (!target) {
      target = { teamId: entry.teamId, generation: entry.generation, shareIndices: [] };
      targets.push(target);
    }
    const indexKey = `${key}:${entry.shareIndex}`;
    if (!seen.has(indexKey)) {
      seen.add(indexKey);
      target.shareIndices.push(entry.shareIndex);
    }
  }
  return targets;
}

/**
 * [Issue #645 Phase 5] Teams a nonce HUNT can be aimed at: every OTHER team
 * that has posted a proof, with the generation a hunt would have to name.
 *
 * What this deliberately does NOT do is decide whether any of them is
 * exploitable. An earlier version scanned for two proof rows sharing a
 * commitment and listed only the teams where it found one — so the card went
 * from "no team has reused a commitment" to naming a target at the exact
 * moment the reuse appeared, which is the Portal announcing the ledger pattern
 * the participant is supposed to notice. #486's rule (restated in #646's
 * non-goals) forbids exactly that, and the old code said so in its own
 * docstring while doing the opposite.
 *
 * `ledgerTargets` above is the precedent: it lists every team that has leaked
 * anything and shows WHICH indices, and leaves "is that enough to reconstruct"
 * to the participant. This is the same shape — the ledger table already shows
 * every proof's team, generation, Order and commitment, so spotting a
 * duplicate is a reading the participant does, not a verdict the UI hands
 * them. All this saves is retyping a team id.
 *
 * Using each team's CURRENT generation is also what makes a stale target
 * impossible: `validateOp` refuses any other generation, so there is nothing
 * here that can be offered and then refused.
 *
 * Exported for `game/src/portal.test.ts`: `renderToStaticMarkup` never runs
 * the effect that would populate the panel.
 */
export function nonceHuntCandidates(
  projection: CryptoBattleProjection | null,
): { teamId: string; generation: number }[] {
  const found: { teamId: string; generation: number }[] = [];
  if (!projection) return found;
  for (const entry of projection.publicLedger) {
    if (entry.kind !== "proof" || entry.teamId === projection.vault.teamId) continue;
    const generation = projection.teams[entry.teamId]?.generation;
    if (generation === undefined || generation !== entry.generation) continue;
    if (found.some((t) => t.teamId === entry.teamId)) continue;
    found.push({ teamId: entry.teamId, generation });
  }
  return found;
}

const CSS = `
.tc-move-shell{border:2px solid #202b3c;border-radius:12px;padding:12px;background:#f8fafc;display:grid;gap:12px;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.tc-move-title{font-size:12px;font-weight:900;letter-spacing:.12em}
.tc-order-picks{display:flex;gap:7px;overflow-x:auto;padding-bottom:4px}
.tc-order-pick{min-width:150px;border:1px solid #b6c2cf;border-radius:9px;padding:8px;background:#fff;cursor:pointer;text-align:left}
.tc-order-pick[aria-pressed="true"]{border:2px solid #0972d3;background:#f1f8ff;padding:7px}
.tc-order-pick strong,.tc-order-pick span{display:block}.tc-order-pick span{font-size:11px;color:#5f6b7a;margin-top:2px}
.tc-order-rule{font-size:10px;letter-spacing:.02em}
.tc-order-rule-strict{color:#7c4a03;font-weight:600}
.tc-action:disabled{opacity:.45;cursor:not-allowed}
.tc-primary-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.tc-action{border:0;border-radius:12px;padding:16px 12px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:3px;font-weight:900;font-size:18px}
.tc-action small{font-size:10px;font-weight:800;letter-spacing:.06em}
.tc-action:disabled{cursor:not-allowed;opacity:.45}
.tc-leak-button{background:#ffefd1;box-shadow:inset 0 0 0 2px #d8a657}
.tc-prove-button{background:#e7f6ec;box-shadow:inset 0 0 0 2px #69b482}
.tc-input-panel{border:1px solid #cfd8e3;border-radius:9px;padding:9px;background:#fff;display:grid;gap:6px}
.tc-input-panel input,.tc-input-panel select{padding:8px;border:1px solid #aab7c4;border-radius:6px;font-size:12px;min-width:0}
.tc-secondary-grid{display:grid;grid-template-columns:1.3fr .7fr;gap:10px}
.tc-hunt-card,.tc-rotate-card{border:1px solid #cfd8e3;border-radius:10px;padding:10px;background:#fff}
.tc-card-title{font-size:12px;font-weight:900;letter-spacing:.07em}.tc-card-hint{font-size:11px;color:#5f6b7a;margin:3px 0 8px}
.tc-target-row{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:7px}
.tc-target-chip{border:1px solid #b6c2cf;border-radius:999px;background:#fff;padding:6px 9px;cursor:pointer;font-size:11px}
.tc-target-chip[aria-pressed="true"]{background:#eef3f8;border-color:#516a84;font-weight:800}
.tc-submit-small{padding:7px 10px;border:0;border-radius:7px;background:#202b3c;color:#fff;font-weight:800;cursor:pointer}.tc-submit-small:disabled{opacity:.45;cursor:not-allowed}
.tc-feedback{border-radius:10px;padding:10px 12px;font-weight:900;animation:tc-feedback-pop .35s ease-out both}
.tc-feedback span{display:block;font-size:11px;font-weight:600;margin-top:2px}
.tc-feedback-leak{background:#fff0d6;border:1px solid #d8a657}.tc-feedback-prove{background:#e7f6ec;border:1px solid #69b482}.tc-feedback-hunt{background:#f0eaff;border:1px solid #9a7bd1}.tc-feedback-rotate{background:#e8f3ff;border:1px solid #6ba8df}.tc-feedback-error{background:#fff0f0;border:1px solid #d13212}
@keyframes tc-feedback-pop{0%{transform:translateY(7px) scale(.97);opacity:0}60%{transform:translateY(0) scale(1.02);opacity:1}100%{transform:scale(1)}}
@media(max-width:720px){.tc-primary-actions,.tc-secondary-grid{grid-template-columns:1fr}}
@media(prefers-reduced-motion:reduce){.tc-feedback{animation:none!important}}
`;

export default function FastMovePanel(props: PortalSlotProps) {
  const locale: Locale = props.locale === "ja" ? "ja" : "en";
  const copy = COPY[locale];
  const client = props.coordinationClient;
  const polled = usePolledProjection(client);
  const [projection, setProjection] = useState<CryptoBattleProjection | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [commitment, setCommitment] = useState("");
  const [response, setResponse] = useState("");
  const [proveOpen, setProveOpen] = useState(false);
  // [Issue #645] One box per component of an FHE answer, one for an MPC
  // subtotal. Kept as strings all the way to the op: these are 19-digit field
  // elements, and Number() would silently round them.
  const [fheR, setFheR] = useState("");
  const [fheY, setFheY] = useState("");
  const [mpcPartial, setMpcPartial] = useState("");
  const [huntTargetKey, setHuntTargetKey] = useState("");
  const [nonceTargetKey, setNonceTargetKey] = useState("");
  const [recoveredKey, setRecoveredKey] = useState("");
  const [recoveredSecret, setRecoveredSecret] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  useEffect(() => {
    if (polled.projection) setProjection(polled.projection);
  }, [polled.projection]);

  const orders = useMemo(() => openOrders(projection), [projection]);
  const selectedOrder = orders.find((order) => order.id === selectedOrderId) ?? orders[0];
  // [Issue #645] Read from the Order, never re-derived here: the game rules
  // decide which methods an Order accepts, and a portal that recomputed them
  // would be a second implementation free to disagree with the judge.
  const leakAllowed = selectedOrder?.allowedMethods.includes("leak") ?? false;
  const targets = useMemo(() => ledgerTargets(projection), [projection]);
  const selectedTarget = targets.find((target) => `${target.teamId}:${target.generation}` === huntTargetKey) ?? targets[0];
  const nonceTargets = useMemo(() => nonceHuntCandidates(projection), [projection]);
  const selectedNonceTarget =
    nonceTargets.find((t) => `${t.teamId}:${t.generation}` === nonceTargetKey) ?? nonceTargets[0];

  const applyOutcome = (outcome: PortalCoordinationOutcome) => {
    const next = liveProjection(outcome);
    if (next) setProjection(next);
    if (outcome.kind !== "ok") {
      setFeedback({ kind: "error", title: copy.rejected, body: outcomeError(outcome, locale) });
      return false;
    }
    return true;
  };

  const run = async (task: () => Promise<PortalCoordinationOutcome>, success: () => Feedback) => {
    if (submitting) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const outcome = await task();
      if (applyOutcome(outcome)) setFeedback(success());
    } catch {
      setFeedback({ kind: "error", title: copy.rejected, body: copy.unavailable });
    } finally {
      setSubmitting(false);
    }
  };

  if (!client) return null;
  if (!projection) return <section className="tc-move-shell"><style>{CSS}</style><div>{copy.unavailable}</div></section>;
  if (isClosed(projection)) return <section className="tc-move-shell"><style>{CSS}</style><strong>{copy.ended}</strong></section>;

  return (
    <section className="tc-move-shell" aria-label="crypto-battle-fast-moves">
      <style>{CSS}</style>
      <div className="tc-move-title">{copy.title}</div>

      <div>
        <div className="tc-card-title">{copy.selectOrder}</div>
        {orders.length === 0 ? <div className="tc-card-hint">{copy.noOrder}</div> : (
          <div className="tc-order-picks">
            {orders.map((order) => (
              <button key={order.id} className="tc-order-pick" type="button" aria-pressed={selectedOrder?.id === order.id} onClick={() => { setSelectedOrderId(order.id); setProveOpen(false); }}>
                <strong>{order.id.replace(/^.*-c/, "ORDER #")}</strong>
                <span>+{order.points} · {Math.ceil(order.remainingMs / 1000)}s</span>
                <span>{taskLabel(order.task, locale)} · {taskDetail(order.task, locale)}</span>
                {/*
                  [Issue #645] The Order's rule sits ON THE CARD, before the
                  method choice, so a participant reads the constraint while
                  picking rather than discovering it from a rejection. The card
                  states the RULE, not just the permitted method: a reader told
                  only "PROVE only" learns this Order; one told the raw value
                  must not be published learns something they can carry.
                */}
                <span className={order.privacyConstraint === "none" ? "tc-order-rule" : "tc-order-rule tc-order-rule-strict"}>
                  {/*
                    [Issue #645] The permitted methods come from the ORDER, not
                    from the constraint alone. Before the FHE and MPC tasks
                    existed, "no-raw-disclosure" always meant PROVE, and this
                    line said so literally -- which made an FHE Order announce
                    "PROVE only" for a job PROVE cannot do.
                  */}
                  {order.privacyConstraint === "none"
                    ? copy.constraintNone
                    : copy.constraintNoRaw(order.allowedMethods)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/*
        [Issue #645] The action area follows the Order's TASK. A share Order
        offers LEAK / PROVE; an encrypted-addition Order offers only the thing
        that can answer it. Showing all four buttons and rejecting three of them
        would teach a participant that the game is arbitrary, when the real rule
        is that a Schnorr proof cannot add two ciphertexts.
      */}
      {(!selectedOrder || selectedOrder.task.kind === "reveal-share") && (
      <div>
        <div className="tc-card-title">{copy.choose}</div>
        <div className="tc-primary-actions">
          {/*
            [Issue #645] LEAK is disabled, not hidden, on an Order that forbids
            raw disclosure -- and the reason is spelled out below. Hiding it
            would leave the participant wondering where the option went; showing
            it live and rejecting the submission would spend their time to teach
            them a rule the card already stated.
          */}
          <button
            type="button"
            className="tc-action tc-leak-button"
            disabled={!selectedOrder || submitting || !leakAllowed}
            title={selectedOrder && !leakAllowed ? copy.methodBlocked : undefined}
            onClick={() => selectedOrder && void run(
              () => submitLeak(client, selectedOrder.id),
              () => ({ kind: "leak", title: copy.leakSuccess, body: copy.leakBody(selectedOrder.points, selectedOrder.task.kind === "reveal-share" ? selectedOrder.task.shareIndices : []) }),
            )}
          >
            {copy.leak}<small>{copy.leakHint}</small>
          </button>
          <button type="button" className="tc-action tc-prove-button" disabled={!selectedOrder || submitting} onClick={() => setProveOpen((value) => !value)}>
            {copy.prove}<small>{copy.proveHint}</small>
          </button>
        </div>
        {selectedOrder && !leakAllowed && <div className="tc-card-hint">{copy.methodBlocked}</div>}
      </div>
      )}

      {/*
        [Issue #645 Phase 2] Everything the participant needs is on screen: the
        Order's two ciphertexts, and two boxes for the answer. The panel does
        NOT compute it for them -- the whole exercise is performing an operation
        on data you cannot read, and a "compute for me" button would delete it.
      */}
      {selectedOrder?.task.kind === "homomorphic-sum" && (
        <div className="tc-input-panel">
          <strong style={{ fontSize: "12px" }}>{copy.fheTitle} · {selectedOrder.id.replace(/^.*-c/, "ORDER #")}</strong>
          <div className="tc-card-hint">{copy.fheHelp}</div>
          <div className="tc-card-hint">{copy.fheInputs}</div>
          <ul className="tc-material-list">
            {selectedOrder.task.inputs.map((input, index) => (
              <li key={`${input.r}-${input.y}`}><code>#{index + 1} = ({input.r}, {input.y})</code></li>
            ))}
          </ul>
          <div className="tc-card-hint">{copy.prime}: <code>{projection.prime}</code></div>
          <input aria-label="fast-fhe-r" value={fheR} onChange={(event) => setFheR(event.target.value)} placeholder={copy.fheAnswerR} />
          <input aria-label="fast-fhe-y" value={fheY} onChange={(event) => setFheY(event.target.value)} placeholder={copy.fheAnswerY} />
          <button
            type="button"
            className="tc-submit-small tc-fhe-button"
            disabled={submitting || !fheR.trim() || !fheY.trim()}
            onClick={() => void run(
              () => submitFhe(client, selectedOrder.id, { r: fheR.trim(), y: fheY.trim() }),
              () => ({ kind: "prove", title: copy.fheSuccess, body: copy.fheBody(selectedOrder.points) }),
            )}
          >{submitting ? copy.running : copy.fhe}</button>
        </div>
      )}

      {/*
        [Issue #645 Phase 3] The team's own number and its four masks are shown
        here and nowhere else -- they arrive on this Order's projection because
        it belongs to this team. What leaves the browser is the subtotal only.
      */}
      {selectedOrder?.task.kind === "masked-total" && (
        <div className="tc-input-panel">
          <strong style={{ fontSize: "12px" }}>{copy.mpcTitle} · {selectedOrder.id.replace(/^.*-c/, "ORDER #")}</strong>
          <div className="tc-card-hint">{copy.mpcHelp}</div>
          <ul className="tc-material-list">
            <li>{copy.mpcMine}: <code>{selectedOrder.task.myInput}</code></li>
            <li>{copy.mpcIncoming}: <code>{selectedOrder.task.incomingMasks.join(", ")}</code></li>
            <li>{copy.mpcOutgoing}: <code>{selectedOrder.task.outgoingMasks.join(", ")}</code></li>
          </ul>
          <div className="tc-card-hint">{copy.prime}: <code>{projection.prime}</code></div>
          <input aria-label="fast-mpc-partial" value={mpcPartial} onChange={(event) => setMpcPartial(event.target.value)} placeholder={copy.mpcAnswer} />
          <button
            type="button"
            className="tc-submit-small tc-mpc-button"
            disabled={submitting || !mpcPartial.trim()}
            onClick={() => void run(
              () => submitMpc(client, selectedOrder.id, mpcPartial.trim()),
              () => ({ kind: "prove", title: copy.mpcSuccess, body: copy.mpcBody(selectedOrder.points) }),
            )}
          >{submitting ? copy.running : copy.mpc}</button>
        </div>
      )}

      {/*
        [Issue #645] Gated on the task, not only on `proveOpen`. The LEAK/PROVE
        buttons above are already task-gated, but this editor is a separate
        block: leaving it ungated let a participant open it on a share Order,
        select an FHE Order, and submit a PROVE the new Order cannot accept.
        `setProveOpen(false)` on selection is the other half — a form that
        reappears still bound to a different Order is its own surprise.
      */}
      {proveOpen && selectedOrder?.task.kind === "reveal-share" && (
        <div className="tc-input-panel">
          <strong style={{ fontSize: "12px" }}>{copy.proveOpen} · {selectedOrder.id.replace(/^.*-c/, "ORDER #")}</strong>
          <input aria-label="fast-prove-commitment" value={commitment} onChange={(event) => setCommitment(event.target.value)} placeholder={copy.commitment} />
          <input aria-label="fast-prove-response" value={response} onChange={(event) => setResponse(event.target.value)} placeholder={copy.response} />
          <button
            type="button"
            className="tc-submit-small"
            disabled={submitting || !commitment.trim() || !response.trim()}
            onClick={() => void run(
              () => submitProve(client, selectedOrder.id, { commitment: commitment.trim(), response: response.trim() }),
              () => ({ kind: "prove", title: copy.proveSuccess, body: copy.proveBody(selectedOrder.points) }),
            )}
          >{submitting ? copy.running : copy.send}</button>
        </div>
      )}

      <div className="tc-secondary-grid">
        <div className="tc-hunt-card">
          <div className="tc-card-title">{copy.hunt}</div>
          <div className="tc-card-hint">{copy.huntHint}</div>
          {targets.length === 0 ? <div className="tc-card-hint">{copy.noHuntTarget}</div> : (
            <>
              <div className="tc-target-row">
                {targets.map((target) => {
                  const key = `${target.teamId}:${target.generation}`;
                  return <button key={key} type="button" className="tc-target-chip" aria-pressed={selectedTarget ? `${selectedTarget.teamId}:${selectedTarget.generation}` === key : false} onClick={() => setHuntTargetKey(key)}>{target.teamId} · gen {target.generation} · [{target.shareIndices.join(",")}]</button>;
                })}
              </div>
              <div className="tc-input-panel">
                <input aria-label="fast-hunt-secret" value={recoveredSecret} onChange={(event) => setRecoveredSecret(event.target.value)} placeholder={copy.recovered} />
                <button
                  type="button"
                  className="tc-submit-small"
                  disabled={submitting || !selectedTarget || !recoveredSecret.trim()}
                  onClick={() => selectedTarget && void run(
                    () => submitHunt(client, selectedTarget.teamId, selectedTarget.generation, recoveredSecret.trim()),
                    () => ({ kind: "hunt", title: copy.huntSuccess, body: copy.huntBody }),
                  )}
                >{submitting ? copy.running : copy.send}</button>
              </div>
            </>
          )}
        </div>

        {/*
          [Issue #645 Phase 5] Without this the `hunt-nonce` op had no
          participant-facing sender at all: the reducer accepted it, the README
          advertised it, and nothing in the Portal could produce one.
        */}
        <div className="tc-hunt-card">
          <div className="tc-card-title">{copy.huntNonce}</div>
          <div className="tc-card-hint">{copy.huntNonceHint}</div>
          {nonceTargets.length === 0 ? <div className="tc-card-hint">{copy.noNonceTarget}</div> : (
            <>
              <div className="tc-target-row">
                {nonceTargets.map((target) => {
                  const key = `${target.teamId}:${target.generation}`;
                  return (
                    <button
                      key={key}
                      type="button"
                      className="tc-target-chip"
                      aria-pressed={selectedNonceTarget ? `${selectedNonceTarget.teamId}:${selectedNonceTarget.generation}` === key : false}
                      onClick={() => setNonceTargetKey(key)}
                    >{target.teamId} · gen {target.generation}</button>
                  );
                })}
              </div>
              <div className="tc-input-panel">
                <input aria-label="fast-hunt-nonce-witness" value={recoveredKey} onChange={(event) => setRecoveredKey(event.target.value)} placeholder={copy.recoveredKey} />
                <button
                  type="button"
                  className="tc-submit-small tc-hunt-nonce-button"
                  disabled={submitting || !selectedNonceTarget || !recoveredKey.trim()}
                  onClick={() => selectedNonceTarget && void run(
                    () => submitHuntNonce(client, selectedNonceTarget.teamId, selectedNonceTarget.generation, recoveredKey.trim()),
                    () => ({ kind: "hunt", title: copy.huntNonceSuccess, body: copy.huntNonceBody }),
                  )}
                >{submitting ? copy.running : copy.send}</button>
              </div>
            </>
          )}
        </div>

        <div className="tc-rotate-card">
          <div className="tc-card-title">{copy.rotate}</div>
          <div className="tc-card-hint">{copy.rotateHint}</div>
          <button
            type="button"
            className="tc-submit-small"
            disabled={submitting || projection.vault.rotateCooldownRemainingMs > 0}
            onClick={() => {
              const before = projection.vault.generation;
              void run(
                () => submitRotate(client),
                () => ({ kind: "rotate", title: copy.rotateSuccess, body: copy.rotateBody(before, before + 1) }),
              );
            }}
          >{projection.vault.rotateCooldownRemainingMs > 0 ? `${Math.ceil(projection.vault.rotateCooldownRemainingMs / 1000)}s` : copy.rotate}</button>
        </div>
      </div>

      {feedback && <div className={`tc-feedback tc-feedback-${feedback.kind}`}><strong>{feedback.title}</strong><span>{feedback.body}</span></div>}
    </section>
  );
}
