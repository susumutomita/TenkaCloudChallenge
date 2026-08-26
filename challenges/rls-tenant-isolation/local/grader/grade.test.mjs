/**
 * Unit tests for the rls-tenant-isolation grader.
 *
 * These run with `bun test` and use INJECTED FAKE clients — no live Postgres,
 * no Supabase, no network. The fakes model the two states the participant can
 * be in:
 *   - BrokenClient:  app-side filtering only / RLS disabled (every leak succeeds)
 *   - SecureClient:  RLS enforced (cross-tenant + role + anon attacks all blocked)
 *
 * The grader's job is to turn those behaviours into a verdict, so the tests pin
 * exactly that: the secure state passes all 8, the broken state fails, and each
 * individual leak is attributed to the right assertion. A third fixture,
 * UpdateWithCheckIgnoresOrgClient, targets one specific regression (issue
 * #542): an UPDATE policy whose WITH CHECK is present but does not constrain
 * organization_id, which used to score 7/7 because nothing exercised UPDATE's
 * WITH CHECK directly. (Omitting WITH CHECK on UPDATE entirely is NOT this
 * bug — verified against live Postgres, an absent WITH CHECK falls back to
 * re-checking the policy's own USING against the new row, so a correctly
 * org-scoped USING already blocks the reassignment on its own.)
 */
import { describe, expect, it } from "bun:test";
import { ASSERTIONS, runGrader } from "./grade.mjs";

const ORG_A = "org-a";
const ORG_B = "org-b";

const actors = {
  aMember: { userId: "a-member", organizationId: ORG_A, role: "member" },
  aOwner: { userId: "a-owner", organizationId: ORG_A, role: "owner" },
  bMember: { userId: "b-member", organizationId: ORG_B, role: "member" },
  bOwner: { userId: "b-owner", organizationId: ORG_B, role: "owner" },
};

const docs = {
  aDoc: { id: "doc-a-1", organization_id: ORG_A, title: "A roadmap" },
  bDoc: { id: "doc-b-1", organization_id: ORG_B, title: "B roadmap" },
};

const allDocs = () => [
  { ...docs.aDoc },
  { ...docs.bDoc },
];

/**
 * A correctly-RLS'd backend: a row is only visible/mutable when the actor's
 * organization matches the row's organization, delete is owner-only, INSERT is
 * pinned to the actor's own org (WITH CHECK), and the anon client sees nothing.
 */
class SecureClient {
  constructor() {
    this.rows = allDocs();
  }
  #find(id) {
    return this.rows.find((r) => r.id === id);
  }
  async getDocument(actor, id) {
    const row = this.#find(id);
    const visible = row && row.organization_id === actor.organizationId ? [row] : [];
    return { rows: visible };
  }
  async patchDocument(actor, id, patch) {
    const row = this.#find(id);
    if (!row || row.organization_id !== actor.organizationId) return { ok: true, rowsAffected: 0 };
    Object.assign(row, patch);
    return { ok: true, rowsAffected: 1 };
  }
  async insertDocument(actor, doc) {
    // WITH CHECK: an INSERT must land in the actor's own org or it is rejected.
    if (doc.organization_id !== actor.organizationId) {
      throw new Error("new row violates row-level security policy");
    }
    this.rows.push({ id: `doc-${this.rows.length + 1}`, ...doc });
    return { ok: true, rowsAffected: 1 };
  }
  async deleteDocument(actor, id) {
    const row = this.#find(id);
    if (!row || row.organization_id !== actor.organizationId) return { ok: true, rowsAffected: 0 };
    if (actor.role !== "owner") return { ok: true, rowsAffected: 0 }; // member cannot delete
    this.rows = this.rows.filter((r) => r.id !== id);
    return { ok: true, rowsAffected: 1 };
  }
  async anonGetDocuments() {
    return { rows: [] }; // RLS denies the anon/public role
  }
  async updateDocumentOrganization(actor, id, newOrganizationId) {
    const row = this.#find(id);
    if (!row || row.organization_id !== actor.organizationId) return { ok: true, rowsAffected: 0 }; // USING gates the target row
    // WITH CHECK: the row's new organization_id must still be the actor's own org.
    if (newOrganizationId !== actor.organizationId) {
      throw new Error("new row violates row-level security policy");
    }
    row.organization_id = newOrganizationId;
    return { ok: true, rowsAffected: 1 };
  }
}

