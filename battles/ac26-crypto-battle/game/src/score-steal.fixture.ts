/** Test/dev-only AWS response; never imported by the production entrypoint. */
export function scoreItemInputs(teamIds: readonly string[]) {
  return Object.fromEntries(
    teamIds.map((id, index) => [
      id,
      {
        CoordinationItemEnabled: "true",
        CoordinationPrivateItem: JSON.stringify({
          key: (index % 9) + 1,
          receipt: String(index % 10).repeat(32),
        }),
        CoordinationParameterName: `/tc-example-${id}/score-item`,
        CoordinationParameterConsoleUrl: `https://ap-northeast-1.console.aws.amazon.com/systems-manager/parameters/tc-example-${id}/score-item/description`,
      },
    ]),
  );
}
