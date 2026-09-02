-- ============================================================
-- ASAS — Migration 004: CR Attendance Access (RLS)
-- Adds: is_cr_of_lecture() function + CR-scoped policies on
--       student_attendance and attendance_sessions.
-- Safe to run on the existing live database — purely additive,
-- does not touch or replace the existing admin policies.
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_cr_of_lecture(schedule_id UUID)
RETURNS boolean SECURITY DEFINER AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.daily_schedule ds
    JOIN public.cr_users cr ON cr.course_id = ds.course_id
    WHERE ds.id = schedule_id
      AND cr.id = auth.uid()
      AND cr.is_active = true
  );
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'student_attendance' AND policyname = 'CR can view own course attendance') THEN
        CREATE POLICY "CR can view own course attendance" ON public.student_attendance FOR SELECT
          USING (public.is_cr_of_lecture(daily_schedule_id));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'student_attendance' AND policyname = 'CR can insert own course attendance') THEN
        CREATE POLICY "CR can insert own course attendance" ON public.student_attendance FOR INSERT
          WITH CHECK (
            public.is_cr_of_lecture(daily_schedule_id)
            AND NOT EXISTS (SELECT 1 FROM public.attendance_sessions s WHERE s.daily_schedule_id = student_attendance.daily_schedule_id AND s.is_locked = true)
          );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'student_attendance' AND policyname = 'CR can update own course attendance if unlocked') THEN
        CREATE POLICY "CR can update own course attendance if unlocked" ON public.student_attendance FOR UPDATE
          USING (
            public.is_cr_of_lecture(daily_schedule_id)
            AND NOT EXISTS (SELECT 1 FROM public.attendance_sessions s WHERE s.daily_schedule_id = student_attendance.daily_schedule_id AND s.is_locked = true)
          )
          WITH CHECK (public.is_cr_of_lecture(daily_schedule_id));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'attendance_sessions' AND policyname = 'CR can view own course sessions') THEN
        CREATE POLICY "CR can view own course sessions" ON public.attendance_sessions FOR SELECT
          USING (public.is_cr_of_lecture(daily_schedule_id));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'attendance_sessions' AND policyname = 'CR can insert own course sessions') THEN
        CREATE POLICY "CR can insert own course sessions" ON public.attendance_sessions FOR INSERT
          WITH CHECK (public.is_cr_of_lecture(daily_schedule_id) AND is_locked = false);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'attendance_sessions' AND policyname = 'CR can update own course sessions if unlocked') THEN
        CREATE POLICY "CR can update own course sessions if unlocked" ON public.attendance_sessions FOR UPDATE
          USING (public.is_cr_of_lecture(daily_schedule_id) AND is_locked = false)
          WITH CHECK (public.is_cr_of_lecture(daily_schedule_id) AND is_locked = false);
    END IF;
END $$;
