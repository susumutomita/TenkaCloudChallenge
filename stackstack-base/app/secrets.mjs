import { createHash } from "node:crypto";

/**
 * Every unguessable value the StackStack base app hands out is derived here,
 * from the per-deploy `FLAG_SEED` the platform injects. Nothing secret is
 * committed and no two deploys share an answer.
 *
 * Keep every derivation namespaced (`"serial:"`, `"boot:"`, ...) so two
 * different values can never collide onto the same digest.
 */

const FLAG_SEED = process.env.FLAG_SEED ?? "local-dev-seed";

function digest(namespace) {
  return createHash("sha256").update(`${namespace}:${FLAG_SEED}`).digest("hex");
}

/** Printed on the board itself — proves the participant reached the app. */
export const BOARD_SERIAL = `SS-${digest("serial").slice(0, 8)}`;

/** Written into the boot log line — proves the participant read the log. */
export const BOOT_CHECK = digest("boot").slice(0, 12);

/**
 * Emitted by `/posture` only once every gate is green, so it cannot be earned
 * without actually doing the work the gates measure.
 */
export const READY_TOKEN = `TC{ready_${digest("ready").slice(0, 16)}}`;
