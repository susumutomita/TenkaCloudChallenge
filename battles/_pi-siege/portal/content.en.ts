export const roundsEn = [
  {
    title: "Build a close record", badge: "Understand the question", action: "Try a fraction",
    story: "A circle of diameter 1 has circumference π. You want to replace it with a fraction. Explore a stronger record, or save tickets to audit your opponent's publication.",
    rule: "Error is the positive distance between π and p÷q. With q=5, the cubic benchmark is 1÷(5×5×5)=1/125. Smaller error is better. Records are compared by error×q×q so enlarging the denominator alone cannot win.",
    goal: "First try 3/1 to see its error. Enlarging the denominator range costs one ticket, as do an experiment and a publication. A finite record that holds earns +6; the stronger valid record +2. Expose insufficient evidence for 'arbitrarily far' to earn +4.",
    link: "The manuscript asks whether exceptionally good approximations continue arbitrarily far. A wider experiment alone cannot guarantee an infinite range.",
    hints: ["One close fraction is one record. Whether such records continue further is still unknown.", "If the target were 3/2 and the trial 4/3, error would be 3/2−4/3=1/6. For π, the computer uses a guaranteed interval.", "Check your p and q → try them → read the error and benchmark → choose the scope to publish. Separate the correctness of a fraction from the scope of the opponent's claim."],
  },
  {
    title: "Close the zero escape", badge: "A historical obstacle", action: "Try a table",
    story: "Move from record hunting to building a tool that limits approximation. Being small is insufficient: if your difference becomes zero, 'a nonzero integer has magnitude at least 1' no longer applies. Audit the opponent's tool.",
    rule: "For a 2×2 table, difference of diagonal products means top-left×bottom-right−top-right×bottom-left. [[1,1/2],[1,3/4]] gives 3/4−1/2=1/4. Multiplying every cell by 4 multiplies this difference by 16. A nonzero difference therefore has magnitude at least 1/16.",
    goal: "Make the magnitude at most 1/8 and nonzero, then publish an integer-derived floor (a guaranteed minimum magnitude). This exercise grades floors up to 1/(D×D), not a stronger floor read directly from the difference. A held claim earns +6, the stronger floor +2, a zero/scale/size audit +4.",
    link: "Earlier research managed smallness and denominator costs together. The manuscript uses interpolation (satisfying specified calculation conditions simultaneously) to select a table with nonzero determinant (the diagonal-product difference in 2×2). This table is not a proof of that theorem.",
    hints: ["A floor is a boundary the magnitude cannot go below. A zero difference loses the basis for any positive floor.", "Multiplying each cell by D multiplies both products by D×D. The cleared nonzero integer has magnitude at least 1, giving the original floor 1/(D×D).", "Calculate your diagonal-product difference → check nonzero → find D clearing all four denominators → calculate 1/(D×D) → check the 1/8 size goal → enter your floor."],
  },
  {
    title: "Read the opponent's mix", badge: "Two branches of the proposed strategy", action: "Try an arrangement",
    story: "Split a large calculation into pieces to add, called terms. Each row card supplies one piece's material. Your opponent claims every mix has exponent at least k. Gathering one type forces higher numbers; switching types adds error factors. Can a different mix break a guarantee that covered only one side?",
    rule: "Row cards have type 0 or 1. Degree means the number on a card; within each type use distinct numbers 0,1,2… . Exponent k is type sum + degree sum, the number of halvings. Exponent 3 gives candidate bound 1÷(2×2×2)=1/8. A repeated type/degree pair makes a term zero. A candidate without repeats can still be zero. This k differs from the earlier 1/q³ benchmark.",
    goal: "Buy more rows, 4→5→6, or inspect another split. Publish 'every arrangement has exponent at least k'. A held claim earns +6, stronger guarantee +2. Construct an exponent below the published k and submit your calculated sum to audit for +4. One experiment does not cover all arrangements.",
    link: "The manuscript's two bounds cover all terms by cases. This finite model fixes coefficient (an extra multiplier) magnitude bound 1 and decay (shrinkage per cost unit) 1/2. The original row's assigned index β is 0 here; there is one direction and two types. Coefficient estimates, remainder terms and the sum of all terms are omitted.",
    hints: ["Gathering a type forces later cards to use higher degrees to avoid repeats. Splitting lowers degrees, but each type-1 card adds another halving.", "For three cards, two of type 0 and one of type 1 have degrees 0,1 and 0. Type sum 1 + degree sum 1 = 2; candidate bound is 1/4.", "Read the opponent's row count → choose how many type-1 cards → assign degrees 0,1,2… separately within each type → sum by hand → if below their k, submit that count and sum in the audit."],
  },
  {
    title: "Protect both sides", badge: "Why approaching 2 is hard", action: "Try an allocation",
    story: "Closing one escape can leave another open. Allocate one budget to protect both sides. The benchmark ν is 9/4=2.25. Closer to 2, the range of allocations satisfying both sides narrows.",
    rule: "ν names the strictness of the 1/q^ν benchmark, not card exponent k. Allocation b lies between 0 and 1. Entry margins are repetition 2b−1 and error ν×(1−b)−1. A margin is room to satisfy a condition. For ν=3,b=1/2, they are 0 and 1/2, leaving an escape. This board uses ν=9/4 and the manuscript's section 4 entry constraints.",
    goal: "Each refinement 1/10→1/50→1/100 costs a ticket. Invest in finer choices or save for an audit. Both entry and both δ-adjusted margins, all four, must be positive for +6. The +2 bonus compares the smaller of the two entry margins. Audit a nonpositive side for +4.",
    link: "b alone is insufficient. Adjustment δ=1/10 gives θ=9/10 and A=1−b×δ. Also test θ−A² and ν×(A−θ)−(1−θ). Example ν=3,b=1/2 gives A=19/20, then −1/400 and 1/20. Interpolation, sums, remainders and the infinite argument remain outside the game.",
    hints: ["A large margin on one side cannot compensate for a nonpositive other side. The opponent can choose the weak side to audit.", "With ν=3,b=1/2: 2×1/2−1=0, while 3×(1−1/2)−1=1/2. Both margins are needed.", "Form b from your numerator and grid → calculate 2b−1 → calculate 9/4×(1−b)−1 → check both positive → check the adjusted conditions too. If coarse choices miss the feasible window, spend a refinement ticket."],
  },
] as const;

