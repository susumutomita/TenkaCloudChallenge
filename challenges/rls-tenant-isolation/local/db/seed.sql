-- rls-tenant-isolation — seed data.
--
-- Two companies (Acme, Beacon), two users each (one owner + one member), and
-- several documents per company. The grader's attack assertions read/modify
-- these rows across the tenant boundary; a correct RLS implementation keeps each
-- company's rows invisible and immutable to the other.
--
-- User ids are stable strings (the API maps a login key to one of these). No
-- secret lives here: the challenge is structural (is the boundary enforced?),
-- not a discovered flag.

insert into public.organizations (id, name) values
  ('00000000-0000-0000-0000-0000000000a1', 'Acme Corp'),
  ('00000000-0000-0000-0000-0000000000b1', 'Beacon Inc')
on conflict (id) do nothing;

insert into public.memberships (user_id, organization_id, role) values
  ('alice-owner',  '00000000-0000-0000-0000-0000000000a1', 'owner'),
  ('amir-member',  '00000000-0000-0000-0000-0000000000a1', 'member'),
  ('bella-owner',  '00000000-0000-0000-0000-0000000000b1', 'owner'),
  ('ben-member',   '00000000-0000-0000-0000-0000000000b1', 'member')
on conflict (user_id, organization_id) do nothing;

insert into public.documents (id, organization_id, title, body, created_by) values
  ('00000000-0000-0000-0000-00000000ad01', '00000000-0000-0000-0000-0000000000a1',
   'Acme Q3 roadmap', 'Acme confidential roadmap.', 'alice-owner'),
  ('00000000-0000-0000-0000-00000000ad02', '00000000-0000-0000-0000-0000000000a1',
   'Acme pricing memo', 'Internal pricing for Acme only.', 'amir-member'),
  ('00000000-0000-0000-0000-00000000ad03', '00000000-0000-0000-0000-0000000000a1',
   'Acme hiring plan', 'Acme headcount.', 'alice-owner'),
  ('00000000-0000-0000-0000-00000000bd01', '00000000-0000-0000-0000-0000000000b1',
   'Beacon launch plan', 'Beacon confidential launch plan.', 'bella-owner'),
  ('00000000-0000-0000-0000-00000000bd02', '00000000-0000-0000-0000-0000000000b1',
   'Beacon budget', 'Beacon budget for B only.', 'ben-member'),
  ('00000000-0000-0000-0000-00000000bd03', '00000000-0000-0000-0000-0000000000b1',
   'Beacon vendor list', 'Beacon vendors.', 'bella-owner')
on conflict (id) do nothing;
