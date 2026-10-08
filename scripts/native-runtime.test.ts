import { expect, test } from "bun:test";
import {
	mkdtempSync,
	mkdirSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkNativeCoordinationRefs } from "./validate-problems";

test("native coordination validates real matching plugin paths without inventing a container verifier", () => {
	const dir = mkdtempSync(join(tmpdir(), "native-catalog-"));
	try {
		mkdirSync(join(dir, "coordination"));
		writeFileSync(join(dir, "coordination/plugin.ts"), "export default {};\n");
		const meta = {
			category: "Battle",
			instructions: "調査する",
			description: "運営向け",
			i18n: {
				en: { instructions: "Investigate", description: "Operator context" },
			},
			runtime: {
				provider: "local",
				engine: "bun",
				entry: "coordination/plugin.ts",
			},
			interTeamCoordination: { plugin: "coordination/plugin.ts" },
		};
		expect(checkNativeCoordinationRefs(dir, meta).errors).toEqual([]);
		for (const extra of [
			{ category: "Challenge" },
			{ scoring: { kind: "verify" } },
			{ cfnTemplate: "template.yaml" },
			{ interTeamCoordination: {} },
		])
			expect(
				checkNativeCoordinationRefs(dir, { ...meta, ...extra }).errors.length,
			).toBeGreaterThan(0);
		for (const path of [
			"coordination/missing.ts",
			"coordination/../plugin.ts",
			"/tmp/plugin.ts",
			"coordination/plugin.js",
		])
			expect(
				checkNativeCoordinationRefs(dir, {
					...meta,
					runtime: { ...meta.runtime, entry: path },
					interTeamCoordination: { plugin: path },
				}).errors.length,
			).toBeGreaterThan(0);
		expect(
			checkNativeCoordinationRefs(dir, {
				...meta,
				runtime: { ...meta.runtime, entry: "coordination/other.ts" },
			}).errors.length,
		).toBeGreaterThan(0);
		expect(
			checkNativeCoordinationRefs(dir, {
				...meta,
				runtime: { ...meta.runtime, verifyUrl: "http://127.0.0.1:1234/verify" },
			}).errors.length,
		).toBeGreaterThan(0);
		symlinkSync("plugin.ts", join(dir, "coordination/link.ts"));
		expect(
			checkNativeCoordinationRefs(dir, {
				...meta,
				runtime: { ...meta.runtime, entry: "coordination/link.ts" },
				interTeamCoordination: { plugin: "coordination/link.ts" },
			}).errors.length,
		).toBeGreaterThan(0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
