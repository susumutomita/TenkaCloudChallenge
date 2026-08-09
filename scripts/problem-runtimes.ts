/**
 * runtime と game style を別の軸として扱うための表 (Issue 388)。
 *
 * ## なぜ 2 軸なのか
 *
 * 2026-08-06 に初見の利用者へ作問を試してもらったところ、`local mode` は「クラウド以外も
 * 含めて何でもできるもの」と受け取られ、`cloud mode` では「クラウドらしい問題にしなければ」
 * と考えたので題材を発想しやすかった、という反応が出た。**実行環境の制約は創作の邪魔では
 * なく、何を問題にするかを決める足場になっている。**
 *
 * ところが作問の入口は `battles|challenges` から始まっていた。これは競技・採点の形式であって
 * 実行 runtime ではない。2 つの軸が 1 つの選択に潰れているので、Docker で足りる問題を作りたい
 * 人が CloudFormation の starter から始める、ということが起きる。
 *
 * この file は「どの runtime か」と「Challenge か Battle か」を独立に持ち、その組み合わせに
 * 対して**実際に存在する** starter だけを返す。存在しない組み合わせは、動くように見える雛形を
 * 作らずに断る。
 *
 * ## starter を新設せず既存問題から選ぶ理由
 *
 * scaffold は「動いている問題を複製する」形で、複製元は catalog の gate を通り続けている。
 * 専用の starter を別に置くと、それだけが誰にも遊ばれないまま腐る。runtime ごとに**その
 * runtime で最も小さい実在の問題**を指す方が、starter が壊れたことに誰かが気付く。
 */

export type Style = "challenge" | "battle";
export type Category = "battles" | "challenges";

export interface RuntimeDeclaration {
  readonly provider: string;
  readonly engine: string;
  readonly entry: string;
}

export interface RuntimeSpec {
  /** 今この repository で deploy まで通る runtime か。 */
  readonly executable: boolean;
  /** style ごとの複製元。存在しない組み合わせは undefined。 */
  readonly starters: Partial<Record<Style, string>>;
  /**
   * starter が `runtime` を宣言していない場合に書き込む宣言。
   *
   * CloudFormation 問題は legacy の `cfnTemplate` から正規化される (= 宣言が無くても動く) が、
   * 無いままだと生成物に「この問題はなぜ実クラウドなのか」が残らない。明示して書く。
   */
  readonly declare?: RuntimeDeclaration;
  /** 実行できない runtime を選ばれたときに出す現況。 */
  readonly status?: string;
  /** 1 行の使いどころ。CLI の一覧と docs の両方から使う。 */
  readonly whenToUse: string;
  /** runtime を選んだ後に題材を絞るための問い。答えを生成する機能ではない。 */
  readonly narrowing: readonly string[];
  /** その runtime を選んだ場合に追加で成立条件になるもの。 */
  readonly extraConditions: readonly string[];
}

