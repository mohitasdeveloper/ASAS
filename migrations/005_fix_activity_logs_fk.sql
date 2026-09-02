-- ============================================================
-- ASAS — Migration 005: Fix activity_logs.user_id foreign key
--
-- Bug: activity_logs.user_id referenced admin_users(id), so the
-- log_table_change() audit trigger threw a foreign-key violation
-- (and rolled back the whole save) any time a non-admin — CR,
-- and eventually faculty — wrote to an audited table. Every
-- role's id lives in auth.users, so the FK should point there.
--
-- Safe to run on the existing live database: existing rows' user_id
-- values are all admin ids, which are also auth.users ids (admin_users.id
-- IS the auth.users id), so nothing becomes orphaned by this change.
-- ============================================================

ALTER TABLE public.activity_logs DROP CONSTRAINT IF EXISTS activity_logs_user_id_fkey;
ALTER TABLE public.activity_logs ADD CONSTRAINT activity_logs_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
