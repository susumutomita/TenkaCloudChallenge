import { createHash, randomBytes } from "node:crypto";

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

/**
 * Held only in this process's memory, never in its environment.
 *
 * `FLAG_SEED` arrives as an environment variable, and on Linux that is readable
 * from `/proc/self/environ` by anything running in the process — deleting it
 * from `process.env` does not touch the exec-time copy. Later problems in this
 * family run participant-written code inside the app on purpose, so anything
 * derived from `FLAG_SEED` is forgeable by that code.
 *
 * That is tolerable for the values a participant is *meant* to read off the
 * board and out of the log. It is not tolerable for a gate receipt, whose whole
 * job is to say the app observed something happen. So receipts come from a
 * secret generated at boot, which was never in the environment and cannot be
 * read back out of it.
 *
 * The cost is that receipts change when the container restarts, which is
 * correct: a receipt is evidence about *this* run.
 */
const RECEIPT_SECRET = randomBytes(32).toString("hex");

/**
 * The receipt for one gate, emitted by `/posture` only while that gate is true.
 *
 * Namespaced by gate name, so earning one gate tells a participant nothing
 * about the others.
 */
export function gateToken(gate) {
  return `TC{${gate}_${createHash("sha256")
    .update(`gate:${gate}:${RECEIPT_SECRET}`)
    .digest("hex")
    .slice(0, 16)}}`;
}