export const RUNTIMES: Readonly<Record<string, RuntimeSpec>> = {
  "docker/compose": {
    executable: true,
    // sqli-demo は docker/compose 問題のうち最小 (Dockerfile + server 1 枚 + compose)。
    // battle は stackstack-gameday しか無く、7 工程の大きな問題なので starter としては重い。
    // 軽い docker battle が生まれたらそちらへ差し替える。
    starters: { challenge: "sqli-demo", battle: "stackstack-gameday" },
    whenToUse:
      "コンテナの中で本質を再現できる題材。Web アプリ、API、DB、ファイル、設定、ログ、" +
      "認可不備、運用ミス、Linux process / network / 可観測性 / 復旧操作。",
    narrowing: [
      "消し忘れたファイルや、有効なままの設定はあるか",
      "認証を通った後に、別ユーザーのデータへ触れてしまわないか",
      "ログや監視が無く、故障原因を特定できない状態を作れるか",
    ],
    extraConditions: [
      "参加者が触る面はコンテナの中で完結し、外向き通信を要求しない",
      "healthcheck と resource limit を宣言する",
      "`/verify` (または multi-verify) の contract を持つ",
    ],
  },
  "aws/cloudformation": {
    executable: true,
    starters: { challenge: "hello-world", battle: "hello-world-battle" },
    declare: { provider: "aws", engine: "cloudformation", entry: "template.yaml" },
    whenToUse:
      "学習目標が provider 固有の control plane や managed service の意味論に依存する場合。" +
      "IAM policy evaluation、AssumeRole、ExternalId、VPC / SG / route / endpoint、" +
      "CloudFormation lifecycle、managed DB / queue / event / logging / autoscaling。",
    narrowing: [
      "IAM、network、managed service、eventual consistency のどれを体験させたいか",
      "Console / CLI / IaC のどの観察が解法の核心か",
      "**実クラウドでなければ成立しない理由**は何か (無ければ docker/compose で足りる)",
    ],
    extraConditions: [
      "standing cost と、問題終了後に課金が残らないこと (cleanup)",
      "参加者 role が least privilege であること",
      "region 差と quota に当たらないこと",
      "同じ template を何度 deploy しても同じ問題になること (再現性)",
    ],
  },
  composite: {
    executable: true,
    // 複合 runtime の実例は hello-multicloud だけ。battle の実例は無い。
    starters: { challenge: "hello-multicloud" },
    whenToUse:
      "学習目標が control plane と実 workload の**両方**にまたがる場合だけ。単一 runtime で" +
      "成立する問題を不必要に composite にしない。",
    narrowing: [
      "component ごとの責務と採点境界を言えるか",
      "単一 runtime で足りない理由は何か (これを design note に残す)",
    ],
    extraConditions: [
      "component ごとの ownership、network、secret、採点境界を明示する",
      "`scoring.targets[].targetId` が `runtime.targets[].id` に実在する",
    ],
  },
  "simulator/aws": simulator("aws"),
  "simulator/azure": simulator("azure"),
  "simulator/gcp": simulator("gcp"),
  "simulator/sakura": simulator("sakura"),
};

function simulator(provider: string): RuntimeSpec {
  return {
    executable: false,
    starters: {},
    status:
      `TenkaCloudSimulator を runtime に使う問題は、この repository にまだ 1 問もありません。` +
      `複製できる ${provider} の実例が無いので、動くように見える雛形は作りません。`,
    whenToUse:
      "クラウド型の API・resource model・failure scenario を、実アカウントと課金なしで" +
      "再現したい場合。対応済み capability だけを使う。",
    narrowing: [
      "使いたい操作は Simulator の対応 capability にあるか",
      "実クラウドと同一でない境界はどこか (問題文と metadata に書く)",
    ],
    extraConditions: [
      "未対応の操作を「成功したこと」にしない",
      "実クラウドとの差分を問題文と metadata に明示する",
      "experimental の間は `status: ready` へ進めない",
    ],
  };
}

export const RUNTIME_NAMES = Object.keys(RUNTIMES);

export const CATEGORY_OF: Readonly<Record<Style, Category>> = {
  challenge: "challenges",
  battle: "battles",
};

export interface Resolution {
  readonly starter: string;
  readonly category: Category;
  readonly declare?: RuntimeDeclaration;
}

/**
 * runtime と style から複製元を決める。
 *
 * 実行できない runtime と、starter の無い組み合わせは**別の理由**で断る。前者は
 * 「まだ無い」、後者は「その形の実例が無い」であり、作者が次に取る行動が違う。
 */
export function resolveStarter(
  runtime: string,
  style: Style,
): Resolution | { readonly error: string } {
  const spec = RUNTIMES[runtime];
  if (!spec) {
    return { error: `unknown runtime "${runtime}". choose one of: ${RUNTIME_NAMES.join(", ")}` };
  }
  if (!spec.executable) {
    return {
      error:
        `${runtime} はまだ実行できません。\n  ${spec.status}\n` +
        "  次の選択肢: コンテナで本質を再現できるなら --runtime docker/compose、" +
        "provider 固有の意味論が学習目標なら --runtime aws/cloudformation。",
    };
  }
  const starter = spec.starters[style];
  if (!starter) {
    const available = Object.keys(spec.starters).join(" / ") || "(none)";
    return {
      error:
        `runtime ${runtime} に ${style} の実例がありません (あるのは ${available})。\n` +
        "  複製元が無いまま雛形を作ると、通らない問題を作ることになります。" +
        `${style} で作る必要があるなら、先にその形の問題を 1 問作って starter にしてください。`,
    };
  }
  return { starter, category: CATEGORY_OF[style], declare: spec.declare };
}
