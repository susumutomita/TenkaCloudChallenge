/** Exact timestamps indexed by attacker. Zero means absent, never timestamp zero.
 * Positive widths retain the original absolute-offset slots. Negative widths
 * encode signed differences between present slots; absent slots leave the prior
 * offset untouched. Use deltas only when their serialized form is smaller.
 */
import { packUnsignedSlots, unpackUnsignedSlots } from "./integer-slots.ts";

export function packHuntTimeSlots(values: readonly number[]) {
	const direct = packUnsignedSlots(values);
	let previous = 0;
	const deltas: number[] = [];
	for (const value of values) {
		if (value === 0) {
			deltas.push(0);
			continue;
		}
		const delta = value - previous;
		const encoded = delta >= 0 ? 2 * delta + 1 : -2 * delta;
		if (!Number.isSafeInteger(encoded)) return direct;
		deltas.push(encoded);
		previous = value;
	}
	const packed = packUnsignedSlots(deltas);
	return packed.text.length + 1 < direct.text.length
		? { width: -packed.width, text: packed.text }
		: direct;
}

export function unpackHuntTimeSlots(text: string, width: number): number[] {
	if (width >= 0) return unpackUnsignedSlots(text, width);
	const deltas = unpackUnsignedSlots(text, -width);
	let previous = 0;
	return deltas.map((value) => {
		if (value === 0) return 0;
		const delta = value % 2 ? (value - 1) / 2 : -value / 2;
		const result = previous + delta;
		if (!Number.isSafeInteger(result) || result < 1)
			throw new Error("Invalid HUNT time difference");
		previous = result;
		return result;
	});
}
