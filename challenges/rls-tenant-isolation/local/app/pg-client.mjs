/**
 * pg-client — the live Postgres adapter the grader drives inside the container.
 *
 * It implements the same control surface the grader expects (getDocument /
 * patchDocument / insertDocument / deleteDocument / anonGetDocuments) by running
 * each call in a transaction where the request identity is bound to the two
 * Supabase/PostgREST GUCs:
 *
 *   request.jwt.role  -> 'authenticated' for a signed-in actor, 'anon' otherwise
 *   app.user_id       -> the actor's user id ('' for the anon/public client)
 *
 * Every statement runs as the non-superuser `app_api` role (set role app_api),
 * so RLS actually binds — connecting as the superuser/table-owner would silently
 * bypass it. A policy denial surfaces as a thrown error or as zero rows, both of
 * which the grader reads as "attack blocked".
 *
 * This file is the seam the unit tests replace with a fake; the grader logic
 * itself (grade.mjs) has no Postgres dependency.
 */

/**
 * @param {import('postgres').Sql} sql  a `postgres` client connected as a
 *   superuser/owner (so it can `set role`), pointed at the problem database.
 */
export function createPgGraderClient(sql) {
  function authenticated(actor) {
    return { role: "authenticated", userId: actor.userId };
  }

  return {
    async getDocument(actor, documentId) {
      const rows = await runRead(sql, authenticated(actor), documentId);
      return { rows };
    },

    async anonGetDocuments() {
      const rows = await runAnonList(sql);
      return { rows };
    },

    async patchDocument(actor, documentId, patch) {
      return runWrite(sql, authenticated(actor), async (tx) => {
        const updated = await tx`
          update public.documents
          set title = coalesce(${patch.title ?? null}, title),
              body  = coalesce(${patch.body ?? null}, body)
          where id = ${documentId}
          returning id`;
        return { ok: true, rowsAffected: updated.count };
      });
    },

    async insertDocument(actor, doc) {
      return runWrite(sql, authenticated(actor), async (tx) => {
        const inserted = await tx`
          insert into public.documents (organization_id, title, body, created_by)
          values (${doc.organization_id}, ${doc.title}, ${doc.body ?? ""}, ${actor.userId})
          returning id`;
        return { ok: true, rowsAffected: inserted.count };
      });
    },

    async deleteDocument(actor, documentId) {
      return runWrite(sql, authenticated(actor), async (tx) => {
        const deleted = await tx`
          delete from public.documents where id = ${documentId} returning id`;
        return { ok: true, rowsAffected: deleted.count };
      });
    },
  };
}

// --- transaction helpers -----------------------------------------------------
// Each opens its own transaction, binds identity + app_api role, runs, and rolls
// back so grading is side-effect free. A thrown RLS/permission error propagates
// and the grader treats it as a blocked (passing) attack.

async function runRead(sql, identity, documentId) {
  return withIdentity(sql, identity, async (tx) => {
    const rows = await tx`
      select id, organization_id, title, body, created_by
      from public.documents where id = ${documentId}`;
    return [...rows];
  });
}

async function runAnonList(sql) {
  return withIdentity(sql, { role: "anon", userId: "" }, async (tx) => {
    const rows = await tx`select id, organization_id, title from public.documents`;
    return [...rows];
  });
}

async function runWrite(sql, identity, fn) {
  return withIdentity(sql, identity, fn);
}

async function withIdentity(sql, identity, fn) {
  let captured;
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe("set local role app_api");
      await tx`select set_config('request.jwt.role', ${identity.role}, true)`;
      await tx`select set_config('app.user_id', ${identity.userId}, true)`;
      captured = await fn(tx);
      throw new RollbackSignal(); // never persist grader probes
    });
  } catch (error) {
    if (error instanceof RollbackSignal) return captured;
    throw error;
  }
  return captured;
}

class RollbackSignal extends Error {
  constructor() {
    super("__grader_rollback__");
    this.name = "RollbackSignal";
  }
}
