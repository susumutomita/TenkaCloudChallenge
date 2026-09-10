import { createHmac } from "node:crypto";
export const stages = ["plan", "rehearsal", "incident", "closeout"];
export function createModel(seed) {
  if (!seed) throw new Error("FLAG_SEED is required");
  const hash = createHmac("sha256", seed)
    .update("event-host-rehearsal")
    .digest();
  const scenario = {
    participants: 17 + (hash[0] % 15),
    perTeam: 4,
    spares: 2,
    order: `ORDER-${10 + (hash[1] % 80)}`,
    remainingResources: 1 + (hash[2] % 3),
  };
  const completed = new Map();
  const token = (stage) =>
    `TC{${createHmac("sha256", seed).update(`host:${stage}`).digest("hex")}}`;
  function submit(stage, answer) {
    const index = stages.indexOf(stage);
    if (
      index < 0 ||
      !answer ||
      typeof answer !== "object" ||
      Array.isArray(answer)
    )
      return null;
    if (stages.slice(0, index).some((id) => !completed.has(id))) return null;
    const correct =
      stage === "plan"
        ? answer.teams ===
            Math.ceil(scenario.participants / scenario.perTeam) &&
          answer.computers === scenario.participants + scenario.spares &&
          ["aoi", "mei"].includes(answer.owner)
        : stage === "rehearsal"
          ? answer.decision === "hold" && answer.check === "scoring"
          : stage === "incident"
            ? answer.order === scenario.order &&
              answer.action === "reconcile" &&
              answer.recipient === "technical"
            : answer.status === "pending" &&
              answer.owner === "technical" &&
              answer.next === "check-deletion-and-cost";
    if (!correct) return null;
    if (!completed.has(stage)) completed.set(stage, { ...answer });
    return token(stage);
  }
  return {
    scenario,
    submit,
    progress: () => stages.filter((id) => completed.has(id)),
    verify: (id, answer) =>
      stages.includes(id) &&
      completed.has(id) &&
      typeof answer === "string" &&
      answer === token(id),
    report: () => ({
      simulation: true,
      scenario,
      decisions: Object.fromEntries(completed),
    }),
  };
}
