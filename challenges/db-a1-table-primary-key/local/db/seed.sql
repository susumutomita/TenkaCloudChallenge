-- db-a1-table-primary-key — seed data for training.members_unkeyed.
--
-- 7 real people, 11 rows. `aoi`, `kenji`, and `ren` were each inserted more than
-- once (a re-registration, a test row, a retry after a timeout — the kind of
-- thing that happens in a real system with no constraint to stop it). Every row
-- has its own `id` and is a genuinely separate physical row, even where the
-- `email` — the thing that actually identifies a member — repeats.
insert into training.members_unkeyed (email, display_name) values
  ('aoi@example.com',   'Aoi Tanaka'),
  ('aoi@example.com',   'Aoi T.'),
  ('aoi@example.com',   'Aoi Tanaka (dup)'),
  ('kenji@example.com', 'Kenji Sato'),
  ('kenji@example.com', 'Kenji Sato'),
  ('mio@example.com',   'Mio Suzuki'),
  ('ren@example.com',   'Ren Yamamoto'),
  ('ren@example.com',   'Ren Yamamoto'),
  ('sara@example.com',  'Sara Kobayashi'),
  ('taro@example.com',  'Taro Watanabe'),
  ('yui@example.com',   'Yui Nakamura');
