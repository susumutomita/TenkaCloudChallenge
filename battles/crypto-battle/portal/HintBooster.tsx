import { HINT_BOOSTER_MS } from "../game/src/booster.ts";
import type { CryptoBattleProjection } from "../game/src/types.ts";

const clock = (ms: number) => `${Math.floor(Math.ceil(ms / 1000) / 60)}:${String(Math.ceil(ms / 1000) % 60).padStart(2, "0")}`;

export default function HintBooster({ projection, locale }: {
  readonly projection: CryptoBattleProjection;
  readonly locale: "ja" | "en";
}) {
  const booster = projection.hintBooster;
  if (!booster) return null; // Mixed-version server: no claim about a benefit.
  const ja = locale === "ja";
  // [Issue #926] A short match ends before the full period does.
  const untilEnd = projection.matchRemainingMs !== undefined
    && projection.matchRemainingMs - (booster.startsInMs ?? booster.startAfterMs) < HINT_BOOSTER_MS;
  const period = ja ? untilEnd ? "試合終了まで" : "10分間"
    : untilEnd ? "no hint penalties until the match ends" : "10 minutes without hint penalties";
  const message = booster.status === "active"
    ? ja ? `ヒントの減点なし · 残り ${clock(booster.remainingMs)}` : `No hint penalty · ${clock(booster.remainingMs)} left`
    : booster.status === "unavailable"
      ? ja ? "この試合は旧版から継続中です。終盤開始時の順位が残っていないため、ヒントは通常の減点です。"
        : "This match continued from an older version without the endgame ranking. Regular hint penalties apply."
      : booster.status === "expired"
        ? ja ? "ヒントの減点なし期間は終了しました。次のヒントの減点を確認してください。"
          : "The no-penalty period has ended. Check the next hint's penalty."
        : booster.status === "ineligible"
          ? ja ? "終盤のヒント支援は配布済みです。このチームは通常の減点です。"
            : "Endgame hint support has been distributed. Regular penalties apply to this team."
          : ja ? `開始から ${clock(booster.startAfterMs)} で、最下位のチームは${period}ヒントの減点なし。同点は全員対象、1チームの練習は対象外です。${booster.startsInMs === 0 ? "配布結果を更新中です。" : ""}`
            : `At ${clock(booster.startAfterMs)} after the start, last-place teams receive ${period}. Ties qualify; solo practice does not.${booster.startsInMs === 0 ? " Updating the distribution result." : ""}`;
  return <p className="tc-card-hint" data-testid="hint-booster" style={{ margin: "6px 0" }}>{message}</p>;
}

/** Expiry uses the same elapsed time as the Order countdown, never a new timer. */
export function ageHintBooster(projection: CryptoBattleProjection, elapsedMs: number): Pick<CryptoBattleProjection, "hintBooster" | "myContracts"> {
  const booster = projection.hintBooster;
  const expired = booster?.status === "active" && elapsedMs >= booster.remainingMs;
  return {
    ...(booster ? { hintBooster: { ...booster,
      startsInMs: booster.startsInMs === undefined ? undefined : Math.max(0, booster.startsInMs - elapsedMs),
      remainingMs: Math.max(0, booster.remainingMs - elapsedMs),
      status: expired ? "expired" : booster.status,
    } } : {}),
    myContracts: projection.myContracts.map(order => ({ ...order,
      remainingMs: Math.max(0, order.remainingMs - elapsedMs),
      hints: expired ? order.hints.map(hint => ({ ...hint, cost: hint.regularCost ?? hint.cost })) : order.hints,
    })),
  };
}
