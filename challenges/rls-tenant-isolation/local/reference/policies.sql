-- rls-tenant-isolation — REFERENCE SOLUTION (answer key).
--
-- This is one correct way to enforce the tenant boundary in the database. It is
-- here so reviewers and operators can confirm the problem is solvable and so a
-- stuck participant can compare after attempting. To run it, copy its body into
-- solution/policies.sql and restart the container.
--
-- Design: RLS is enabled and FORCED (so even a future table-owner connection is
-- bound), then four explicit policies — one per operation — express the tenant
-- boundary and the role split. WITH CHECK on INSERT/UPDATE pins organization_id
-- to one of the caller's own orgs, which is what stops both "insert into another
-- org" and "update organization_id to hand a row to another org".

alter table public.documents enable row level security;
-- FORCE so the boundary holds even if the app ever connects as the table owner;
-- "enable" alone is bypassed by the owner/superuser.
alter table public.documents force row level security;

-- SELECT: a row is visible only to members of its organization. The anon client
-- has no memberships and is not authenticated, so current_org_ids() is empty and
-- it sees nothing.
create policy documents_select_own_org on public.documents
  for select
  using (
    app.is_authenticated()
    and organization_id in (select app.current_org_ids())
  );

-- INSERT: a member or owner may create a document, but WITH CHECK forces the new
-- row's organization_id to be one of the caller's own orgs — an INSERT carrying
-- another org's id is rejected.
create policy documents_insert_own_org on public.documents
  for insert
  with check (
    app.is_authenticated()
    and organization_id in (select app.current_org_ids())
  );

-- UPDATE: USING limits which rows can be targeted (own org only); WITH CHECK
-- limits what they can become — organization_id may not be moved to another org,
-- which blocks reassigning ownership across the tenant boundary.
--
-- Operator note (Issue #542): omitting this WITH CHECK does not by itself open
-- the boundary. Postgres reuses the USING expression as the WITH CHECK
-- expression when none is given, and the new row must also satisfy the SELECT
-- policies — with a tenant-scoped SELECT policy either rule alone already
-- rejects the moved row. It is spelled out anyway because those are incidental
-- guards: a SELECT policy that also admits rows by author, plus a WITH CHECK
-- that does not name organization_id, is enough to make the row movable. The
-- grader's `a-owner-cannot-move-doc-to-b` assertion checks that behaviour
-- directly rather than trusting the spelling.
create policy documents_update_own_org on public.documents
  for update
  using (
    app.is_authenticated()
    and organization_id in (select app.current_org_ids())
  )
  with check (
    organization_id in (select app.current_org_ids())
  );

-- DELETE: owner-only. A member's delete matches no policy row and is denied.
create policy documents_delete_owner_only on public.documents
  for delete
  using (
    app.is_authenticated()
    and app.is_owner_of(organization_id)
  );
