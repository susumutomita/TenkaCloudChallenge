import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import plugin from "../coordination/plugin.ts";
import {
	applyOp,
	initialState,
	MAX_RECEIPTS,
	projectForTeam,
	teamScores,
	validateOp,
} from "../game/index.ts";
import type { AnswerOp, Operation, Projection, State } from "../game/types.ts";

const context = {
	eventId: "event-test",
	teamIds: ["alpha", "bravo"],
	matchSecret: "0123456789abcdef".repeat(4),
};
const start = () => initialState(context);
const evidence = (v: Projection, caseId: string, id: string) =>
	JSON.parse(
		v.cases.find((c) => c.id === caseId)!.evidence.find((e) => e.id === id)!
			.content,
	);
let opNumber = 0;
function answer(
	state: State,
	caseId: string,
	questionId: string,
	text: string,
	evidenceIds: string[],
	team = "alpha",
): AnswerOp {
	return {
		kind: "answer",
		id: `test-${++opNumber}`,
		revision: projectForTeam(state, team).revision,
		generation: state.generation,
		caseId,
		questionId,
		answer: text,
		evidenceIds,
	};
}
/** Derive all conclusions ONLY from participant-visible evidence, not private fixtures/answer keys. */
function solutions(v: Projection): [string, string, string, string[]][] {
	const iCloud = evidence(v, "identity", "I-CLOUD");
	const iIdp = evidence(v, "identity", "I-IDP");
	const action = iCloud.events.find(
		(e: any) => e.operation === "EnableExternalExport",
	);
	const login = iIdp.events.find((e: any) => e.session === action.session);
	const approval = evidence(v, "identity", "I-APPROVAL");
	const approvalWord = approval.approved_actions.includes(action.operation)
		? "approved"
		: "unauthorized";
	const tAudit = evidence(v, "timeline", "T-AUDIT").events;
	const reads = evidence(v, "timeline", "T-OBJECT").events.filter(
		(e: any) => e.status === 200,
	);
	const receipts: any[] = [
		...new Map<string, any>(
			evidence(v, "timeline", "T-NET").receipts.map(
				(r: any) => [r.receipt_id, r] as [string, any],
			),
		).values(),
	];
	const byTime = (a: any, b: any) => Date.parse(a.time) - Date.parse(b.time);
	const order = [
		...tAudit,
		[...reads].sort(byTime)[0],
		[...receipts].sort(byTime)[0],
	]
		.sort(byTime)
		.map((e) => e.event_id)
		.join(",");
	const matching = receipts.filter((r) =>
		reads.some(
			(e: any) => e.request_id === r.request_id && e.sha256 === r.object_sha256,
		),
	);
	function coveredBytes(rows: any[]): number {
		let total = 0,
			end = -1;
		for (const r of [...rows].sort((a, b) => a.range_start - b.range_start)) {
			total += Math.max(
				0,
				r.range_end_exclusive - Math.max(end, r.range_start),
			);
			end = Math.max(end, r.range_end_exclusive);
		}
		return total;
	}
	const bytes = reads.reduce(
		(total: number, e: any) =>
			total +
			coveredBytes(matching.filter((r) => r.request_id === e.request_id)),
		0,
	);
	const confirmed = reads
		.filter(
			(e: any) =>
				coveredBytes(matching.filter((r) => r.request_id === e.request_id)) ===
				e.body_bytes,
		)
		.map((e: any) => e.object);
	const unresolved = reads
		.filter((e: any) => !confirmed.includes(e.object))
		.map((e: any) => e.object);
	const bAudit = evidence(v, "recovery", "B-AUDIT").events;
	const bRestore = evidence(v, "recovery", "B-RESTORE");
	const safe = bRestore.tests.find(
		(t: any) =>
			t.result === "passed" &&
			t.mounted &&
			t.restored_manifest_sha256 === t.known_clean_manifest_sha256,
	);
	const copy = evidence(v, "recovery", "B-CATALOG").copies.find(
		(c: any) => c.copy_id === safe.copy_id,
	);
	const damage = bAudit.find((e: any) => e.kind === "first_destructive_write");
	const loss =
		(Date.parse(damage.time) - Date.parse(copy.checkpoint_utc)) / 60000;
	return [
		["identity", "account", login.account, ["I-IDP", "I-CLOUD"]],
		["identity", "authority", approvalWord, ["I-CLOUD", "I-APPROVAL"]],
		[
			"identity",
			"attribution",
			"session-used;human-unknown",
			["I-IDP", "I-CLOUD", "I-LIMITS"],
		],
		["timeline", "order", order, ["T-AUDIT", "T-OBJECT", "T-NET"]],
		["timeline", "bytes", String(bytes), ["T-OBJECT", "T-NET"]],
		[
			"timeline",
			"scope",
			`confirmed=${confirmed.reverse().join(",")};unresolved=${unresolved.join(",")}`,
			["T-OBJECT", "T-NET", "T-COVERAGE"],
		],
		["recovery", "trust", damage.role, ["B-ACCESS", "B-AUDIT"]],
		["recovery", "copy", safe.copy_id, ["B-ACCESS", "B-CATALOG", "B-RESTORE"]],
		[
			"recovery",
			"assurance",
			`loss_window_minutes=${loss};production_ready=no`,
			["B-AUDIT", "B-CATALOG", "B-RESTORE"],
		],
	];
}

