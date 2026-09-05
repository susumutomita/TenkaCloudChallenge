import type { PortalSlotProps } from "@tenkacloud/portal-plugin-sdk";
import { taskDetail, taskLabel } from "./orderTask.ts";
import { usePolledProjection } from "./coordination.ts";
import { DIE_CSS, DieRow } from "./DieFace.tsx";
import { describeRevealGroup, SudokuBoard, SUDOKU_CSS } from "./SudokuGrid.tsx";
import { rungSpec } from "../game/src/ladder.ts";
import type {
  CipherPairArtifact,
  CryptoBattleProjection,
  PublicArtifact,
  ShareArtifact,
  SudokuRevealArtifact,
} from "../game/src/types.ts";

type Locale = "ja" | "en";

const COPY = {
  en: {
    title: "LIVE MATCH",
    orderBelt: "ORDER BELT",
    noOrders: "Waiting for the next Order…",
    reward: "REWARD",
    time: "TIME",
    leakRate: "pass",
    choose: "CHOOSE ONE",
    leak: "LEAK",
    leakShort: "fast / public",
    prove: "PROVE",
    proveShort: "compute / protected",
    fhe: "FHE",
    cipher: "CIPHER",
    fheShort: "add without decrypting",
    mpc: "MPC",
    mpcShort: "publish a masked subtotal",
    vault: "MY VAULT",
    generation: "GEN",
    ledger: "PUBLIC LEDGER",
    ledgerSelf: "you",
    emptyLedger: "Nothing public yet.",
    raw: "raw",
    loading: "Loading match…",
    unavailable: "Match data is unavailable.",
    score: "SCORE",
    scoreHint: "Answer an Order to gain. Let one expire and you lose points.",
    nextUp: "DUE FIRST",
    vaultOpen: "show shares",
    phase: "PHASE",
    solution: "MY SOLUTION",
    solutionHint: "Only you see this. PROVE relabels it; never send it as it is.",
    puzzle: "PUZZLE",
    tag: "relabelling",
  },
  ja: {
    title: "LIVE MATCH",
    orderBelt: "ORDER BELT",
    noOrders: "次の Order を待っています…",
    reward: "報酬",
    time: "残り",
    leakRate: "パス",
    choose: "どちらかを選ぶ",
    leak: "LEAK",
    leakShort: "速い / 公開",
    prove: "PROVE",
    proveShort: "計算 / 守る",
    fhe: "FHE",
    cipher: "CIPHER",
    fheShort: "復号せずに足す",
    mpc: "MPC",
    mpcShort: "覆面つき小計を出す",
    vault: "MY VAULT",
    generation: "世代",
    ledger: "PUBLIC LEDGER",
    ledgerSelf: "あなた",
    emptyLedger: "まだ公開情報はありません。",
    raw: "生データ",
    loading: "試合状態を読み込み中…",
    unavailable: "試合状態を取得できません。",
    score: "スコア",
    scoreHint: "ORDER に答えると増えます。期限切れにすると減ります。",
    nextUp: "締切が最短",
    vaultOpen: "かけらを見る",
    phase: "フェーズ",
    solution: "自分の解",
    solutionHint: "自分だけに見えます。PROVE は数字を付け替えて出すもので、このまま出してはいけません。",
    puzzle: "問題",
    tag: "付け替え",
  },
} as const;

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * [Issue #645] Group the Public Ledger by team and generation, splitting by the
 * artifact's METHOD rather than its `kind`.
 *
 * The two agree today, and deliberately are not read as if they always will:
 * `kind` describes an artifact's SHAPE, `method` how it was produced. Phase 2's
 * FHE ciphertext is a third shape, and the ledger's job -- #645's requirement --
 * is to show which method each team used. Switching on `method` here means that
 * lands as a new arm rather than as a rewrite of this function's meaning.
 */
interface LedgerGroup {
  teamId: string;
  generation: number;
  shares: ShareArtifact[];
  /**
   * [Issue #659] Published (plaintext, ciphertext) pairs, kept with the shares
   * rather than under `protected` — they are EXPOSURE, not protection. A
   * cipher pair is posted by LEAK and is the material that recovers a key, so
   * filing it beside the proofs would tell a reader the opposite of the truth
   * about the team that posted it.
   */
  pairs: CipherPairArtifact[];
  /**
   * [Issue #709] Opened sudoku groups. Neither exposure nor mere protection:
   * a single reveal gives nothing away, and two under one tag give a
   * relabelling away. They are shown in full -- group, digits, tag -- because
   * spotting the matching tags is the reading the HUNT asks for.
   */
  reveals: SudokuRevealArtifact[];
  /**
   * [Issue #645] Counted per artifact kind, not lumped into one "proof" bucket.
   * Before FHE and MPC existed, everything that was not a leaked share WAS a
   * proof, and this counter said so — which made the board announce "PROOF ×1"
   * for a team that had actually posted a ciphertext. #645's Public Ledger
   * requirement is that a reader can see WHICH METHOD a team used, so the board
   * has to keep them apart.
   */
  protected: Map<PublicArtifact["kind"], number>;
}

/**
 * [Issue #698] What to print for a team on the Public Ledger.
 *
 * Mirrors `exposureRows` in FastMovePanel.tsx deliberately: the two surfaces
 * name the same teams on the same screen, and naming them differently is worse
 * than naming them badly. The vault is authoritative for "is this me" for the
 * same reason it is there -- it is the projection's own statement of who is
 * reading it.
 */
function ledgerTeamLabel(
  projection: CryptoBattleProjection,
  teamId: string,
  selfLabel: string,
): string {
  if (teamId === projection.vault.teamId) return selfLabel;
  const name = projection.teams[teamId]?.teamName;
  return name && name.trim() ? name : teamId;
}

function groupLedger(ledger: readonly PublicArtifact[]): LedgerGroup[] {
  const groups = new Map<string, LedgerGroup>();
  for (const entry of ledger) {
    const key = `${entry.teamId}:${entry.generation}`;
    const current: LedgerGroup =
      groups.get(key) ?? {
        teamId: entry.teamId,
        generation: entry.generation,
        shares: [],
        pairs: [],
        reveals: [],
        protected: new Map(),
      };
    if (entry.method === "leak" && entry.kind === "share") current.shares.push(entry);
    else if (entry.kind === "cipher-pair") current.pairs.push(entry);
    else if (entry.kind === "sudoku-reveal") current.reveals.push(entry);
    else current.protected.set(entry.kind, (current.protected.get(entry.kind) ?? 0) + 1);
    groups.set(key, current);
  }
  return [...groups.values()];
}

/** The chip label for one non-share artifact kind. */
function protectedLabel(kind: PublicArtifact["kind"]): string {
  switch (kind) {
    case "proof":
      return "PROOF";
    case "ciphertext":
      return "FHE";
    case "partial":
      return "MPC";
    case "cipher-pair":
      // Unreachable: cipher pairs are exposure and are grouped with the shares
      // above, never counted here. Named rather than defaulted so adding a
      // protected artifact kind later still fails to compile until it is
      // decided.
      return "PAIR";
    case "share":
      // A share reaches this grouping only when a method other than LEAK posted
      // one, which no method does today.
      return "SHARE";
    case "sudoku-reveal":
      // Unreachable: reveals are grouped and drawn in full above.
      return "SUDOKU";
    default: {
      const exhaustive: never = kind;
      throw new Error(`protectedLabel: unknown kind ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * [Issue #659] The belt IS the picker.
 *
 * Order tickets used to be rendered twice — once here to read, once in a
 * separate host slot to choose from — and the two lists sat far apart down the
 * page. Choosing a ticket in one place and working on it in another is what
 * made the screen unintuitive: at no point were "which Order" and "what do I
 * do with it" in view together.
 *
 * Clicking a ticket here selects it, and the work surface renders directly
 * beneath. One list, one place.
 */
export function OrderBelt({
  projection,
  locale,
  selectedId,
  onSelect,
}: {
  readonly projection: CryptoBattleProjection;
  readonly locale: Locale;
  readonly selectedId?: string;
  readonly onSelect?: (id: string) => void;
}) {
  const copy = COPY[locale];
  // [Issue #659] Deadline order, soonest first.
  //
  // The belt used to render in issue order, so six cards that all look alike
  // sat in an arbitrary sequence and nothing said which one to touch. The whole
  // decision this Battle asks for is "which of these do I spend five minutes
  // on", and the only fact that forces it is how long each has left.
  const openOrders = projection.myContracts
    .filter((order) => order.status === "open" && order.remainingMs > 0)
    .slice()
    .sort((a, b) => a.remainingMs - b.remainingMs);
  return (
    <section className="tc-game-card tc-order-belt" aria-label="crypto-battle-order-belt">
      <div className="tc-section-label">{copy.orderBelt}</div>
      {openOrders.length === 0 ? (
        <div className="tc-empty">{copy.noOrders}</div>
      ) : (
        <div className="tc-order-row">
          {openOrders.map((order, index) => {
            const urgency = order.remainingMs <= 30_000 ? " tc-urgent" : "";
            // [Issue #659] Name the one to look at. Six cards that look alike,
            // in any order, answer "what is on the belt" but never "what do I
            // do now" — which is the only question a player has when the clock
            // is running. The list is sorted by deadline, so the first card is
            // the answer; saying so out loud costs one chip.
            const isNext = index === 0;
            const pct = Math.max(4, Math.min(100, (order.remainingMs / 300_000) * 100));
            return (
              <article
                className={`tc-order-card${urgency}${isNext ? " tc-order-next" : ""}${
                  selectedId === order.id ? " tc-order-selected" : ""
                }${onSelect ? " tc-order-clickable" : ""}`}
                key={order.id}
                {...(onSelect
                  ? {
                      role: "button",
                      tabIndex: 0,
                      "aria-pressed": selectedId === order.id,
                      onClick: () => onSelect(order.id),
                      onKeyDown: (event: { key: string; preventDefault: () => void }) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onSelect(order.id);
                        }
                      },
                    }
                  : {})}
              >
                <div className="tc-order-top">
                  <strong>
                    {order.id.replace(/^.*-c/, "ORDER #")}
                    {isNext ? <span className="tc-next-chip">{copy.nextUp}</span> : null}
                  </strong>
                  {/*
                    [Issue #659] Both rates on the card. Computing this Order
                    and passing on it pay different amounts, and choosing
                    between them is what the Order asks of a team -- a card that
                    shows only the higher number hides the trade until the
                    confirmation, after the choice is already made. Shown only
                    where passing is allowed at all: a `no-raw-disclosure` Order
                    has no LEAK route, so quoting a pass price would be a lie.
                  */}
                  <span className="tc-points">
                    +{order.points}
                    {order.allowedMethods.includes("leak") ? (
                      <span className="tc-points-pass"> / {copy.leakRate} +{order.leakPoints}</span>
                    ) : null}
                  </span>
                </div>
                <div className="tc-order-meta">
                  <span>{copy.time} {formatDuration(order.remainingMs)}</span>
                  <span>{taskLabel(order.task, locale)} · {taskDetail(order.task, locale)}</span>
                </div>
                {/*
                  [Issue #645] Which methods THIS Order accepts, on the card
                  that owns them.

                  Two earlier versions of this board got it wrong in opposite
                  directions. First a hardcoded LEAK / OR / PROVE, which named
                  methods an FHE Order rejects. Then the union of every open
                  Order's methods — but Orders are issued every 2 minutes and
                  live for 5, so up to three overlap, and a share Order beside
                  an FHE Order rendered "LEAK OR PROVE OR FHE" as though those
                  were interchangeable choices. They are not: each belongs to a
                  different card.

                  A method list is only ever true of ONE Order, so it lives on
                  that Order and nowhere else.
                */}
                <div className="tc-order-methods">
                  {order.allowedMethods.map((method) => (
                    <span className={`tc-method tc-method-${method}`} key={method}>
                      {copy[method]}
                    </span>
                  ))}
                </div>
                <div className="tc-timer-track" aria-hidden="true">
                  <div className="tc-timer-fill" style={{ width: `${pct}%` }} />
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function Vault({ projection, locale }: { readonly projection: CryptoBattleProjection; readonly locale: Locale }) {
  const copy = COPY[locale];
  return (
    /*
      [Issue #659] Collapsed by default.
      
      Five 19-digit numbers took a third of the board while being the thing a
      player looks at least — they matter when building a PROVE, and not
      otherwise. The generation stays visible, because ROTATE changes it and
      that IS worth noticing; the share values are one click away.
    */
    <section className="tc-game-card">
      <details className="tc-vault-details">
        <summary className="tc-section-head">
          <div>
            <div className="tc-section-label">{copy.vault}</div>
            <strong>{copy.generation} {projection.vault.generation}</strong>
          </div>
          <span className="tc-score-chip">{copy.vaultOpen}</span>
        </summary>
        <div className="tc-share-grid">
          {projection.vault.shares.map((share) => (
            <details className="tc-share-card" key={share.index}>
              <summary>#{share.index}</summary>
              <code>{share.value}</code>
            </details>
          ))}
        </div>
        {/*
          [Issue #709] The sudoku solution, beside the shares. It is the thing
          PROVE relabels, and it is private in exactly the way the shares are:
          this team's projection carries it, nobody else's does.
        */}
        <div className="tc-vault-solution">
          <div className="tc-section-label">{copy.solution}</div>
          <SudokuBoard cells={projection.vault.sudokuSolution} label="my-solution" />
          <div className="tc-scoreline-hint">{copy.solutionHint}</div>
        </div>
      </details>
    </section>
  );
}

export function Ledger({ projection, locale }: { readonly projection: CryptoBattleProjection; readonly locale: Locale }) {
  const copy = COPY[locale];
  const groups = groupLedger(projection.publicLedger);
  const lastId = projection.publicLedger.at(-1)?.id;
  return (
    <section className="tc-game-card">
      <div className="tc-section-label">{copy.ledger}</div>
      {groups.length === 0 ? (
        <div className="tc-empty">{copy.emptyLedger}</div>
      ) : (
        <div className="tc-ledger-grid">
          {groups.map((group) => (
            <article className="tc-ledger-team" key={`${group.teamId}:${group.generation}`}>
              {/*
                [Issue #698] A team is named, not identified by its ULID. The
                board printed `group.teamId` -- a 26-character opaque string
                that told a reader nothing about WHO had exposed a share, which
                is the one question the Public Ledger exists to answer. The
                reader's own row says so outright; everyone else gets the
                display name the platform resolved (#3172), falling back to the
                id only when it could not.
              */}
              <div className="tc-ledger-title">
                <strong>{ledgerTeamLabel(projection, group.teamId, copy.ledgerSelf)}</strong>
                <span>{copy.generation} {group.generation}</span>
              </div>
              <div className="tc-share-grid">
                {group.shares.map((share) => (
                  <details className={`tc-share-card tc-public${share.id === lastId ? " tc-new-public" : ""}`} key={share.id}>
                    <summary>#{share.shareIndex}</summary>
                    <code>{share.value}</code>
                  </details>
                ))}
                {/*
                  [Issue #659] A published pair, shown as the break it is. The
                  plaintext sits above its ciphertext because subtracting one
                  from the other IS the attack, and the counter says whether
                  this team's rung has already given way — which is what makes
                  「相手の段を見て狩る価値があるか判断する」 (#659 §2) something a
                  reader can actually do from the board.
                */}
                {group.pairs.map((pair) => (
                  <details
                    className={`tc-share-card tc-public${pair.id === lastId ? " tc-new-public" : ""}`}
                    key={pair.id}
                  >
                    <summary>
                      {pair.rung} {group.pairs.length}/{rungSpec(pair.rung).pairsToBreak}
                    </summary>
                    <div className="tc-pair-rows">
                      <DieRow values={pair.plaintext} size={24} />
                      <DieRow values={pair.ciphertext} size={24} />
                    </div>
                  </details>
                ))}
                {/*
                  [Issue #709] An opened group, in full: which group, its
                  four digits, and the tag naming the relabelling. Two rows
                  from one team with one tag are the reuse a hunter looks
                  for, so the tags have to be readable side by side -- and a
                  board that summarised these as "PROOF ×2" would hide the
                  one thing about them that matters.
                */}
                {group.reveals.map((reveal) => (
                  <div className={`tc-proof-card tc-reveal-card${reveal.id === lastId ? " tc-new-public" : ""}`} key={reveal.id}>
                    {describeRevealGroup(reveal.group, locale)} <code>{reveal.cells.join(" ")}</code>{" "}
                    <span className="tc-reveal-tag" title={copy.tag}>{reveal.tag}</span>
                  </div>
                ))}
                {[...group.protected.entries()].map(([kind, count]) => (
                  <div className="tc-proof-card" key={kind}>{protectedLabel(kind)} ×{count}</div>
                ))}
              </div>
              {/*
                [Issue #709] Every team's public puzzle, on its ledger card:
                the eight cells a hunter lines a reused relabelling up
                against. Public by construction, and shown for every team
                including the reader's own, so no team is singled out.
              */}
              {projection.publicPuzzles[group.teamId] ? (
                <div className="tc-ledger-puzzle">
                  <span className="tc-sudoku-caption">{copy.puzzle}</span>
                  <SudokuBoard cells={projection.publicPuzzles[group.teamId] ?? []} size={18} label={`puzzle-${group.teamId}`} />
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export const BOARD_CSS = `
${DIE_CSS}
${SUDOKU_CSS}
.tc-vault-solution{margin-top:10px;display:grid;gap:4px;justify-items:start}
.tc-reveal-card{display:inline-flex;gap:6px;align-items:center;flex-wrap:wrap}
.tc-reveal-tag{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;border:1px solid #cfd8e3;border-radius:6px;padding:1px 5px;background:#fff;font-weight:600}
.tc-ledger-puzzle{margin-top:8px;display:grid;gap:3px;justify-items:start}

/* [Issue #659] The board paints its own light surfaces, so it has to state its
   own text colour too. Without this it inherits the text colour from whatever
   the host page happens to set -- and on a dark host that is white, which
   rendered the Order id and the reward as white-on-white and washed the method
   chips out. A component that is only legible when the host picks a compatible
   colour is not self-contained; the dev harness renders these same components
   on a dark page, which is how it surfaced. */
/* [Issue #659] The shell owns its own surface, not just its own text colour.
   Declaring the colour alone fixed the white-on-white cards and broke the
   header the other way: the title and the score sit directly on the host
   page, so on a dark host they became dark-on-dark. A component that paints
   light cards has to paint the ground under them too, or it is legible only
   for hosts that happen to match. */
.tc-game-shell{display:grid;gap:12px;color:#16212e;background:#f8fafc;border-radius:12px;padding:12px;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.tc-game-header{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}
.tc-game-title{font-size:14px;font-weight:800;letter-spacing:.08em}
.tc-game-stats{display:flex;gap:6px;flex-wrap:wrap}
.tc-score-chip,.tc-phase-chip{border:1px solid #c7c7c7;border-radius:999px;padding:4px 9px;font-size:12px;background:#fff}
.tc-scoreline{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;padding:2px 2px 0}
.tc-scoreline-main{display:flex;align-items:baseline;gap:8px}
.tc-scoreline-label{font-size:11px;font-weight:800;letter-spacing:.08em;color:#5f6b7a}
.tc-scoreline-value{font-size:34px;font-weight:900;line-height:1;font-variant-numeric:tabular-nums}
.tc-scoreline-hint{font-size:11px;color:#5f6b7a}
.tc-vault-details>summary{cursor:pointer;list-style:none}
.tc-vault-details>summary::-webkit-details-marker{display:none}
.tc-vault-details[open]>summary{margin-bottom:8px}
.tc-order-next{border-color:#0972d3;box-shadow:0 0 0 2px rgba(9,114,211,.14)}
.tc-order-clickable{cursor:pointer}
.tc-order-clickable:hover{border-color:#516a84}
/* [Issue #659] The ticket you are working on, marked on the belt itself. */
.tc-order-selected{border-color:#202b3c;border-width:2px;box-shadow:0 0 0 3px rgba(32,43,60,.12)}
.tc-next-chip{margin-left:6px;font-size:9px;font-weight:800;letter-spacing:.06em;color:#0972d3;border:1px solid #9ec8ee;border-radius:999px;padding:1px 5px;vertical-align:middle;white-space:nowrap}
.tc-game-card{border:1px solid #cfd8e3;border-radius:12px;padding:12px;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.05)}
/* [Issue #677] The belt keeps its heavier border, and gives back the pixel it
   takes. Emphasis that shifts the content edge one pixel off every neighbouring
   card is read as misalignment, not as emphasis. */
.tc-order-belt{border-width:2px;padding:11px;border-color:#0972d3;background:linear-gradient(180deg,#f5fbff,#fff)}
.tc-section-label{font-size:11px;font-weight:800;letter-spacing:.12em;color:#5f6b7a;margin-bottom:8px}
.tc-section-head{display:flex;justify-content:space-between;align-items:center;gap:8px}
.tc-order-row{display:flex;gap:8px;overflow-x:auto;padding:2px 2px 8px}
.tc-order-card{min-width:180px;border:1px solid #b6d7f2;border-radius:10px;padding:10px;background:#fff;animation:tc-order-in .28s ease-out both}
.tc-order-top{display:flex;justify-content:space-between;gap:8px;align-items:center}
.tc-points{font-weight:800;font-size:13px}
.tc-points-pass{font-weight:600;font-size:11px;opacity:.7}
.tc-order-meta{display:grid;gap:2px;font-size:11px;color:#5f6b7a;margin-top:6px}
.tc-timer-track{height:5px;background:#eaeded;border-radius:999px;overflow:hidden;margin-top:8px}
.tc-timer-fill{height:100%;background:currentColor;transition:width .25s linear}
.tc-urgent{animation:tc-order-in .28s ease-out both,tc-urgent 1s ease-in-out infinite}
.tc-order-methods{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
.tc-method{font-size:10px;font-weight:800;letter-spacing:.04em;border-radius:6px;padding:2px 6px;border:1px solid #cfd8e3}
.tc-method-leak{background:#fff7e8;border-color:#e0b36a}
.tc-method-prove{background:#eef8f2;border-color:#86c89b}
.tc-method-fhe{background:#eef2fb;border-color:#7f9ad4}
.tc-method-mpc{background:#f6eefb;border-color:#a982cc}
/* [Issue #659] Without its own rule the CIPHER chip inherited no background
   and rendered as an empty white box beside LEAK -- the method looked like a
   broken element rather than a choice. */
.tc-method-cipher{background:#eaf6f8;border-color:#5fa8bb}
.tc-pair-rows{display:flex;flex-direction:column;gap:4px}
/* [Issue #659] A published pair is the material an opponent subtracts, so the
   two rows have to line up column by column and be big enough to read. At 16px
   in a wrapped flex row they were a speckled block nobody could work from. */
.tc-pair-rows .tc-die-row{flex-wrap:nowrap;gap:4px}
.tc-board-grid{display:grid;grid-template-columns:minmax(220px,.8fr) minmax(300px,1.2fr);gap:12px}
.tc-share-grid{display:flex;flex-wrap:wrap;gap:7px}
.tc-share-card{border:1px solid #b8c4ce;border-radius:8px;background:#f8fafc;min-width:54px;overflow:hidden}
.tc-share-card summary{cursor:pointer;list-style:none;font-weight:800;text-align:center;padding:8px 10px}
.tc-share-card summary::-webkit-details-marker{display:none}
.tc-share-card code{display:block;max-width:220px;overflow:auto;padding:7px;border-top:1px solid #d5dbdb;font-size:10px;background:#fff}
.tc-public{background:#fff6e8;border-color:#d8a657}
.tc-new-public{animation:tc-public-pop .8s ease-out both}
.tc-proof-card{border:1px dashed #86c89b;border-radius:8px;padding:8px 10px;font-size:11px;font-weight:800;background:#eef8f2}
.tc-ledger-grid{display:grid;gap:9px}
.tc-ledger-team{border:1px solid #eaeded;border-radius:9px;padding:9px}
.tc-ledger-title{display:flex;justify-content:space-between;gap:8px;margin-bottom:7px;font-size:12px}
/* [Issue #698] A flex item will not shrink below its content by default, so an
   unbreakable 26-character id pushed the generation chip down to one character
   per line. The name half truncates; the generation half never wraps. */
.tc-ledger-title strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tc-ledger-title span{flex:none;white-space:nowrap}
.tc-empty{padding:12px;border:1px dashed #cfd8e3;border-radius:8px;text-align:center;color:#687078;font-size:12px}
@keyframes tc-order-in{from{transform:translateX(16px);opacity:0}to{transform:translateX(0);opacity:1}}
@keyframes tc-urgent{50%{box-shadow:0 0 0 3px rgba(209,50,18,.15)}}
@keyframes tc-public-pop{0%{transform:translateY(-8px) scale(.92);opacity:.2}55%{transform:translateY(0) scale(1.08)}100%{transform:scale(1);opacity:1}}
@media(max-width:720px){.tc-board-grid{grid-template-columns:1fr}.tc-choice{flex-direction:column;gap:2px}}
@media(prefers-reduced-motion:reduce){.tc-order-card,.tc-urgent,.tc-new-public{animation:none!important}.tc-timer-fill{transition:none!important}}
`;

export function GameBoardBody({ projection, locale }: { readonly projection: CryptoBattleProjection; readonly locale: Locale }) {
  const copy = COPY[locale];
  return (
    <div className="tc-game-shell">
      <style>{BOARD_CSS}</style>
      {/*
        [Issue #659] The score is what a player checks constantly, and it was a
        12px chip in a row of three identical chips. It is now the largest thing
        on the board, next to the count of Orders still waiting — the two
        numbers that actually change while you play.
      */}
      <div className="tc-game-header">
        <div className="tc-game-title">{copy.title}</div>
        <div className="tc-game-stats">
          <div className="tc-phase-chip">{copy.phase} {projection.phase}</div>
          {projection.matchRemainingMs !== undefined && <div className="tc-phase-chip">{formatDuration(projection.matchRemainingMs)}</div>}
        </div>
      </div>
      <div className="tc-scoreline">
        <div className="tc-scoreline-main">
          <span className="tc-scoreline-label">{copy.score}</span>
          <strong className="tc-scoreline-value">
            {projection.teams[projection.vault.teamId]?.score ?? 0}
          </strong>
        </div>
        <div className="tc-scoreline-hint">{copy.scoreHint}</div>
      </div>
      <OrderBelt projection={projection} locale={locale} />
      <div className="tc-board-grid">
        <Ledger projection={projection} locale={locale} />
        <Vault projection={projection} locale={locale} />
      </div>
    </div>
  );
}

export default function GameBoard(props: PortalSlotProps) {
  const locale: Locale = props.locale === "ja" ? "ja" : "en";
  const { projection, status } = usePolledProjection(props.coordinationClient);
  if (!props.coordinationClient) return null;
  if (!projection) {
    return <div className="tc-game-card">{status ? COPY[locale].unavailable : COPY[locale].loading}</div>;
  }
  return <GameBoardBody projection={projection} locale={locale} />;
}
