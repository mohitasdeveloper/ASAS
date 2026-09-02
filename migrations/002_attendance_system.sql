-- ============================================================
-- ASAS — Migration 002: Student Attendance System
-- Adds: students, mentorship, cr_users, student_attendance
-- Safe to run on the existing live database — purely additive.
-- Does NOT touch admin_users, faculty, courses, daily_schedule,
-- or lecture_execution (left in place, deprecated — see note below).
-- ============================================================

-- STEP 1: New enum type
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'attendance_status_enum') THEN
        CREATE TYPE attendance_status_enum AS ENUM ('not_marked', 'present', 'absent', 'late');
    END IF;
END $$;

-- STEP 2: New tables

CREATE TABLE IF NOT EXISTS public.students (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    student_id TEXT NOT NULL,
    first_name TEXT NOT NULL,
    middle_name TEXT,
    last_name TEXT NOT NULL,
    course_id UUID NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT students_pkey PRIMARY KEY (id),
    CONSTRAINT students_student_id_key UNIQUE (student_id),
    CONSTRAINT students_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.mentorship (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL,
    faculty_id UUID NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT mentorship_pkey PRIMARY KEY (id),
    CONSTRAINT mentorship_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE,
    CONSTRAINT mentorship_faculty_id_fkey FOREIGN KEY (faculty_id) REFERENCES public.faculty(id) ON DELETE CASCADE,
    CONSTRAINT mentorship_uniq UNIQUE (course_id, faculty_id)
);

CREATE TABLE IF NOT EXISTS public.cr_users (
    id UUID NOT NULL,
    full_name TEXT NOT NULL,
    course_id UUID NOT NULL,
    email TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT cr_users_pkey PRIMARY KEY (id),
    CONSTRAINT cr_users_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT cr_users_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.student_attendance (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    daily_schedule_id UUID NOT NULL,
    student_id UUID NOT NULL,
    status attendance_status_enum NOT NULL DEFAULT 'not_marked',
    remarks TEXT,
    marked_by UUID,
    marked_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT student_attendance_pkey PRIMARY KEY (id),
    CONSTRAINT student_attendance_daily_schedule_id_fkey FOREIGN KEY (daily_schedule_id) REFERENCES public.daily_schedule(id) ON DELETE CASCADE,
    CONSTRAINT student_attendance_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE,
    CONSTRAINT student_attendance_marked_by_fkey FOREIGN KEY (marked_by) REFERENCES auth.users(id) ON DELETE SET NULL,
    CONSTRAINT student_attendance_uniq UNIQUE (daily_schedule_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_student_attendance_schedule ON public.student_attendance (daily_schedule_id);
CREATE INDEX IF NOT EXISTS idx_student_attendance_student ON public.student_attendance (student_id);

-- STEP 3: Row-Level Security
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mentorship ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cr_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_attendance ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'cr_users' AND policyname = 'CR can read their own profile') THEN
        CREATE POLICY "CR can read their own profile" ON public.cr_users FOR SELECT USING (id = auth.uid());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'cr_users' AND policyname = 'Admins can manage cr_users') THEN
        CREATE POLICY "Admins can manage cr_users" ON public.cr_users FOR ALL USING (public.is_admin());
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'students' AND policyname = 'Allow public read access for authenticated users') THEN
        CREATE POLICY "Allow public read access for authenticated users" ON public.students FOR SELECT USING (auth.role() = 'authenticated');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'students' AND policyname = 'Allow full access for administrators') THEN
        CREATE POLICY "Allow full access for administrators" ON public.students FOR ALL USING (public.is_admin());
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'mentorship' AND policyname = 'Allow public read access for authenticated users') THEN
        CREATE POLICY "Allow public read access for authenticated users" ON public.mentorship FOR SELECT USING (auth.role() = 'authenticated');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'mentorship' AND policyname = 'Allow full access for administrators') THEN
        CREATE POLICY "Allow full access for administrators" ON public.mentorship FOR ALL USING (public.is_admin());
    END IF;

    -- Phase 1 (admin-only). Add faculty-mentor / CR-scoped policies here once
    -- their portals are built.
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'student_attendance' AND policyname = 'Allow full access for administrators') THEN
        CREATE POLICY "Allow full access for administrators" ON public.student_attendance FOR ALL USING (public.is_admin());
    END IF;
END $$;

-- STEP 4: Audit triggers (reuses the existing log_table_change() function)
DROP TRIGGER IF EXISTS audit_students_changes ON public.students;
CREATE TRIGGER audit_students_changes AFTER INSERT OR UPDATE OR DELETE ON public.students FOR EACH ROW EXECUTE FUNCTION public.log_table_change();

DROP TRIGGER IF EXISTS audit_mentorship_changes ON public.mentorship;
CREATE TRIGGER audit_mentorship_changes AFTER INSERT OR UPDATE OR DELETE ON public.mentorship FOR EACH ROW EXECUTE FUNCTION public.log_table_change();

DROP TRIGGER IF EXISTS audit_cr_users_changes ON public.cr_users;
CREATE TRIGGER audit_cr_users_changes AFTER INSERT OR UPDATE OR DELETE ON public.cr_users FOR EACH ROW EXECUTE FUNCTION public.log_table_change();

DROP TRIGGER IF EXISTS audit_student_attendance_changes ON public.student_attendance;
CREATE TRIGGER audit_student_attendance_changes AFTER INSERT OR UPDATE OR DELETE ON public.student_attendance FOR EACH ROW EXECUTE FUNCTION public.log_table_change();

-- ============================================================
-- NOTE on lecture_execution:
-- This migration deliberately does NOT drop lecture_execution or
-- faculty_status_enum. dashboard.html, faculty-portal.html, and
-- reports.html still read from that table in several places. The
-- app code has been updated to stop WRITING new rows to it (the old
-- Execution Log page is retired in favor of Attendance), so it will
-- simply stay frozen/empty going forward rather than error out.
-- Once Dashboard/Reports/Faculty-Portal are redesigned around
-- student_attendance, lecture_execution can be dropped for good.
-- ============================================================