/**
 * The vulnerable starter backend: NO RLS, app-side filtering forgotten on the
 * by-id paths. Every cross-tenant and anon attack succeeds; a member can delete.
 */
class BrokenClient {
  constructor() {
    this.rows = allDocs();
  }
  #find(id) {
    return this.rows.find((r) => r.id === id);
  }
  async getDocument(_actor, id) {
    const row = this.#find(id);
    return { rows: row ? [row] : [] }; // returns ANY org's row by id
  }
  async patchDocument(_actor, id, patch) {
    const row = this.#find(id);
    if (!row) return { ok: true, rowsAffected: 0 };
    Object.assign(row, patch);
    return { ok: true, rowsAffected: 1 }; // patches ANY org's row
  }
  async insertDocument(_actor, doc) {
    this.rows.push({ id: `doc-${this.rows.length + 1}`, ...doc });
    return { ok: true, rowsAffected: 1 }; // accepts any organization_id
  }
  async deleteDocument(_actor, id) {
    this.rows = this.rows.filter((r) => r.id !== id);
    return { ok: true, rowsAffected: 1 }; // member can delete, cross-tenant too
  }
  async anonGetDocuments() {
    return { rows: this.rows }; // anon lists everything
  }
  async updateDocumentOrganization(_actor, id, newOrganizationId) {
    const row = this.#find(id);
    if (!row) return { ok: true, rowsAffected: 0 };
    row.organization_id = newOrganizationId; // no RLS — reassigns ANY row's org
    return { ok: true, rowsAffected: 1 };
  }
}

/**
 * Regression fixture for issue #542: the UPDATE policy HAS a WITH CHECK
 * clause, but it does not constrain organization_id (e.g. it only re-checks
 * authentication, the same way requirement 4 was satisfied for INSERT without
 * carrying the same constraint over to UPDATE). This is otherwise a fully
 * correct SecureClient — cross-tenant reads/writes are blocked, INSERT
 * enforces its own separate WITH CHECK, delete is owner-only, anon reads
 * nothing — except that reassigning a user's OWN document to another org's
 * organization_id via UPDATE succeeds, because the UPDATE policy's WITH CHECK
 * never looks at organization_id. This is the exact submission shape that
 * used to score 7/7 before the grader checked UPDATE's WITH CHECK directly.
 */
class UpdateWithCheckIgnoresOrgClient extends SecureClient {
  async updateDocumentOrganization(actor, id, newOrganizationId) {
    const row = this.rows.find((r) => r.id === id);
    if (!row || row.organization_id !== actor.organizationId) return { ok: true, rowsAffected: 0 }; // USING still gates the target row
    row.organization_id = newOrganizationId; // WITH CHECK exists but never inspects organization_id — reassignment succeeds
    return { ok: true, rowsAffected: 1 };
  }
}