describe("server authority and preservation", () => {
	test("plain plugin structurally exposes native hooks and no reset/tick", () => {
		expect(plugin.initialState).toBe(initialState);
		expect(plugin.projectForTeam).toBe(projectForTeam);
		expect(plugin.stateSchemaVersion).toBe(1);
		expect(Object.hasOwn(plugin, "reset")).toBe(false);
	});
	test("requires server secret, bounded valid roster and generation", () => {
		for (const matchSecret of [
			undefined,
			"",
			"short",
			"a".repeat(129),
			"密".repeat(64),
		])
			expect(() => initialState({ ...context, matchSecret })).toThrow(
				"server_secret_required",
			);
		for (const teamIds of [
			[],
			["alpha", "alpha"],
			["constructor"],
			["__proto__"],
			["prototype"],
			[""],
			Array.from({ length: 101 }, (_, i) => `team${i}`),
		])
			expect(() => initialState({ ...context, teamIds })).toThrow(
				"invalid_roster",
			);
		for (const generation of [0, -1, NaN, Infinity, 0.2, 1000001])
			expect(() => initialState(context, { generation })).toThrow(
				"invalid_generation",
			);
		expect(() => initialState({ ...context, eventId: "\n" })).toThrow(
			"invalid_event",
		);
	});
	test("stable HMAC evidence varies by secret, team, event and generation", () => {
		const a = projectForTeam(start(), "alpha");
		const contents = (v: Projection) =>
			v.cases.map((c) => c.evidence.map((e) => e.content));
		expect(contents(a)).toEqual(contents(projectForTeam(start(), "alpha")));
		for (const changed of [
			projectForTeam(start(), "bravo"),
			projectForTeam(initialState({ ...context, eventId: "other" }), "alpha"),
			projectForTeam(
				initialState({ ...context, matchSecret: "b".repeat(64) }),
				"alpha",
			),
			projectForTeam(initialState(context, { generation: 2 }), "alpha"),
		])
			expect(contents(changed)).not.toEqual(contents(a));
	});
	test("projection whitelists fields, seals answer keys, and hashes exact downloadable content", () => {
		const state = start();
		const view = projectForTeam(state, "alpha");
		const serialized = JSON.stringify(view);
		for (const forbidden of [
			context.matchSecret,
			'"matchSecret"',
			'"expected"',
			'"citations"',
			'"receipts"',
			'"progress"',
			'"bravo"',
		])
			expect(serialized).not.toContain(forbidden);
		for (const c of view.cases) {
			expect(c.evidence.length).toBe(4);
			for (const e of c.evidence) {
				expect(e.sha256).toBe(
					createHash("sha256").update(e.content, "utf8").digest("hex"),
				);
				expect(JSON.parse(e.content).synthetic).toBe(true);
			}
			for (const q of c.questions) {
				expect(q.hints).toEqual([]);
				expect(q.explanation).toBeUndefined();
				expect(q.totalHints).toBe(3);
			}
		}
		expect(() => projectForTeam(state, "constructor")).toThrow("unknown_team");
		expect(() => projectForTeam(state, "charlie")).toThrow("unknown_team");
	});
	test("projection mutation cannot edit authoritative state", () => {
		let state = start();
		const s = solutions(projectForTeam(state, "alpha"))[0]!;
		state = applyOp(state, "alpha", answer(state, ...s));
		const view = projectForTeam(state, "alpha");
		view.score = 999;
		view.lastResult!.message.en = "tampered";
		view.cases[0]!.questions[0]!.solved = false;
		expect(projectForTeam(state, "alpha").score).toBe(20);
		expect(projectForTeam(state, "alpha").lastResult!.message.en).not.toBe(
			"tampered",
		);
		expect(projectForTeam(state, "alpha").cases[0]!.questions[0]!.solved).toBe(
			true,
		);
	});
});

