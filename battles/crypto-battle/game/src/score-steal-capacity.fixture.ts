/** Conservative additive bound; assumes a full item Order survives beside every
 * ordinary retained Order, and every team both holds material and has transferred.
 * Actual play replaces a normal slot and prunes completed Orders, so costs less.
 */
export function scoreItemByteBound(teamCount: number): number {
  const teamId = "T".repeat(26);
  const material = {
    key: 9,
    receipt: "r".repeat(32),
    parameterName: "/tc-" + "p".repeat(88),
    consoleUrl: "u".repeat(300),
    status: "offered",
  };
  const contract = {
    id: `${teamId}-c99999`,
    teamId,
    kind: "standard",
    points: 0,
    leakPoints: 0,
    task: {
      kind: "ssm-decrypt",
      ciphertext: 9,
      nonce: "f".repeat(32),
      parameterName: material.parameterName,
      consoleUrl: material.consoleUrl,
    },
    issuedAtMs: Number.MAX_SAFE_INTEGER,
    expiresAtMs: Number.MAX_SAFE_INTEGER,
    status: "completed",
    privacyConstraint: "no-raw-disclosure",
    allowedMethods: ["item"],
    resolution: "item",
    lastSubmissionPoints: 0,
  };
  const transfer = { from: teamId, to: teamId, points: 10, atMs: Number.MAX_SAFE_INTEGER };
  return (
    128 +
    teamCount *
      Buffer.byteLength(
        JSON.stringify({ [teamId]: material }) +
          JSON.stringify(contract) +
          JSON.stringify(transfer) +
          ",,,",
      )
  );
}
