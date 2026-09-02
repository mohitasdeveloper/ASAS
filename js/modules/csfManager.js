/**
 * ASAS — CSF Manager (Course-Subject-Faculty Mapping)
 * ─────────────────────────────────────────────────────
 * This table is the backbone of the entire scheduling system.
 * Every timetable dropdown is driven by this mapping.
 */

import { supabase } from '../config/supabase.js';

// ── getAll ────────────────────────────────────────────────────────────────────
/**
 * All active CSF rows with full joins, optionally filtered by course.
 * Displayed as: "TY BAF A — Financial Accounting — Prof. Sharma"
 */
export async function getAllCSF(courseId = null) {
  let q = supabase
    .from('course_subject_faculty')
    .select(`
      id,
      is_active,
      course:courses!course_id  (id, course_code, year, program, division),
      subject:subjects!subject_id (id, subject_code, subject_name),
      faculty:faculty!faculty_id  (id, employee_code, full_name, is_active)
    `)
    .order('id');

  if (courseId) q = q.eq('course_id', courseId);

  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

// ── getCSFByCourse ────────────────────────────────────────────────────────────
/**
 * Get all ACTIVE CSF rows for a specific course.
 * Used to populate the "pick replacement" dropdown in the scheduler.
 */
export async function getCSFByCourse(courseId) {
  const { data, error } = await supabase
    .from('course_subject_faculty')
    .select(`
      id,
      course_id,
      subject_id,
      faculty_id,
      subject:subjects!subject_id (id, subject_name),
      faculty:faculty!faculty_id  (id, full_name)
    `)
    .eq('course_id', courseId)
    .eq('is_active', true);

  if (error) throw error;
  return data ?? [];
}

// ── addCSF ────────────────────────────────────────────────────────────────────
/**
 * Add a new course-subject-faculty mapping.
 * Upserts if the same combination already exists (re-activates it).
 */
export async function addCSF(courseId, subjectId, facultyId) {
  const { data, error } = await supabase
    .from('course_subject_faculty')
    .upsert(
      { course_id: courseId, subject_id: subjectId, faculty_id: facultyId, is_active: true },
      { onConflict: 'course_id,subject_id,faculty_id', returning: 'representation' }
    )
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ── deactivateCSF ─────────────────────────────────────────────────────────────
/**
 * Soft-delete a CSF mapping. Does NOT break existing daily_schedule rows.
 */
export async function deactivateCSF(csfId) {
  const { error } = await supabase
    .from('course_subject_faculty')
    .update({ is_active: false })
    .eq('id', csfId);

  if (error) throw error;
}

// ── reactivateCSF ─────────────────────────────────────────────────────────────
export async function reactivateCSF(csfId) {
  const { error } = await supabase
    .from('course_subject_faculty')
    .update({ is_active: true })
    .eq('id', csfId);

  if (error) throw error;
}

// ── getAllCourses ──────────────────────────────────────────────────────────────
export async function getAllCourses() {
  const { data, error } = await supabase
    .from('courses')
    .select('id, course_code, year, program, division')
    .eq('is_active', true)
    .order('year').order('program').order('division');

  if (error) throw error;
  return data ?? [];
}

// ── getAllSubjects ─────────────────────────────────────────────────────────────
export async function getAllSubjects() {
  const { data, error } = await supabase
    .from('subjects')
    .select('id, subject_code, subject_name')
    .eq('is_active', true)
    .order('subject_name');

  if (error) throw error;
  return data ?? [];
}

// ── addSubject ────────────────────────────────────────────────────────────────
/**
 * Create a new subject (admin can add subjects on the fly from the CSF page).
 */
export async function addSubject(subjectCode, subjectName) {
  const { data, error } = await supabase
    .from('subjects')
    .insert({ subject_code: subjectCode, subject_name: subjectName })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ── getActiveFacultyList ──────────────────────────────────────────────────────
export async function getActiveFacultyList() {
  const { data, error } = await supabase
    .from('faculty')
    .select('id, full_name, employee_code')
    .eq('is_active', true)
    .order('full_name');

  if (error) throw error;
  return data ?? [];
}

// ── formatCSFLabel ────────────────────────────────────────────────────────────
/**
 * Returns "TY BAF A — Financial Accounting — Prof. Sharma"
 */
export function formatCSFLabel(row) {
  const course  = row.course  ? courseLabel(row.course)  : '—';
  const subject = row.subject ? row.subject.subject_name : '—';
  const faculty = row.faculty ? `Prof. ${row.faculty.full_name}` : '—';
  return `${course} — ${subject} — ${faculty}`;
}

export function courseLabel(c) {
  return c.division ? `${c.year} ${c.program} ${c.division}` : `${c.year} ${c.program}`;
}
