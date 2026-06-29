-- rls-tenant-isolation — the VULNERABLE starting state (do not edit; this is the
-- "before" the participant fixes). RLS is disabled, so the `app_api` role can
-- read and modify EVERY company's rows. The starter API tries to filter by
-- organization_id in application code, but the by-id GET/PATCH/DELETE paths and
-- the anon client forget to — and even where it filters, a tampered id slips
-- through because nothing in the database denies the row.
--
-- The participant replaces this with real Row Level Security by filling in
-- solution/policies.sql (see the README). The container loads solution/policies.sql
-- when it is non-empty, otherwise it loads this file.

alter table public.documents disable row level security;

-- No policies. With RLS disabled, `app_api` sees and mutates all rows regardless
-- of which user the request claims to be — the tenant boundary exists only in
-- application code, which is bypassable.