describe("evidence-based learning", () => {
	test("all nine checkpoints solved from public evidence across multiple generated cases", () => {
		for (let generation = 1; generation <= 8; generation++) {
			let state = initialState(context, { generation });
			const initial = projectForTeam(state, "alpha");
			for (const s of solutions(initial)) {
				state = applyOp(state, "alpha", answer(state, ...s));
				expect(projectForTeam(state, "alpha").lastResult?.status).toBe(
					"correct",
				);
			}
			const final = projectForTeam(state, "alpha");
			expect(final.score).toBe(300);
			expect(final.revision).toBe(9);
			expect(
				final.cases.every((c) =>
					c.questions.every((q) => q.solved && q.explanation),
				),
			).toBe(true);
			expect(teamScores(state)).toEqual({ alpha: 300, bravo: 0 });
		}
	});
	test("correct answer needs exact relevant citations; wrong answers remain retryable with generic feedback", () => {
		let state = start();
		const s = solutions(projectForTeam(state, "alpha"))[0]!;
		for (const [text, ids] of [
			[s[2], []],
			[s[2], ["I-IDP"]],
			[s[2], ["I-IDP", "I-CLOUD", "I-APPROVAL"]],
			["unsupported-guess", s[3]],
		] as [string, string[]][]) {
			const before = state;
			state = applyOp(state, "alpha", answer(state, s[0], s[1], text, ids));
			expect(projectForTeam(state, "alpha").score).toBe(0);
			expect(projectForTeam(state, "alpha").lastResult?.status).toBe(
				"incorrect",
			);
			expect(projectForTeam(before, "alpha").revision + 1).toBe(
				projectForTeam(state, "alpha").revision,
			);
		}
		state = applyOp(state, "alpha", answer(state, ...s));
		const view = projectForTeam(state, "alpha");
		expect(view.score).toBe(20);
		expect(view.cases[0]!.questions[0]!.attempts).toBe(5);
		expect(view.cases[0]!.questions[0]!.explanation).toBeDefined();
	});
	test("cross-team answers fail; stale revisions cannot mutate another seat", () => {
		const state = start();
		const s = solutions(projectForTeam(state, "alpha"))[0]!;
		const op = answer(state, ...s, "bravo");
		const next = applyOp(state, "bravo", op);
		expect(projectForTeam(next, "bravo").lastResult?.status).toBe("incorrect");
		expect(projectForTeam(next, "alpha")).toEqual(
			projectForTeam(state, "alpha"),
		);
		expect(validateOp(state, "charlie", op)).toEqual({
			ok: false,
			error: "unknown_team",
		});
	});
	test("rewards cannot repeat, reset or be obtained by hints", () => {
		let state = start();
		const s = solutions(projectForTeam(state, "alpha"))[0]!;
		const solvedOp = answer(state, ...s);
		state = applyOp(state, "alpha", solvedOp);
		expect(validateOp(state, "alpha", answer(state, ...s))).toEqual({
			ok: false,
			error: "already_solved",
		});
		for (let rung = 1; rung <= 3; rung++) {
			state = applyOp(state, "alpha", {
				kind: "hint",
				generation: state.generation,
				id: `hint-${rung}`,
				revision: state.teams.alpha!.revision,
				caseId: "identity",
				questionId: "account",
				rung,
			});
			const v = projectForTeam(state, "alpha");
			expect(v.score).toBe(20);
			expect(v.cases[0]!.questions[0]!.hints.length).toBe(rung);
		}
		expect(
			validateOp(state, "alpha", {
				kind: "reset",
				id: "reset",
				revision: state.teams.alpha!.revision,
			}),
		).toEqual({ ok: false, error: "invalid_operation" });
	});
	test("hint staircase is sequential, bilingual and score-free", () => {
		let state = start();
		expect(
			validateOp(state, "alpha", {
				kind: "hint",
				generation: state.generation,
				id: "skip",
				revision: 0,
				caseId: "recovery",
				questionId: "assurance",
				rung: 3,
			}),
		).toEqual({ ok: false, error: "hint_sequence" });
		for (let rung = 1; rung <= 3; rung++)
			state = applyOp(state, "alpha", {
				kind: "hint",
				generation: state.generation,
				id: `stairs-${rung}`,
				revision: rung - 1,
				caseId: "recovery",
				questionId: "assurance",
				rung,
			});
		const q = projectForTeam(state, "alpha").cases[2]!.questions[2]!;
		expect(q.hints.length).toBe(3);
		expect(q.hints.every((h) => h.ja.length > 20 && h.en.length > 20)).toBe(
			true,
		);
		expect(q.explanation).toBeUndefined();
		expect(projectForTeam(state, "alpha").score).toBe(0);
	});
	test("overlap double-counting, wrong fingerprints and unsupported claims do not pass", () => {
		let state = start();
		const view = projectForTeam(state, "alpha");
		const expected = solutions(view);
		const reads = evidence(view, "timeline", "T-OBJECT").events.filter(
			(e: any) => e.status === 200,
		);
		const rows = evidence(view, "timeline", "T-NET").receipts;
		const wrongHash = rows.find((r: any) =>
			reads.some(
				(e: any) =>
					e.request_id === r.request_id && e.sha256 !== r.object_sha256,
			),
		);
		expect(wrongHash).toBeDefined();
		const matched = rows.filter((r: any) =>
			reads.some(
				(e: any) =>
					e.request_id === r.request_id && e.sha256 === r.object_sha256,
			),
		);
		const unique = [
			...new Map<string, any>(
				matched.map((r: any) => [r.receipt_id, r] as [string, any]),
			).values(),
		];
		const doubleCount = unique.reduce(
			(total: number, r: any) => total + r.range_end_exclusive - r.range_start,
			0,
		);
		expect(doubleCount).toBeGreaterThan(
			Number(expected.find((s) => s[1] === "bytes")![2]),
		);
		const bads: [string, string, string, string[]][] = [
			[
				"identity",
				"attribution",
				"owner-proven",
				["I-IDP", "I-CLOUD", "I-LIMITS"],
			],
			["timeline", "bytes", String(doubleCount), ["T-OBJECT", "T-NET"]],
			[
				"timeline",
				"bytes",
				String(evidence(view, "timeline", "T-NET").connection_total_bytes),
				["T-OBJECT", "T-NET"],
			],
			[
				"timeline",
				"scope",
				`confirmed=${reads.map((e: any) => e.object).join(",")};unresolved=none`,
				["T-OBJECT", "T-NET", "T-COVERAGE"],
			],
			[
				"recovery",
				"assurance",
				expected
					.find((s) => s[1] === "assurance")![2]
					.replace("ready=no", "ready=yes"),
				["B-AUDIT", "B-CATALOG", "B-RESTORE"],
			],
		];
		for (const bad of bads) {
			state = applyOp(state, "alpha", answer(state, ...bad));
			expect(projectForTeam(state, "alpha").lastResult?.status).toBe(
				"incorrect",
			);
		}
		expect(projectForTeam(state, "alpha").score).toBe(0);
	});
	test("new practice state has fresh evidence and zero score without competition reset", () => {
		let state = start();
		state = applyOp(
			state,
			"alpha",
			answer(state, ...solutions(projectForTeam(state, "alpha"))[0]!),
		);
		const fresh = initialState(
			{ ...context, eventId: "new-practice", matchSecret: "f".repeat(64) },
			{ generation: 2 },
		);
		expect(projectForTeam(fresh, "alpha").score).toBe(0);
		expect(projectForTeam(fresh, "alpha").generation).toBe(2);
		expect(
			projectForTeam(fresh, "alpha").cases[0]!.evidence[0]!.sha256,
		).not.toBe(projectForTeam(state, "alpha").cases[0]!.evidence[0]!.sha256);
		const delayed = answer(start(), "identity", "authority", "unauthorized", [
			"I-CLOUD",
			"I-APPROVAL",
		]);
		expect(validateOp(fresh, "alpha", delayed)).toEqual({
			ok: false,
			error: "stale_generation",
		});
		expect(
			validateOp(fresh, "alpha", {
				kind: "hint",
				id: "delayed-hint",
				generation: 1,
				revision: 0,
				caseId: "identity",
				questionId: "account",
				rung: 1,
			}),
		).toEqual({ ok: false, error: "stale_generation" });
	});
});

