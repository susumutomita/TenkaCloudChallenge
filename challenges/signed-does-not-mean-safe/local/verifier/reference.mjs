import { OBSERVATIONS } from "../app/engine.mjs";

export const REFERENCE_TRIAGE = Object.freeze({
  diagnosis: [...OBSERVATIONS],
  review: {
    resolveFrom: "lockfile",
    treatValidAttestationAsSafe: false,
    flagOn: ["unexpected-file", "added-lifecycle-script", "invalid-attestation", "integrity-mismatch"],
  },
  scriptPolicy: {
    default: "deny",
    allow: [{ name: "native-hash", version: "3.4.1" }],
  },
  incident: {
    treatFetchAsExecuted: false,
    actions: {
      "not-installed": ["monitor"],
      "installed-scripts-disabled": ["remove-artifact"],
      "scripts-executed": ["isolate", "hunt-indicators", "rotate-credentials"],
    },
  },
});
