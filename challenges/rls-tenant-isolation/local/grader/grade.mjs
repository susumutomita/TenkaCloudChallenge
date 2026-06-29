/**
 * rls-tenant-isolation — automated grader (the primary evaluation).
 *
 * This module is intentionally PURE and dependency-injected: it never opens a
 * socket or a Postgres connection itself. It drives an injected `client` that
 * models exactly what an attacker (or a normal user) can do against the running
 * document-management API / Supabase project:
 *
 *   client.getDocument(actor, documentId)        -> { rows: Doc[] }            | throws
 *   client.patchDocument(actor, documentId, p)   -> { ok, rowsAffected }       | throws
 *   client.insertDocument(actor, doc)            -> { ok }                      | throws
 *   client.deleteDocument(actor, documentId)     -> { ok, rowsAffected }       | throws
 *   client.anonGetDocuments()                    -> { rows: Doc[] }            | throws
 *
 * An `actor` is `{ jwt, userId, organizationId, role }`. The grader supplies the
 * actors from the seed; the client binds them to the right authenticated session
 * (a real JWT/role in the container, a fake in unit tests).
 *
 * Each of the 7 attack assertions resolves to a `{ id, label, passed, detail }`
 * result. A blocked attack (RLS did its job) is a PASS. The overall verdict is
 * "all 7 passed". `/verify` reports it; the platform records the verdict and
 * never sees the policies themselves.
 *
 * Why this shape: the same control surface is enforceable both ways. App-side
 * `WHERE organization_id = $me` filtering is bypassable (param tampering, the
 * anon/public client, a forgotten code path). RLS in Postgres is the last line
 * of defense — it denies the row no matter which code path reaches it. The
 * assertions deliberately attack via direct id swaps and the anon key so that a
 * frontend-only "fix" still fails.
 */

/**
 * A blocked read is "0 rows returned" OR "the request was rejected" (403/404 in
 * the HTTP shape, or a thrown authorization error). A leaked read is "1+ rows of
 * someone else's data came back". This helper normalises both client shapes.
 */
function readWasBlocked(outcome) {
  if (outcome instanceof Error) return true;
  if (outcome && outcome.error) return true;
  const rows = outcome && Array.isArray(outcome.rows) ? outcome.rows : [];
  return rows.length === 0;
}

/** A blocked write is a thrown error, an explicit `ok:false`, or 0 rows affected. */
function writeWasBlocked(outcome) {
  if (outcome instanceof Error) return true;
  if (!outcome) return true;
  if (outcome.error || outcome.ok === false) return true;
  if (typeof outcome.rowsAffected === "number" && outcome.rowsAffected === 0) return true;
  return false;
}