describe("untrusted operation boundary", () => {
	test("exact replay is idempotent, changed reuse fails, old revisions cannot apply", () => {
		const state = start();
		const op = answer(state, "identity", "account", "wrong", [
			"I-IDP",
			"I-CLOUD",
		]);
		const next = applyOp(state, "alpha", op);
		expect(applyOp(next, "alpha", op)).toBe(next);
		expect(validateOp(next, "alpha", { ...op, answer: "different" })).toEqual({
			ok: false,
			error: "id_conflict",
		});
		expect(validateOp(next, "alpha", { ...op, generation: 2 })).toEqual({
			ok: false,
			error: "stale_generation",
		});
		expect(validateOp(next, "alpha", { ...op, id: "new-id" })).toEqual({
			ok: false,
			error: "stale_revision",
		});
		expect(projectForTeam(next, "alpha").cases[0]!.questions[0]!.attempts).toBe(
			1,
		);
	});
	test("malformed objects, extra fields, spoofed team, absurd size and invalid numbers fail closed", () => {
		const state = start();
		const op = answer(state, "identity", "account", "wrong", [
			"I-IDP",
			"I-CLOUD",
		]);
		const inputs: unknown[] = [
			null,
			undefined,
			false,
			1,
			"answer",
			[],
			new Date(),
			{},
			{ ...op, generation: undefined },
			{ ...op, generation: 0 },
			{ ...op, generation: NaN },
			{ ...op, generation: 1.5 },
			{ ...op, teamId: "bravo" },
			{ ...op, expected: "wrong" },
			{ ...op, id: "x".repeat(65) },
			{ ...op, answer: "x".repeat(513) },
			{ ...op, answer: 4 },
			{ ...op, evidenceIds: ["I-IDP", "I-IDP"] },
			{
				...op,
				evidenceIds: ["I-IDP", "I-CLOUD", "I-APPROVAL", "I-LIMITS", "I-IDP"],
			},
			{ ...op, caseId: "__proto__" },
			{ ...op, questionId: "constructor" },
			{ ...op, revision: NaN },
			{ ...op, revision: Infinity },
			{ ...op, revision: 0.1 },
			{ ...op, revision: -1 },
			{ ...op, revision: "0" },
			{
				kind: "hint",
				generation: state.generation,
				id: "one",
				revision: 0,
				caseId: "identity",
				questionId: "account",
				rung: 1,
				answer: "extra",
			},
			Object.create({ kind: "answer" }),
		];
		const accessor = { ...op };
		Object.defineProperty(accessor, "answer", {
			get() {
				throw new Error("must not execute");
			},
			enumerable: true,
		});
		inputs.push(accessor);
		for (const input of inputs) {
			expect(validateOp(state, "alpha", input).ok).toBe(false);
			expect(() => applyOp(state, "alpha", input)).toThrow();
		}
		expect(
			validateOp(state, "alpha", { ...op, evidenceIds: ["T-AUDIT"] }),
		).toEqual({ ok: false, error: "invalid_evidence" });
		expect(
			validateOp(state, "alpha", { ...op, questionId: "unknown" }),
		).toEqual({ ok: false, error: "unknown_question" });
		expect(projectForTeam(state, "alpha").revision).toBe(0);
	});
	test("bounded receipts evict safely; stale evicted ops cannot score again", () => {
		let state = start();
		const first = answer(state, "identity", "account", "wrong", []);
		state = applyOp(state, "alpha", first);
		for (let i = 0; i < 80; i++)
			state = applyOp(
				state,
				"alpha",
				answer(state, "identity", "account", "wrong", []),
			);
		expect(state.teams.alpha!.receipts.length).toBe(MAX_RECEIPTS);
		expect(validateOp(state, "alpha", first)).toEqual({
			ok: false,
			error: "stale_revision",
		});
		expect(state.teams.alpha!.score).toBe(0);
	});
	test("JSON persistence preserves authoritative state and deterministic evidence", () => {
		let state = start();
		state = applyOp(
			state,
			"alpha",
			answer(state, ...solutions(projectForTeam(state, "alpha"))[0]!),
		);
		const roundtrip = JSON.parse(JSON.stringify(state)) as State;
		expect(projectForTeam(roundtrip, "alpha")).toEqual(
			projectForTeam(state, "alpha"),
		);
		expect(teamScores(roundtrip)).toEqual(teamScores(state));
	});
	test("declared budget bounds saturated state at maximum roster", () => {
		let state = initialState(
			{
				...context,
				teamIds: ["a".repeat(128)],
				eventId: "事".repeat(256),
				matchSecret: "a".repeat(128),
			},
			{ generation: 1000000 },
		);
		const teamId = "a".repeat(128);
		for (let i = 0; i < 80; i++) {
			const op = answer(state, "identity", "account", "wrong", [], teamId);
			op.id = `${i}`.padEnd(64, "x");
			state = applyOp(state, teamId, op);
		}
		const saturated = structuredClone(state.teams[teamId]!);
		saturated.revision = 1_000_000;
		for (const p of Object.values(saturated.progress)) {
			p.attempts = 1_000_000;
			p.unlockedHints = 3;
			p.solved = true;
		}
		saturated.score = 300;
		state.teams = Object.fromEntries(
			Array.from({ length: 100 }, (_, i) => [
				`t${i}`.padEnd(128, "x"),
				structuredClone(saturated),
			]),
		);
		const serializedBytes = Buffer.byteLength(JSON.stringify(state), "utf8");
		expect(serializedBytes).toBeLessThanOrEqual(2048 + 100 * 16384);
		expect(serializedBytes).toBeLessThan(2 * 1024 * 1024);
		const anyTeam = Object.keys(state.teams)[0]!;
		expect(
			validateOp(state, anyTeam, {
				kind: "hint",
				generation: state.generation,
				id: "after-limit",
				revision: 1_000_000,
				caseId: "timeline",
				questionId: "bytes",
				rung: 1,
			}),
		).toEqual({ ok: false, error: "operation_limit" });
	});
});
