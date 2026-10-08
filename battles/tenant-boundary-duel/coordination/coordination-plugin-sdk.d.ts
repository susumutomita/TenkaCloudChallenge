// Types only, copied API shape from TenkaCloud packages/coordination-plugin-sdk/src/index.ts (05ffed84).
// No runtime SDK or private game code is bundled into the participant browser.
declare module "@tenkacloud/coordination-plugin-sdk" {
  /** What the platform dispatcher hands a CoordinationPlugin for one event. */
  export interface CoordinationContext {
    readonly eventId: string;
    readonly teamIds: readonly string[];
    readonly teamNames?: Readonly<Record<string, string>>;
    readonly deploymentInputs?: Readonly<Record<string, Readonly<Record<string, string>>>>;
    readonly matchSecret?: string;
  }

  /** operation の受理可否。 不可のとき error は機械可読な短い理由コード。 */
  export type ValidateResult =
    | { readonly ok: true }
    | { readonly ok: false; readonly error: string };

  /** 問題が default export する coordination state machine. All hooks are pure functions. */
  export interface CoordinationPlugin<State, Op, Projection = unknown> {
    initialState(ctx: CoordinationContext): State;
    validateOp(state: State, teamId: string, op: Op): ValidateResult;
    applyOp(state: State, teamId: string, op: Op): State;
    readonly tickOnRequest?: boolean;
    tick?(state: State, eventNowMs: number): State;
    projectForTeam(state: State, teamId: string): Projection;
    /**
     * [Issue #659] 各 team の現在得点 (絶対値)。宣言すると platform の scoreboard へ反映される。
     * 差分ではなく絶対値なのは、plugin が権威で platform は写すだけだから (= 再送で二重加算しない)。
     */
    teamScores?(state: State): Readonly<Record<string, number>>;
    /** Public reason codes only; operation inputs and private state must never be returned. */
    scoreReasons?(
      before: State,
      after: State,
      cause:
        | { readonly kind: "op"; readonly teamId: string; readonly op: Op }
        | { readonly kind: "tick" },
    ): Readonly<Record<string, string>>;
    /**
     * [Issue #679 / TenkaCloud#3150] この plugin が読み書きする state の schema 版。
     * 省略時は 1 とみなす。State の形を変えたら必ず上げる -- 上げ忘れは platform 側では
     * 検出できない (「宣言された版差」しか見えない)。
     */
    readonly stateSchemaVersion?: number;
    /**
     * [Issue #679 / TenkaCloud#3150] `fromVersion` の版で書かれた state を、この plugin の
     * `stateSchemaVersion` へ持ち上げる純関数。`stateSchemaVersion` が 2 以上を宣言する
     * plugin は必須 -- 持たない plugin は load 時点で拒否される。ctx は渡らない
     * (matchSecret のような秘密材料が移行の入力に紛れ込まないようにするための意図的な設計)。
     * throw したら platform はその行に一切触れない (initialState を呼ばない、write しない、
     * reset しない)。
     */
    migrateState?(state: unknown, fromVersion: number): State;
  }

  export type DispatchResult<State> =
    | { readonly ok: true; readonly state: State }
    | { readonly ok: false; readonly error: string };

  export function dispatchOp<State, Op>(
    plugin: CoordinationPlugin<State, Op>,
    state: State,
    teamId: string,
    op: Op,
  ): DispatchResult<State>;

  export function runTick<State, Op>(
    plugin: CoordinationPlugin<State, Op>,
    state: State,
    eventNowMs: number,
  ): State;

  export function defineCoordinationPlugin<State, Op, Projection = unknown>(
    plugin: CoordinationPlugin<State, Op, Projection>,
  ): CoordinationPlugin<State, Op, Projection>;

  export function safeProjectForTeam<State, Op, Projection>(
    plugin: CoordinationPlugin<State, Op, Projection>,
    state: State,
    teamId: string,
    fallback: Projection,
  ): Projection;
}
