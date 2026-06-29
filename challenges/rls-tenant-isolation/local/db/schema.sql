-- rls-tenant-isolation — domain schema for the document-management SaaS.
--
-- This mirrors a Supabase project: a `public` schema reached through PostgREST,
-- where the tenant boundary MUST be enforced by Postgres Row Level Security, not
-- by the application. The schema below is the same in the broken and the fixed
-- state; only the RLS policies differ (see broken-policies.sql vs the reference
-- solution under solution/policies.sql).
--
-- A request's identity is carried in two GUCs that the API sets per transaction,
-- exactly the way Supabase's PostgREST binds the JWT:
--   request.jwt.role    -> 'authenticated' | 'anon'
--   app.user_id         -> the signed-in user's id ('' for the anon/public client)
-- Policies read these via current_user_id() / is_authenticated() below.

create schema if not exists app;

-- ---------------------------------------------------------------------------
-- Identity helpers — the only sanctioned way a policy learns "who is asking".
-- ---------------------------------------------------------------------------

-- The signed-in user's id, or NULL for the anon/public client. SECURITY DEFINER
-- is deliberately NOT used: these read request-scoped GUCs, not privileged data.
create or replace function app.current_user_id() returns text
  language sql stable
  as $$ select nullif(current_setting('app.user_id', true), '') $$;

create or replace function app.is_authenticated() returns boolean
  language sql stable
  as $$ select current_setting('request.jwt.role', true) = 'authenticated' $$;

-- The organizations the current user belongs to (drives every documents policy).
create or replace function app.current_org_ids() returns setof uuid
  language sql stable
  as $$
    select m.organization_id
    from public.memberships m
    where m.user_id = app.current_user_id()
  $$;

-- True when the current user is an OWNER of the given organization.
create or replace function app.is_owner_of(org uuid) returns boolean
  language sql stable
  as $$
    select exists (
      select 1 from public.memberships m
      where m.user_id = app.current_user_id()
        and m.organization_id = org
        and m.role = 'owner'
    )
  $$;

-- ---------------------------------------------------------------------------
-- Domain tables.
-- ---------------------------------------------------------------------------

create table if not exists public.organizations (
  id   uuid primary key default gen_random_uuid(),
  name text not null
);

create table if not exists public.memberships (
  user_id         text not null,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  role            text not null check (role in ('owner', 'member')),
  primary key (user_id, organization_id)
);

create table if not exists public.documents (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  title           text not null,
  body            text not null default '',
  created_by      text not null,
  created_at      timestamptz not null default now()
);

create index if not exists documents_org_idx on public.documents (organization_id);

-- The API connects as this NON-superuser, login role. RLS does NOT apply to the
-- table owner / superuser, so the app MUST run as a role that RLS binds to —
-- otherwise "enabling RLS" silently does nothing. This is the role PostgREST
-- would use for both 'authenticated' and 'anon' requests.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_api') then
    create role app_api login password 'app_api_local_only';
  end if;
end
$$;

grant usage on schema app, public to app_api;
grant execute on all functions in schema app to app_api;
grant select, insert, update, delete on public.documents to app_api;
grant select on public.organizations, public.memberships to app_api;
