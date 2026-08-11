import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dir, "..");
const unverifiedChallenges = [
  "cs-auth-claim-audit",
  "cs-transaction-visibility-audit",
  "cs-async-result-binding",
  "cs-cache-generation-fence",
  "cs-http-retry-idempotency",
] as const;

describe("cs-foundations readiness", () => {
  test.each(unverifiedChallenges)("%s remains draft until complete human play evidence is recorded", (challengeId) => {
    const metadata = JSON.parse(
      readFileSync(join(repositoryRoot, "challenges", challengeId, "metadata.json"), "utf8"),
    ) as { status?: string };

    expect(metadata.status).toBe("draft");
  });
});
