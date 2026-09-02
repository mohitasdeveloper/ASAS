-- ============================================================
-- ASAS: Academic Schedule & Attendance System
-- Comprehensive Database Schema (v2.0)
-- Target Database: PostgreSQL (Supabase)
-- Features: Dynamic Scheduling, Virtual Loads, Audit Trails
-- ============================================================

-- 🧪 STEP 1: Custom Enumerated Types
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'leave_status_enum') THEN
        CREATE TYPE leave_status_enum AS ENUM ('approved', 'rejected', 'cancelled');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'faculty_status_enum') THEN
        CREATE TYPE faculty_status_enum AS ENUM ('not_marked', 'on_time', 'late', 'not_engaged');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'leave_type_enum') THEN
        CREATE TYPE leave_type_enum AS ENUM ('casual', 'medical', 'earned', 'duty', 'half_day_morning', 'half_day_afternoon', 'compensatory', 'other');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'action_type_enum') THEN
        CREATE TYPE action_type_enum AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'EXPORT', 'AUTH', 'SYSTEM_ACTION');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'attendance_status_enum') THEN
        CREATE TYPE attendance_status_enum AS ENUM ('not_marked', 'present', 'absent', 'late');
    END IF;
END $$;

-- 🛠️ STEP 2: Core Functions

-- Access Control Helper
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean SECURITY DEFINER AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE id = auth.uid() 
      AND is_active = true 
      AND role IN ('admin', 'super_admin')
  );
END;
$$ LANGUAGE plpgsql;

-- True when the current user is the active CR for the course that the given
-- lecture (daily_schedule row) belongs to. Used to scope student_attendance /
-- attendance_sessions access to exactly the CR's one course.
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

-- True when the current user is an active faculty mentor (via the mentorship
-- table) for the course that the given lecture belongs to. A faculty can
-- mentor several courses, unlike a CR who has exactly one.
CREATE OR REPLACE FUNCTION public.is_mentor_of_lecture(schedule_id UUID)
RETURNS boolean SECURITY DEFINER AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.daily_schedule ds
    JOIN public.mentorship m ON m.course_id = ds.course_id
    JOIN public.faculty f ON f.id = m.faculty_id
    WHERE ds.id = schedule_id
      AND f.supabase_uid = auth.uid()
      AND f.is_active = true
      AND m.is_active = true
  );
END;
$$ LANGUAGE plpgsql;

-- Automated Audit Trail Trigger Function
CREATE OR REPLACE FUNCTION public.log_table_change()
RETURNS TRIGGER AS $$
DECLARE
    user_id_val UUID;
BEGIN
    user_id_val := auth.uid(); 

    IF (TG_OP = 'INSERT') THEN
        INSERT INTO public.activity_logs (user_id, action_type, entity_type, entity_id, description, new_data)
        VALUES (user_id_val, 'CREATE', TG_TABLE_NAME, NEW.id, 'Created new record in ' || TG_TABLE_NAME, row_to_json(NEW)::jsonb);
        RETURN NEW;
    ELSIF (TG_OP = 'UPDATE') THEN
        IF row_to_json(OLD)::jsonb != row_to_json(NEW)::jsonb THEN
            INSERT INTO public.activity_logs (user_id, action_type, entity_type, entity_id, description, old_data, new_data)
            VALUES (user_id_val, 'UPDATE', TG_TABLE_NAME, NEW.id, 'Updated record in ' || TG_TABLE_NAME, row_to_json(OLD)::jsonb, row_to_json(NEW)::jsonb);
        END IF;
        RETURN NEW;
    ELSIF (TG_OP = 'DELETE') THEN
        INSERT INTO public.activity_logs (user_id, action_type, entity_type, entity_id, description, old_data)
        VALUES (user_id_val, 'DELETE', TG_TABLE_NAME, OLD.id, 'Deleted record from ' || TG_TABLE_NAME, row_to_json(OLD)::jsonb);
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 🏢 STEP 3: Structural & Infrastructure Tables

CREATE TABLE public.admin_users (
    id UUID NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT DEFAULT 'admin'::text CHECK (role = ANY (ARRAY['super_admin'::text, 'admin'::text, 'viewer'::text])),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT admin_users_pkey PRIMARY KEY (id),
    CONSTRAINT admin_users_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE
);

