/**
 * Unit tests for the api-idor-demo authorization/response-shaping helpers.
 *
 * These run with `bun test` against plain in-memory rows — no `node:sqlite`,
 * no HTTP, no Docker. server.mjs itself can't be imported here: Bun does not
 * implement `node:sqlite` and the module opens a database + starts listening
 * as a side effect of import, so the DB-free logic lives in authorization.mjs
 * specifically so it stays testable (mirrors the rls-tenant-isolation grader
 * pattern: pure decision logic separated from the thing that talks to a DB).
 */
import { describe, expect, it } from "bun:test";
import { listProfilesFor, profileOf } from "./authorization.mjs";

const ADMIN = { id: 1, username: "root", role: "admin", secret_note: "TC{flag}" };
const ALICE = { id: 2, username: "alice", role: "user", secret_note: "rotate the staging keys" };
const GUEST = { id: 3, username: "guest", role: "user", secret_note: "Welcome! This is your demo account." };
const ALL_ROWS = [ADMIN, ALICE, GUEST];

describe("profileOf (full record — backs the intentionally-vulnerable single-object routes)", () => {
  it("should include the private note — this over-exposure is the deliberate bug, not a regression", () => {
    expect(profileOf(ADMIN)).toEqual({ id: 1, username: "root", role: "admin", note: "TC{flag}" });
  });
});

describe("listProfilesFor (GET /api/profiles authorization model)", () => {
  it("should return only the caller's own profile for a non-admin caller", () => {
    const result = listProfilesFor(ALL_ROWS, GUEST);
    expect(result).toEqual([{ id: 3, username: "guest", role: "user" }]);
  });

  it("should never include another user's record for a non-admin caller", () => {
    const result = listProfilesFor(ALL_ROWS, GUEST);
    const ids = result.map((profile) => profile.id);
    expect(ids).not.toContain(ADMIN.id);
    expect(ids).not.toContain(ALICE.id);
  });

  it("should never leak secret_note through the list response, even for the admin's own row", () => {
    const asGuest = listProfilesFor(ALL_ROWS, GUEST);
    const asAdmin = listProfilesFor(ALL_ROWS, ADMIN);
    for (const profile of [...asGuest, ...asAdmin]) {
      expect(profile).not.toHaveProperty("note");
      expect(profile).not.toHaveProperty("secret_note");
      expect(Object.keys(profile).sort()).toEqual(["id", "role", "username"]);
    }
  });

  it("should scope a regular user (alice) to just her own profile, same as guest", () => {
    const result = listProfilesFor(ALL_ROWS, ALICE);
    expect(result).toEqual([{ id: 2, username: "alice", role: "user" }]);
  });

  it("should let an admin caller see every profile, still least-privilege-shaped", () => {
    const result = listProfilesFor(ALL_ROWS, ADMIN);
    expect(result).toEqual([
      { id: 1, username: "root", role: "admin" },
      { id: 2, username: "alice", role: "user" },
      { id: 3, username: "guest", role: "user" },
    ]);
  });

  it("should return an empty list rather than throw when there is nothing to show", () => {
    expect(listProfilesFor([], GUEST)).toEqual([]);
  });
});
