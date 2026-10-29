// Verifier-only checkpoint mapping. Never copy into the participant image.
/** checkpointId → the value this run expects, in its normalized comparison form. */
export function expectedAnswers(scenario) {
  return Object.freeze({
    "campaign-timer": String(scenario.countdownMinutes),
    "customer-count": String(scenario.paidCustomers),
    "cert-badges": scenario.badgeNumbers[scenario.fakeBadgeIndex].replace(/[^A-Z0-9]/g, ""),
    "customer-voices": String(scenario.stockId),
    "support-line": scenario.supportPhone.replace(/\D/g, ""),
    "mail-sender": scenario.lookalikeDomain,
  });
}