CREATE TABLE public.rooms (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    room_code TEXT NOT NULL,
    capacity INTEGER,
    is_active BOOLEAN DEFAULT true,
    CONSTRAINT rooms_pkey PRIMARY KEY (id),
    CONSTRAINT rooms_room_code_key UNIQUE (room_code)
);

CREATE TABLE public.courses (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    course_code TEXT NOT NULL,
    year TEXT NOT NULL CHECK (year = ANY (ARRAY['FY'::text, 'SY'::text, 'TY'::text, 'Part-1'::text, 'Part-2'::text])),
    program TEXT NOT NULL,
    division TEXT CHECK (division = ANY (ARRAY['A'::text, 'B'::text, 'C'::text]) OR division IS NULL),
    is_active BOOLEAN DEFAULT true,
    CONSTRAINT courses_pkey PRIMARY KEY (id),
    CONSTRAINT courses_course_code_key UNIQUE (course_code),
    CONSTRAINT courses_uniq_prog_div UNIQUE NULLS NOT DISTINCT (year, program, division)
);

CREATE TABLE public.subjects (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    subject_code TEXT NOT NULL,
    subject_name TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    CONSTRAINT subjects_pkey PRIMARY KEY (id),
    CONSTRAINT subjects_subject_code_key UNIQUE (subject_code)
);