/** Run a client call and capture a thrown error as a value (so assertions can branch on it). */
async function attempt(fn) {
  try {
    return await fn();
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

/**
 * The 7 attack assertions, in issue order. Each takes the injected `client` and
 * the resolved `actors`/`docs` from the seed and returns a result object.
 *
 * actors: { aMember, aOwner, bMember, bOwner }
 * docs:   { aDoc, bDoc } — a document owned by org A / org B respectively
 */
export const ASSERTIONS = [
  {
    id: "a-user-reads-own-doc",
    label: "A-user JWT GET A-doc -> 200 (own org is visible)",
    async run(client, actors, docs) {
      const outcome = await attempt(() => client.getDocument(actors.aOwner, docs.aDoc.id));
      const rows = outcome instanceof Error ? [] : (outcome.rows ?? []);
      const passed = !readWasBlocked(outcome) && rows.some((r) => r.id === docs.aDoc.id);
      return {
        passed,
        detail: passed
          ? "A-user read their own document."
          : "A-user could NOT read their own document — RLS over-restricts the owner.",
      };
    },
  },
  {
    id: "a-user-cannot-read-b-doc",
    label: "A-user JWT GET B-doc -> 0 rows / 403 / 404 (cross-tenant read blocked)",
    async run(client, actors, docs) {
      const outcome = await attempt(() => client.getDocument(actors.aOwner, docs.bDoc.id));
      const passed = readWasBlocked(outcome);
      return {
        passed,
        detail: passed
          ? "Cross-tenant read was blocked."
          : "LEAK: A-user read company B's document by swapping the id.",
      };
    },
  },
  {
    id: "a-user-cannot-patch-b-doc",
    label: "A-user JWT PATCH B-doc -> fails (cross-tenant update blocked)",
    async run(client, actors, docs) {
      const outcome = await attempt(() =>
        client.patchDocument(actors.aOwner, docs.bDoc.id, { title: "pwned-by-a" }),
      );
      const passed = writeWasBlocked(outcome);
      return {
        passed,
        detail: passed
          ? "Cross-tenant update was blocked."
          : "LEAK: A-user modified company B's document.",
      };
    },
  },
  {
    id: "a-user-cannot-insert-into-b",
    label: "A-user JWT INSERT with B org_id -> fails (WITH CHECK blocks reassignment)",
    async run(client, actors, docs) {
      const outcome = await attempt(() =>
        client.insertDocument(actors.aOwner, {
          organization_id: docs.bDoc.organization_id,
          title: "smuggled",
          body: "planted into org B",
        }),
      );
      const passed = writeWasBlocked(outcome);
      return {
        passed,
        detail: passed
          ? "INSERT with a foreign organization_id was blocked (WITH CHECK)."
          : "LEAK: A-user inserted a row into company B by setting organization_id.",
      };
    },
  },
  {
    id: "member-cannot-delete",
    label: "member DELETE own doc -> fails (member is read+create only)",
    async run(client, actors, docs) {
      const outcome = await attempt(() => client.deleteDocument(actors.aMember, docs.aDoc.id));
      const passed = writeWasBlocked(outcome);
      return {
        passed,
        detail: passed
          ? "member DELETE was blocked (role policy)."
          : "ROLE BREAK: a member deleted a document; delete must be owner-only.",
      };
    },
  },
  {
    id: "owner-can-delete",
    label: "owner DELETE own doc -> succeeds (owner has full control of own org)",
    async run(client, actors, docs) {
      const outcome = await attempt(() => client.deleteDocument(actors.aOwner, docs.aDoc.id));
      const passed = !writeWasBlocked(outcome);
      return {
        passed,
        detail: passed
          ? "owner DELETE of an own-org document succeeded."
          : "owner could NOT delete their own document — the owner policy is missing/over-restrictive.",
      };
    },
  },
  {
    id: "anon-cannot-read",
    label: "anon key GET documents -> fails (public client is not a tenant)",
    async run(client) {
      const outcome = await attempt(() => client.anonGetDocuments());
      const passed = readWasBlocked(outcome);
      return {
        passed,
        detail: passed
          ? "The anonymous/public client read no documents."
          : "LEAK: the anon key listed documents; RLS is not enabled or a policy allows anon.",
      };
    },
  },
];

/**
 * Drive every assertion against the injected client and produce a verdict.
 *
 * Returns:
 *   {
 *     correct: boolean,                 // true only when ALL assertions pass
 *     passedCount, total,
 *     results: [{ id, label, passed, detail }, ...]
 *   }
 *
 * `correct` is what `POST /verify` returns to the platform. The platform records
 * the verdict and never sees the seed, the actors, or the policy SQL.
 */
export async function runGrader(client, { actors, docs }) {
  const results = [];
  for (const assertion of ASSERTIONS) {
    const outcome = await assertion.run(client, actors, docs);
    results.push({ id: assertion.id, label: assertion.label, ...outcome });
  }
  const passedCount = results.filter((r) => r.passed).length;
  return {
    correct: passedCount === ASSERTIONS.length,
    passedCount,
    total: ASSERTIONS.length,
    results,
  };
}
