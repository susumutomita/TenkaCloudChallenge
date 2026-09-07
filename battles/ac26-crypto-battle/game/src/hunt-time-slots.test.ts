import { expect, test } from "bun:test";
import { packHuntTimeSlots, unpackHuntTimeSlots } from "./hunt-time-slots.ts";
import { packUnsignedSlots } from "./integer-slots.ts";

test("millisecond times survive gaps, tied times, reverse arrivals and safe-integer extremes", () => {
	const cases = [
		[],
		[0, 0],
		[1, 1, 0, 1],
		[10001, 0, 10000, 9999, 0, 9999],
		[Number.MAX_SAFE_INTEGER, 1, 0, Number.MAX_SAFE_INTEGER],
		Array.from({ length: 98 }, (_, i) =>
			i % 7 === 0 ? 0 : 1 + Math.floor((i * 179999) / 97),
		),
	];
	let random = 123;
	for (let run = 0; run < 200; run++)
		cases.push(
			Array.from({ length: 98 }, () => {
				random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
				return random % 5 === 0 ? 0 : random;
			}),
		);
	for (const values of cases) {
		const packed = packHuntTimeSlots(values);
		expect(unpackHuntTimeSlots(packed.text, packed.width)).toEqual(values);
		const old = packUnsignedSlots(values);
		expect(unpackHuntTimeSlots(old.text, old.width)).toEqual(values);
		expect(JSON.stringify(packed).length).toBeLessThanOrEqual(
			JSON.stringify(old).length,
		);
	}
});

test("distributed attacks keep exact milliseconds in fewer bytes", () => {
	const values = Array.from(
		{ length: 98 },
		(_, i) => 1 + Math.floor((i * 179999) / 97),
	);
	const packed = packHuntTimeSlots(values);
	expect(packed.text.length).toBeLessThanOrEqual(196);
	expect(unpackHuntTimeSlots(packed.text, packed.width)).toEqual(values);
});

test("malformed differences cannot invent negative or unsafe timestamps", () => {
	const negative = packUnsignedSlots([2]);
	expect(() => unpackHuntTimeSlots(negative.text, -negative.width)).toThrow();
	const zero = packUnsignedSlots([3, 2]);
	expect(() => unpackHuntTimeSlots(zero.text, -zero.width)).toThrow();
	expect(() => unpackHuntTimeSlots("!", -1)).toThrow();
	expect(() => unpackHuntTimeSlots("A", -10)).toThrow();
});


test("time runs reject invalid counts and retain interrupted repeated differences", () => {
    const values = Array.from({length:98},(_,i)=> i%13===0 ? 0 : 1+i*1234);
    const encoded=packHuntTimeSlots(values);
    expect(unpackHuntTimeSlots(encoded.text,encoded.width)).toEqual(values);
    for (const runs of [[0,3],[64,3],[1]]) {
        const packed=packUnsignedSlots(runs);
        expect(()=>unpackHuntTimeSlots(`${packed.width}:${packed.text}`,12)).toThrow();
    }
});
