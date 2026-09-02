-- ============================================================
-- ASAS — Migration 003: Attendance Sessions (proof photo + lock)
-- Adds: attendance_sessions
-- Safe to run on the existing live database — purely additive.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.attendance_sessions (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    daily_schedule_id UUID NOT NULL,
    proof_image_url TEXT,
    is_locked BOOLEAN NOT NULL DEFAULT false,
    locked_by UUID,
    locked_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT attendance_sessions_pkey PRIMARY KEY (id),
    CONSTRAINT attendance_sessions_daily_schedule_id_key UNIQUE (daily_schedule_id),
    CONSTRAINT attendance_sessions_daily_schedule_id_fkey FOREIGN KEY (daily_schedule_id) REFERENCES public.daily_schedule(id) ON DELETE CASCADE,
    CONSTRAINT attendance_sessions_locked_by_fkey FOREIGN KEY (locked_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.attendance_sessions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'attendance_sessions' AND policyname = 'Allow full access for administrators') THEN
        CREATE POLICY "Allow full access for administrators" ON public.attendance_sessions FOR ALL USING (public.is_admin());
    END IF;
END $$;

DROP TRIGGER IF EXISTS audit_attendance_sessions_changes ON public.attendance_sessions;
CREATE TRIGGER audit_attendance_sessions_changes AFTER INSERT OR UPDATE OR DELETE ON public.attendance_sessions FOR EACH ROW EXECUTE FUNCTION public.log_table_change();