export const errorsEn: Record<string, string> = {
  not_your_turn: "Opponent's turn. Read published evidence and prepare your next choice.",
  stale_view: "The board advanced. Choose again on the updated board.",
  no_tickets: "No tickets left. Wait for your opponent to finish.",
  bad_task: "Check numerical limits. Denominators cannot be zero; table numerators −9…9 and denominators 1…16.",
  bad_claim: "Check the published value: positive fractional floor, or exponent 0…30.",
  already_published: "One publication per round. Use remaining tickets for audits or experiments.",
  unknown_source: "First inspect your own proposal. Opponent's or earlier-round experiments cannot be used.",
  audit_unavailable: "Audit each opponent claim at most once. Own or settled claims cannot be audited.",
  bad_evidence: "Check audit evidence. A mixed arrangement needs the type-1 count and your calculated sum.",
  match_ended: "Match ended. Review scores and explanations.",
};
export const debriefEn = [
  "Examples such as 355/113 have error below 1/q³. One record and records continuing arbitrarily far are different. The manuscript does not assert error≥1/q² for every fraction or provide a computable denominator beyond which its bound always holds.",
  "Earlier research was not mere brute force. Zeilberger–Zudilin explored parameters of integrals (continuously adding small quantities), then rigorously bounded common denominator factors and size to prove an upper bound 7.103… on π’s irrationality exponent . Table building introduces this simultaneous difficulty.",
  "The proposed strategy: assume exceptionally good approximations arbitrarily far → choose weights (budget multipliers in each direction) in order → choose denominators → use interpolation to select a nonzero determinant → give an integer-derived lower bound → bound all terms through repetition or error powers → derive incompatible bounds. Merely having more cards than requirements does not ensure a nonzero determinant.",
  "Mixed arrangements expose gaps in a one-type guarantee. The manuscript covers every expanded term (piece of the calculation) by either many low types or many high types and bounds both branches. Per direction, type index a and original row index β give a−β error factors. This board has one direction and β=0.",
  "At ν=2, the interval 1/2<b<1−1/ν is empty. That closes the entrance to this parameter construction. The finite game neither proves the exponent-2 theorem nor excludes other methods.",
  "The manuscript claims an exponent-2 proof and publishes Lean sources. The official selected statement is exponent 2; the series-convergence consequence is outside that selection. Full dependency build, axiom audit and Comparator execution were not run here. We do not declare a verified new theorem.",
];
