/** Shared wire types only. Import these with `import type` from browser code. */
export interface Localized {
	ja: string;
	en: string;
}
export interface Evidence {
	id: string;
	name: string;
	content: string;
	sha256: string;
	description: Localized;
}
export interface Question {
	id: string;
	prompt: Localized;
	format: Localized;
	points: number;
	hints: Localized[];
	totalHints: 3;
	solved: boolean;
	attempts: number;
	unlockedHints: number;
	explanation?: Localized;
}
export interface Case {
	id: string;
	title: Localized;
	intro: Localized;
	evidence: Evidence[];
	questions: Question[];
}
export interface Result {
	kind: "answer" | "hint";
	caseId: string;
	questionId: string;
	status: "correct" | "incorrect" | "hint";
	message: Localized;
	pointsAwarded: number;
}
export interface Projection {
	teamId: string;
	score: number;
	maxScore: 400;
	revision: number;
	generation: number;
	lastResult: Result | null;
	cases: Case[];
}
interface BaseOp {
	id: string;
	revision: number;
	generation: number;
	caseId: string;
	questionId: string;
}
export interface AnswerOp extends BaseOp {
	kind: "answer";
	answer: string;
	evidenceIds: string[];
}
export interface HintOp extends BaseOp {
	kind: "hint";
	rung: 1 | 2 | 3;
}
export type Operation = AnswerOp | HintOp;
export interface Context {
	eventId: string;
	teamIds: readonly string[];
	matchSecret?: string;
	teamNames?: Readonly<Record<string, string>>;
}
export interface Progress {
	solved: boolean;
	attempts: number;
	unlockedHints: number;
}
export interface TeamState {
	score: number;
	revision: number;
	progress: Record<string, Progress>;
	receipts: { id: string; digest: string }[];
	lastResult: Result | null;
}
/** SERVER ONLY. Never serialize State in an HTTP response or pass it to a Portal component. */
export interface State {
	schemaVersion: 2;
	eventId: string;
	matchSecret: string;
	generation: number;
	teams: Record<string, TeamState>;
}
export type Validation = { ok: true } | { ok: false; error: string };