describe("rls-tenant-isolation grader", () => {
  it("should declare exactly the 8 issue assertions in order", () => {
    expect(ASSERTIONS.map((a) => a.id)).toEqual([
      "a-user-reads-own-doc",
      "a-user-cannot-read-b-doc",
      "a-user-cannot-patch-b-doc",
      "a-user-cannot-insert-into-b",
      "member-cannot-delete",
      "owner-can-delete",
      "anon-cannot-read",
      "owner-cannot-reassign-doc-org",
    ]);
  });

  it("should mark a correctly-RLS'd backend as correct with all 8 passing", async () => {
    const verdict = await runGrader(new SecureClient(), { actors, docs });
    expect(verdict.correct).toBe(true);
    expect(verdict.passedCount).toBe(8);
    expect(verdict.total).toBe(8);
    expect(verdict.results.every((r) => r.passed)).toBe(true);
  });

  it("should mark the vulnerable starter backend as incorrect", async () => {
    const verdict = await runGrader(new BrokenClient(), { actors, docs });
    expect(verdict.correct).toBe(false);
    expect(verdict.passedCount).toBeLessThan(8);
  });

  it("should fail ONLY the WITH-CHECK-on-UPDATE assertion when UPDATE's WITH CHECK does not constrain organization_id (issue #542)", async () => {
    const verdict = await runGrader(new UpdateWithCheckIgnoresOrgClient(), { actors, docs });
    const failed = verdict.results.filter((r) => !r.passed).map((r) => r.id);
    expect(failed).toEqual(["owner-cannot-reassign-doc-org"]);
    expect(verdict.passedCount).toBe(7);
    expect(verdict.correct).toBe(false);
  });

  it("should pass the WITH-CHECK-on-UPDATE assertion when UPDATE enforces WITH CHECK", async () => {
    const verdict = await runGrader(new SecureClient(), { actors, docs });
    const check = verdict.results.find((r) => r.id === "owner-cannot-reassign-doc-org");
    expect(check.passed).toBe(true);
  });

  it("should fail every leak/role assertion on the broken backend and only pass the two legitimate-access ones", async () => {
    const verdict = await runGrader(new BrokenClient(), { actors, docs });
    const failed = verdict.results.filter((r) => !r.passed).map((r) => r.id);
    expect(failed).toEqual([
      "a-user-cannot-read-b-doc",
      "a-user-cannot-patch-b-doc",
      "a-user-cannot-insert-into-b",
      "member-cannot-delete",
      "anon-cannot-read",
      "owner-cannot-reassign-doc-org",
    ]);
    // The two assertions that test legitimate access still pass on the broken app.
    const passed = verdict.results.filter((r) => r.passed).map((r) => r.id);
    expect(passed).toEqual(["a-user-reads-own-doc", "owner-can-delete"]);
  });

  it("should treat a thrown authorization error from the client as a blocked (passing) attack", async () => {
    const throwingClient = new SecureClient();
    throwingClient.getDocument = async (actor, id) => {
      if (id === docs.bDoc.id) throw new Error("permission denied for table documents");
      const row = allDocs().find((r) => r.id === id && r.organization_id === actor.organizationId);
      return { rows: row ? [row] : [] };
    };
    const verdict = await runGrader(throwingClient, { actors, docs });
    const crossRead = verdict.results.find((r) => r.id === "a-user-cannot-read-b-doc");
    expect(crossRead.passed).toBe(true);
  });

  it("should treat a 403/404 error-shaped read as blocked and an empty row set as blocked", async () => {
    const errorShaped = new SecureClient();
    errorShaped.anonGetDocuments = async () => ({ error: { status: 401 }, rows: [] });
    const verdict = await runGrader(errorShaped, { actors, docs });
    expect(verdict.results.find((r) => r.id === "anon-cannot-read").passed).toBe(true);
  });

  it("should fail the owner-delete assertion when the owner cannot delete their own document", async () => {
    const overRestrictive = new SecureClient();
    overRestrictive.deleteDocument = async () => ({ ok: true, rowsAffected: 0 }); // nobody can delete
    const verdict = await runGrader(overRestrictive, { actors, docs });
    expect(verdict.results.find((r) => r.id === "owner-can-delete").passed).toBe(false);
    expect(verdict.correct).toBe(false);
  });

  it("should fail the own-read assertion when RLS over-restricts the legitimate owner", async () => {
    const deniesOwnOrg = new SecureClient();
    deniesOwnOrg.getDocument = async () => ({ rows: [] });
    const verdict = await runGrader(deniesOwnOrg, { actors, docs });
    expect(verdict.results.find((r) => r.id === "a-user-reads-own-doc").passed).toBe(false);
  });
});