CREATE TABLE public.faculty (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    supabase_uid UUID,
    employee_code TEXT NOT NULL,
    full_name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    department TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    faculty_type TEXT NOT NULL DEFAULT 'fulltime'::text CHECK (faculty_type = ANY (ARRAY['fulltime'::text, 'visiting'::text])),
    CONSTRAINT faculty_pkey PRIMARY KEY (id),
    CONSTRAINT faculty_employee_code_key UNIQUE (employee_code),
    CONSTRAINT faculty_email_key UNIQUE (email),
    CONSTRAINT faculty_supabase_uid_fkey FOREIGN KEY (supabase_uid) REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE TABLE public.students (
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

-- Mentorship: which faculty mentor which course(s). Independent of subject-teaching
-- (course_subject_faculty below) — a course can have several mentors, and a
-- faculty member can mentor several courses.
CREATE TABLE public.mentorship (
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

-- Course Representative accounts. Each CR is scoped to exactly one course
-- (mirrors admin_users: id IS the auth.users id).
CREATE TABLE public.cr_users (
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

CREATE TABLE public.course_subject_faculty (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL,
    subject_id UUID NOT NULL,
    faculty_id UUID NOT NULL,
    is_active BOOLEAN DEFAULT true,
    CONSTRAINT course_subject_faculty_pkey PRIMARY KEY (id),
    CONSTRAINT course_subject_faculty_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE,
    CONSTRAINT course_subject_faculty_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.subjects(id) ON DELETE CASCADE,
    CONSTRAINT course_subject_faculty_faculty_id_fkey FOREIGN KEY (faculty_id) REFERENCES public.faculty(id) ON DELETE CASCADE,
    CONSTRAINT course_subject_faculty_uniq UNIQUE (course_id, subject_id, faculty_id)
);

CREATE TABLE public.time_slots (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    slot_label TEXT NOT NULL,
    start_time TIME WITHOUT TIME ZONE NOT NULL,
    end_time TIME WITHOUT TIME ZONE NOT NULL,
    day_type TEXT NOT NULL CHECK (day_type = ANY (ARRAY['weekday'::text, 'saturday'::text])),
    slot_type TEXT NOT NULL DEFAULT 'lecture'::text CHECK (slot_type = ANY (ARRAY['lecture'::text, 'recess'::text, 'lunch'::text])),
    is_recess BOOLEAN GENERATED ALWAYS AS (slot_type = 'recess'::text) STORED,
    is_lunch BOOLEAN GENERATED ALWAYS AS (slot_type = 'lunch'::text) STORED,
    sort_order INTEGER NOT NULL,
    CONSTRAINT time_slots_pkey PRIMARY KEY (id)
);


-- 🗓️ STEP 4: Timetable and Scheduling Core Engine

CREATE TABLE public.master_timetable (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    day_type TEXT NOT NULL CHECK (day_type IN ('monday','tuesday','wednesday','thursday','friday','saturday')),
    time_slot_id UUID, -- NULLABLE for Virtual Load
    room_id UUID NOT NULL,
    csf_id UUID NOT NULL,
    course_id UUID NOT NULL,
    subject_id UUID NOT NULL,
    faculty_id UUID NOT NULL,
    is_active BOOLEAN DEFAULT true,
    virtual_start_time TIME WITHOUT TIME ZONE,
    virtual_end_time TIME WITHOUT TIME ZONE,
    CONSTRAINT master_timetable_pkey PRIMARY KEY (id),
    CONSTRAINT master_timetable_time_slot_id_fkey FOREIGN KEY (time_slot_id) REFERENCES public.time_slots(id),
    CONSTRAINT master_timetable_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id),
    CONSTRAINT master_timetable_csf_id_fkey FOREIGN KEY (csf_id) REFERENCES public.course_subject_faculty(id),
    CONSTRAINT master_timetable_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE,
    CONSTRAINT master_timetable_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.subjects(id) ON DELETE CASCADE,
    CONSTRAINT master_timetable_faculty_id_fkey FOREIGN KEY (faculty_id) REFERENCES public.faculty(id) ON DELETE CASCADE
);
-- Unique constraint on (day_type, time_slot_id, room_id): a plain (non-partial)
-- constraint is required here, not a partial index — Postgres NULL semantics
-- already treat every NULL time_slot_id as distinct, so this still allows
-- unlimited Virtual Load rows (time_slot_id IS NULL) while protecting physical
-- rooms/slots. A partial index (WHERE time_slot_id IS NOT NULL) would NOT be
-- usable as an upsert's ON CONFLICT target from the Supabase client.
ALTER TABLE public.master_timetable ADD CONSTRAINT master_timetable_slot_uniq UNIQUE (day_type, time_slot_id, room_id);


CREATE TABLE public.faculty_leaves (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    faculty_id UUID NOT NULL,
    leave_date DATE NOT NULL,
    leave_type public.leave_type_enum NOT NULL,
    reason TEXT,
    status public.leave_status_enum DEFAULT 'approved'::public.leave_status_enum,
    entered_by UUID,
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT faculty_leaves_pkey PRIMARY KEY (id),
    CONSTRAINT faculty_leaves_faculty_id_fkey FOREIGN KEY (faculty_id) REFERENCES public.faculty(id) ON DELETE CASCADE,
    CONSTRAINT faculty_leaves_entered_by_fkey FOREIGN KEY (entered_by) REFERENCES public.admin_users(id) ON DELETE SET NULL,
    CONSTRAINT faculty_leaves_date_fac_uniq UNIQUE (faculty_id, leave_date)
);

CREATE TABLE public.daily_schedule (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    schedule_date DATE NOT NULL,
    master_entry_id UUID,
    time_slot_id UUID, -- NULLABLE for Virtual Load
    room_id UUID NOT NULL,
    csf_id UUID,
    course_id UUID NOT NULL,
    subject_id UUID NOT NULL,
    assigned_faculty_id UUID NOT NULL,
    original_faculty_id UUID,
    is_cancelled BOOLEAN DEFAULT false,
    cancel_reason TEXT,
    is_rescheduled BOOLEAN DEFAULT false,
    generated_by UUID,
    generated_at TIMESTAMPTZ DEFAULT now(),
    virtual_start_time TIME WITHOUT TIME ZONE,
    virtual_end_time TIME WITHOUT TIME ZONE,
    CONSTRAINT daily_schedule_pkey PRIMARY KEY (id),
    CONSTRAINT daily_schedule_master_entry_id_fkey FOREIGN KEY (master_entry_id) REFERENCES public.master_timetable(id) ON DELETE SET NULL,
    CONSTRAINT daily_schedule_time_slot_id_fkey FOREIGN KEY (time_slot_id) REFERENCES public.time_slots(id),
    CONSTRAINT daily_schedule_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id),
    CONSTRAINT daily_schedule_csf_id_fkey FOREIGN KEY (csf_id) REFERENCES public.course_subject_faculty(id) ON DELETE SET NULL,
    CONSTRAINT daily_schedule_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE,
    CONSTRAINT daily_schedule_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.subjects(id) ON DELETE CASCADE,
    CONSTRAINT daily_schedule_assigned_faculty_id_fkey FOREIGN KEY (assigned_faculty_id) REFERENCES public.faculty(id) ON DELETE CASCADE,
    CONSTRAINT daily_schedule_original_faculty_id_fkey FOREIGN KEY (original_faculty_id) REFERENCES public.faculty(id) ON DELETE SET NULL,
    CONSTRAINT daily_schedule_generated_by_fkey FOREIGN KEY (generated_by) REFERENCES public.admin_users(id) ON DELETE SET NULL
);
-- PARTIAL UNIQUE INDEX: Protects physical daily schedules, allows infinite Virtual (null slot) lectures
CREATE UNIQUE INDEX idx_daily_unique_slot ON public.daily_schedule (schedule_date, time_slot_id, room_id) WHERE time_slot_id IS NOT NULL;


CREATE TABLE public.lecture_execution (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    daily_schedule_id UUID NOT NULL,
    schedule_date DATE NOT NULL,
    actual_faculty_id UUID,
    faculty_status public.faculty_status_enum DEFAULT 'not_marked'::public.faculty_status_enum,
    is_time_changed BOOLEAN DEFAULT false,
    is_room_changed BOOLEAN DEFAULT false,
    is_replaced BOOLEAN DEFAULT false,
    is_modified BOOLEAN GENERATED ALWAYS AS (is_time_changed OR is_room_changed OR is_replaced) STORED,
    time_swap_partner_id UUID,
    actual_start_time TIME WITHOUT TIME ZONE,
    actual_end_time TIME WITHOUT TIME ZONE,
    actual_room_id UUID,
    replacement_faculty_id UUID,
    modification_note TEXT,
    remarks TEXT,
    marked_by UUID,
    marked_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT lecture_execution_pkey PRIMARY KEY (id),
    CONSTRAINT lecture_execution_daily_schedule_id_key UNIQUE (daily_schedule_id),
    CONSTRAINT lecture_execution_daily_schedule_id_fkey FOREIGN KEY (daily_schedule_id) REFERENCES public.daily_schedule(id) ON DELETE CASCADE,
    CONSTRAINT lecture_execution_actual_faculty_id_fkey FOREIGN KEY (actual_faculty_id) REFERENCES public.faculty(id) ON DELETE CASCADE,
    CONSTRAINT lecture_execution_time_swap_partner_id_fkey FOREIGN KEY (time_swap_partner_id) REFERENCES public.daily_schedule(id) ON DELETE SET NULL,
    CONSTRAINT lecture_execution_actual_room_id_fkey FOREIGN KEY (actual_room_id) REFERENCES public.rooms(id) ON DELETE SET NULL,
    CONSTRAINT lecture_execution_replacement_faculty_id_fkey FOREIGN KEY (replacement_faculty_id) REFERENCES public.faculty(id) ON DELETE SET NULL,
    CONSTRAINT lecture_execution_marked_by_fkey FOREIGN KEY (marked_by) REFERENCES public.admin_users(id) ON DELETE SET NULL
);

-- Student attendance, recorded per lecture (daily_schedule row) per student.
-- This is the successor to lecture_execution: instead of tracking whether the
-- faculty took the lecture, we track which enrolled students were present.
CREATE TABLE public.student_attendance (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    daily_schedule_id UUID NOT NULL,
    student_id UUID NOT NULL,
    status public.attendance_status_enum NOT NULL DEFAULT 'not_marked'::public.attendance_status_enum,
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
CREATE INDEX idx_student_attendance_schedule ON public.student_attendance (daily_schedule_id);
CREATE INDEX idx_student_attendance_student ON public.student_attendance (student_id);

-- One row per lecture (daily_schedule row) — holds the uploaded physical
-- attendance-sheet photo and the lock flag. Locking is an admin-only status
-- indicator for now (faculty/CR editing isn't built yet); it never blocks
-- the admin's own ability to edit. Locked/unlocked in bulk per day from the
-- Attendance page, not auto-set.
CREATE TABLE public.attendance_sessions (
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

CREATE TABLE public.holidays (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    holiday_date DATE NOT NULL,
    name TEXT NOT NULL,
    declared_by UUID,
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT holidays_pkey PRIMARY KEY (id),
    CONSTRAINT holidays_holiday_date_key UNIQUE (holiday_date),
    CONSTRAINT holidays_declared_by_fkey FOREIGN KEY (declared_by) REFERENCES public.admin_users(id) ON DELETE SET NULL
);

CREATE TABLE public.faculty_remarks (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    date DATE NOT NULL,
    start_time TIME WITHOUT TIME ZONE NOT NULL,
    end_time TIME WITHOUT TIME ZONE NOT NULL,
    faculty_id UUID NOT NULL,
    remark TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT faculty_remarks_pkey PRIMARY KEY (id),
    CONSTRAINT faculty_remarks_faculty_id_fkey FOREIGN KEY (faculty_id) REFERENCES public.faculty(id) ON DELETE CASCADE
);

CREATE TABLE public.activity_logs (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    user_id UUID, 
    action_type public.action_type_enum NOT NULL,
    entity_type TEXT NOT NULL, 
    entity_id UUID, 
    description TEXT NOT NULL, 
    old_data JSONB, 
    new_data JSONB, 
    ip_address TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT activity_logs_pkey PRIMARY KEY (id),
    CONSTRAINT activity_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL
);


-- 🔐 STEP 5: Row-Level Security (RLS) Configuration
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.faculty ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mentorship ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cr_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_subject_faculty ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.master_timetable ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.faculty_leaves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lecture_execution ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.faculty_remarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- admin_users Policies (required for login/session profile checks)
CREATE POLICY "Users can read their own admin profile" ON public.admin_users FOR SELECT USING (id = auth.uid());
CREATE POLICY "Admins can manage admin_users" ON public.admin_users FOR ALL USING (public.is_admin());

-- cr_users Policies (required for login/session profile checks, mirrors admin_users)
CREATE POLICY "CR can read their own profile" ON public.cr_users FOR SELECT USING (id = auth.uid());
CREATE POLICY "Admins can manage cr_users" ON public.cr_users FOR ALL USING (public.is_admin());

-- Base RLS Pass-Through Policies
CREATE POLICY "Allow public read access for authenticated users" ON public.rooms FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Allow full access for administrators" ON public.rooms FOR ALL USING (public.is_admin());

CREATE POLICY "Allow public read access for authenticated users" ON public.courses FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Allow full access for administrators" ON public.courses FOR ALL USING (public.is_admin());

CREATE POLICY "Allow public read access for authenticated users" ON public.subjects FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Allow full access for administrators" ON public.subjects FOR ALL USING (public.is_admin());

CREATE POLICY "Allow public read access for authenticated users" ON public.course_subject_faculty FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Allow full access for administrators" ON public.course_subject_faculty FOR ALL USING (public.is_admin());

CREATE POLICY "Allow public read access for authenticated users" ON public.faculty FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Allow full access for administrators" ON public.faculty FOR ALL USING (public.is_admin());

CREATE POLICY "Allow public read access for authenticated users" ON public.students FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Allow full access for administrators" ON public.students FOR ALL USING (public.is_admin());

CREATE POLICY "Allow public read access for authenticated users" ON public.mentorship FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Allow full access for administrators" ON public.mentorship FOR ALL USING (public.is_admin());

-- Phase 1 (admin-only): only admins can read/write attendance. When faculty-mentor
-- and CR self-service marking are built, add matching USING clauses here scoped
-- via mentorship / cr_users course membership rather than opening this to all
-- authenticated users.
CREATE POLICY "Allow full access for administrators" ON public.student_attendance FOR ALL USING (public.is_admin());

CREATE POLICY "CR can view own course attendance" ON public.student_attendance FOR SELECT
  USING (public.is_cr_of_lecture(daily_schedule_id));
CREATE POLICY "CR can insert own course attendance" ON public.student_attendance FOR INSERT
  WITH CHECK (
    public.is_cr_of_lecture(daily_schedule_id)
    AND NOT EXISTS (SELECT 1 FROM public.attendance_sessions s WHERE s.daily_schedule_id = student_attendance.daily_schedule_id AND s.is_locked = true)
  );
CREATE POLICY "CR can update own course attendance if unlocked" ON public.student_attendance FOR UPDATE
  USING (
    public.is_cr_of_lecture(daily_schedule_id)
    AND NOT EXISTS (SELECT 1 FROM public.attendance_sessions s WHERE s.daily_schedule_id = student_attendance.daily_schedule_id AND s.is_locked = true)
  )
  WITH CHECK (public.is_cr_of_lecture(daily_schedule_id));

CREATE POLICY "Mentor can view own course attendance" ON public.student_attendance FOR SELECT
  USING (public.is_mentor_of_lecture(daily_schedule_id));
CREATE POLICY "Mentor can insert own course attendance" ON public.student_attendance FOR INSERT
  WITH CHECK (
    public.is_mentor_of_lecture(daily_schedule_id)
    AND NOT EXISTS (SELECT 1 FROM public.attendance_sessions s WHERE s.daily_schedule_id = student_attendance.daily_schedule_id AND s.is_locked = true)
  );
CREATE POLICY "Mentor can update own course attendance if unlocked" ON public.student_attendance FOR UPDATE
  USING (
    public.is_mentor_of_lecture(daily_schedule_id)
    AND NOT EXISTS (SELECT 1 FROM public.attendance_sessions s WHERE s.daily_schedule_id = student_attendance.daily_schedule_id AND s.is_locked = true)
  )
  WITH CHECK (public.is_mentor_of_lecture(daily_schedule_id));

CREATE POLICY "Allow full access for administrators" ON public.attendance_sessions FOR ALL USING (public.is_admin());

CREATE POLICY "CR can view own course sessions" ON public.attendance_sessions FOR SELECT
  USING (public.is_cr_of_lecture(daily_schedule_id));
CREATE POLICY "CR can insert own course sessions" ON public.attendance_sessions FOR INSERT
  WITH CHECK (public.is_cr_of_lecture(daily_schedule_id) AND is_locked = false);
CREATE POLICY "CR can update own course sessions if unlocked" ON public.attendance_sessions FOR UPDATE
  USING (public.is_cr_of_lecture(daily_schedule_id) AND is_locked = false)
  WITH CHECK (public.is_cr_of_lecture(daily_schedule_id) AND is_locked = false);

CREATE POLICY "Mentor can view own course sessions" ON public.attendance_sessions FOR SELECT
  USING (public.is_mentor_of_lecture(daily_schedule_id));
CREATE POLICY "Mentor can insert own course sessions" ON public.attendance_sessions FOR INSERT
  WITH CHECK (public.is_mentor_of_lecture(daily_schedule_id) AND is_locked = false);
CREATE POLICY "Mentor can update own course sessions if unlocked" ON public.attendance_sessions FOR UPDATE
  USING (public.is_mentor_of_lecture(daily_schedule_id) AND is_locked = false)
  WITH CHECK (public.is_mentor_of_lecture(daily_schedule_id) AND is_locked = false);

CREATE POLICY "Allow public read access for authenticated users" ON public.time_slots FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Allow full access for administrators" ON public.time_slots FOR ALL USING (public.is_admin());

CREATE POLICY "Allow public read access for authenticated users" ON public.master_timetable FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Allow full access for administrators" ON public.master_timetable FOR ALL USING (public.is_admin());

CREATE POLICY "Allow public read access for authenticated users" ON public.daily_schedule FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Allow full access for administrators" ON public.daily_schedule FOR ALL USING (public.is_admin());

CREATE POLICY "Allow public read access for authenticated users" ON public.lecture_execution FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Allow full access for administrators" ON public.lecture_execution FOR ALL USING (public.is_admin());

CREATE POLICY "Allow public read access for authenticated users" ON public.faculty_leaves FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Allow full access for administrators" ON public.faculty_leaves FOR ALL USING (public.is_admin());

CREATE POLICY "Allow public read access for authenticated users" ON public.holidays FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Allow full access for administrators" ON public.holidays FOR ALL USING (public.is_admin());

CREATE POLICY "Allow public read access for authenticated users" ON public.faculty_remarks FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Allow full access for administrators" ON public.faculty_remarks FOR ALL USING (public.is_admin());

-- Append-Only Rules for Activity Logs
CREATE POLICY "Admins can view activity logs" ON public.activity_logs FOR SELECT USING (public.is_admin());
CREATE POLICY "Admins can insert activity logs" ON public.activity_logs FOR INSERT WITH CHECK (public.is_admin());


-- ⚡ STEP 6: Apply Audit Triggers to Monitor Data Changes
CREATE TRIGGER audit_rooms_changes AFTER INSERT OR UPDATE OR DELETE ON public.rooms FOR EACH ROW EXECUTE FUNCTION public.log_table_change();
CREATE TRIGGER audit_courses_changes AFTER INSERT OR UPDATE OR DELETE ON public.courses FOR EACH ROW EXECUTE FUNCTION public.log_table_change();
CREATE TRIGGER audit_subjects_changes AFTER INSERT OR UPDATE OR DELETE ON public.subjects FOR EACH ROW EXECUTE FUNCTION public.log_table_change();
CREATE TRIGGER audit_faculty_changes AFTER INSERT OR UPDATE OR DELETE ON public.faculty FOR EACH ROW EXECUTE FUNCTION public.log_table_change();
CREATE TRIGGER audit_students_changes AFTER INSERT OR UPDATE OR DELETE ON public.students FOR EACH ROW EXECUTE FUNCTION public.log_table_change();
CREATE TRIGGER audit_mentorship_changes AFTER INSERT OR UPDATE OR DELETE ON public.mentorship FOR EACH ROW EXECUTE FUNCTION public.log_table_change();
CREATE TRIGGER audit_cr_users_changes AFTER INSERT OR UPDATE OR DELETE ON public.cr_users FOR EACH ROW EXECUTE FUNCTION public.log_table_change();
CREATE TRIGGER audit_student_attendance_changes AFTER INSERT OR UPDATE OR DELETE ON public.student_attendance FOR EACH ROW EXECUTE FUNCTION public.log_table_change();
CREATE TRIGGER audit_attendance_sessions_changes AFTER INSERT OR UPDATE OR DELETE ON public.attendance_sessions FOR EACH ROW EXECUTE FUNCTION public.log_table_change();
CREATE TRIGGER audit_csf_changes AFTER INSERT OR UPDATE OR DELETE ON public.course_subject_faculty FOR EACH ROW EXECUTE FUNCTION public.log_table_change();
CREATE TRIGGER audit_master_timetable_changes AFTER INSERT OR UPDATE OR DELETE ON public.master_timetable FOR EACH ROW EXECUTE FUNCTION public.log_table_change();
CREATE TRIGGER audit_daily_schedule_changes AFTER INSERT OR UPDATE OR DELETE ON public.daily_schedule FOR EACH ROW EXECUTE FUNCTION public.log_table_change();
CREATE TRIGGER audit_lecture_execution_changes AFTER INSERT OR UPDATE OR DELETE ON public.lecture_execution FOR EACH ROW EXECUTE FUNCTION public.log_table_change();
CREATE TRIGGER audit_faculty_leaves_changes AFTER INSERT OR UPDATE OR DELETE ON public.faculty_leaves FOR EACH ROW EXECUTE FUNCTION public.log_table_change();
CREATE TRIGGER audit_holidays_changes AFTER INSERT OR UPDATE OR DELETE ON public.holidays FOR EACH ROW EXECUTE FUNCTION public.log_table_change();
CREATE TRIGGER audit_faculty_remarks_changes AFTER INSERT OR UPDATE OR DELETE ON public.faculty_remarks FOR EACH ROW EXECUTE FUNCTION public.log_table_change();


-- ==============================================================================
-- 🚀 DEFAULT SYSTEM DATA / SEED DATA
-- ==============================================================================

-- Ensure the VIRTUAL room automatically exists for slotless/flexible online lectures
INSERT INTO public.rooms (room_code, capacity, is_active) 
VALUES ('VIRTUAL', 1000, true) 
ON CONFLICT (room_code) DO NOTHING;
