/**
 * ASAS — Reports Module
 * ──────────────────────
 * Unified data-fetching for all report types.
 */

import { supabase } from '../config/supabase.js';

// ── getFacultyLeaveSummary ────────────────────────────────────────────────────
/**
 * Leave records for one faculty (or all) with grouped counts. Unaffected by the
 * lecture-execution → attendance pivot — kept as-is.
 * @param {string|null} facultyId  null = all faculty
 */
export async function getFacultyLeaveSummary(facultyId = null, fromDate = null, toDate = null) {
  let q = supabase
    .from('faculty_leaves')
    .select(`
      id, leave_date, leave_type, reason, status,
      faculty:faculty!faculty_id         (id, full_name, employee_code),
      entered_by_admin:admin_users!entered_by (full_name)
    `)
    .order('leave_date', { ascending: false });

  if (facultyId) q = q.eq('faculty_id', facultyId);
  if (fromDate)  q = q.gte('leave_date', fromDate);
  if (toDate)    q = q.lte('leave_date', toDate);

  const { data, error } = await q;
  if (error) throw error;

  const rows = data ?? [];

  // Build count summary per faculty per leave_type
  const summaryMap = {};
  for (const r of rows) {
    const fid = r.faculty?.id;
    if (!fid) continue;
    if (!summaryMap[fid]) summaryMap[fid] = { faculty: r.faculty, counts: {}, total: 0 };
    summaryMap[fid].counts[r.leave_type] = (summaryMap[fid].counts[r.leave_type] ?? 0) + 1;
    summaryMap[fid].total++;
  }

  return { rows, summary: Object.values(summaryMap) };
}

// ── getRescheduledSlots ───────────────────────────────────────────────────────
// Unaffected by the pivot — driven by daily_schedule.is_rescheduled directly.
export async function getRescheduledSlots(fromDate, toDate) {
  let q = supabase
    .from('daily_schedule')
    .select(`
      id, schedule_date, is_rescheduled, cancel_reason,
      course:courses!course_id   (year, program, division),
      subject:subjects!subject_id (subject_name),
      room:rooms!room_id          (room_code),
      time_slot:time_slots!time_slot_id (start_time, end_time),
      assigned_faculty:faculty!assigned_faculty_id (full_name)
    `)
    .eq('is_rescheduled', true)
    .order('schedule_date', { ascending: false });

  if (fromDate) q = q.gte('schedule_date', fromDate);
  if (toDate)   q = q.lte('schedule_date', toDate);

  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

// ── Dropdown helpers for report filters ───────────────────────────────────────
export async function getReportDropdowns() {
  const [facultyRes, courseRes, subjectRes, roomRes] = await Promise.all([
    supabase.from('faculty').select('id, full_name').eq('is_active', true).order('full_name'),
    supabase.from('courses').select('id, course_code, year, program, division').eq('is_active', true).order('year').order('program'),
    supabase.from('subjects').select('id, subject_name').eq('is_active', true).order('subject_name'),
    supabase.from('rooms').select('id, room_code').eq('is_active', true).order('room_code'),
  ]);

  return {
    faculty:  facultyRes.data  ?? [],
    courses:  courseRes.data   ?? [],
    subjects: subjectRes.data  ?? [],
    rooms:    roomRes.data     ?? [],
  };
}

// ── getStudentsForCourse ──────────────────────────────────────────────────────
export async function getStudentsForCourse(courseId) {
  const { data, error } = await supabase
    .from('students')
    .select('id, student_id, first_name, middle_name, last_name')
    .eq('course_id', courseId)
    .eq('is_active', true)
    .order('student_id');
  if (error) throw error;
  return data ?? [];
}

// ── Shared: fetch a course/subject's held lectures (+ roster + attendance) ────
/**
 * Fetches every non-cancelled daily_schedule row matching the given filters,
 * plus the student_attendance rows recorded against them and the
 * attendance_sessions photo/lock status. This is the shared backbone for the
 * Daily Summary, Course-wise, Subject-wise, and Pending reports.
 */
async function fetchLecturesWithAttendance({ date = null, fromDate = null, toDate = null, courseId = null, subjectId = null }) {
  let q = supabase
    .from('daily_schedule')
    .select(`
      id, schedule_date, is_cancelled, course_id,
      time_slot:time_slots!time_slot_id (start_time, end_time, slot_label, sort_order),
      room:rooms!room_id (room_code),
      course:courses!course_id (id, year, program, division),
      subject:subjects!subject_id (id, subject_name),
      assigned_faculty:faculty!assigned_faculty_id (full_name)
    `)
    .eq('is_cancelled', false);

  if (date)      q = q.eq('schedule_date', date);
  if (fromDate)  q = q.gte('schedule_date', fromDate);
  if (toDate)    q = q.lte('schedule_date', toDate);
  if (courseId)  q = q.eq('course_id', courseId);
  if (subjectId) q = q.eq('subject_id', subjectId);

  const { data: lectures, error } = await q.order('schedule_date', { ascending: false });
  if (error) throw error;
  if (!lectures?.length) return [];

  const dsIds = lectures.map(l => l.id);
  const courseIds = [...new Set(lectures.map(l => l.course_id))];

  const [studentsRes, attRes, sessRes] = await Promise.all([
    supabase.from('students').select('id, course_id').eq('is_active', true).in('course_id', courseIds),
    supabase.from('student_attendance').select('daily_schedule_id, student_id, status').in('daily_schedule_id', dsIds),
    supabase.from('attendance_sessions').select('daily_schedule_id, proof_image_url, is_locked').in('daily_schedule_id', dsIds),
  ]);
  if (studentsRes.error) throw studentsRes.error;
  if (attRes.error) throw attRes.error;
  if (sessRes.error) throw sessRes.error;

  const rosterCountByCourse = {};
  for (const s of (studentsRes.data ?? [])) {
    rosterCountByCourse[s.course_id] = (rosterCountByCourse[s.course_id] ?? 0) + 1;
  }

  const attByLecture = {};
  for (const row of (attRes.data ?? [])) {
    if (!attByLecture[row.daily_schedule_id]) attByLecture[row.daily_schedule_id] = { present: 0, absent: 0 };
    if (row.status === 'present') attByLecture[row.daily_schedule_id].present++;
    else if (row.status === 'absent') attByLecture[row.daily_schedule_id].absent++;
  }

  const sessByLecture = {};
  for (const row of (sessRes.data ?? [])) sessByLecture[row.daily_schedule_id] = row;

  return lectures.map(l => {
    const total = rosterCountByCourse[l.course_id] ?? 0;
    const att = attByLecture[l.id] ?? { present: 0, absent: 0 };
    const marked = att.present + att.absent;
    return {
      ...l,
      total_students: total,
      present: att.present,
      absent: att.absent,
      not_marked: Math.max(0, total - marked),
      has_photo: !!sessByLecture[l.id]?.proof_image_url,
      is_locked: !!sessByLecture[l.id]?.is_locked,
    };
  });
}

// ── getDailyAttendanceSummary ─────────────────────────────────────────────────
export async function getDailyAttendanceSummary(date, courseId = null) {
  return fetchLecturesWithAttendance({ date, courseId });
}

// ── getCourseAttendanceReport ─────────────────────────────────────────────────
export async function getCourseAttendanceReport(courseId, fromDate, toDate) {
  return fetchLecturesWithAttendance({ courseId, fromDate, toDate });
}

// ── getSubjectAttendanceReport ────────────────────────────────────────────────
export async function getSubjectAttendanceReport(subjectId, fromDate, toDate) {
  return fetchLecturesWithAttendance({ subjectId, fromDate, toDate });
}

// ── getPendingAttendanceReport ────────────────────────────────────────────────
// Lectures in range that are either fully unmarked, or marked but missing a
// proof photo.
export async function getPendingAttendanceReport(fromDate, toDate, courseId = null) {
  const rows = await fetchLecturesWithAttendance({ fromDate, toDate, courseId });
  return rows
    .filter(r => r.total_students > 0 && (r.not_marked > 0 || !r.has_photo))
    .map(r => ({
      ...r,
      reason: r.not_marked > 0 ? 'Not fully marked' : 'Missing photo',
    }));
}

// ── getStudentAttendanceHistory ───────────────────────────────────────────────
/**
 * One student's full attendance record across a date range. "Not Recorded"
 * lectures (held, but nobody ever opened Attendance for them) count against
 * the percentage the same way an explicit Absent would — the percentage is
 * always Present / Total Lectures Held, never just Present / Marked.
 */
export async function getStudentAttendanceHistory(studentId, courseId, fromDate, toDate) {
  let q = supabase
    .from('daily_schedule')
    .select(`
      id, schedule_date,
      time_slot:time_slots!time_slot_id (start_time, end_time, slot_label, sort_order),
      subject:subjects!subject_id (subject_name),
      assigned_faculty:faculty!assigned_faculty_id (full_name)
    `)
    .eq('course_id', courseId)
    .eq('is_cancelled', false);

  if (fromDate) q = q.gte('schedule_date', fromDate);
  if (toDate)   q = q.lte('schedule_date', toDate);

  const { data: lectures, error } = await q.order('schedule_date', { ascending: false });
  if (error) throw error;
  if (!lectures?.length) return { rows: [], present: 0, absent: 0, notRecorded: 0, total: 0, pct: null };

  const dsIds = lectures.map(l => l.id);
  const { data: attRows, error: attErr } = await supabase
    .from('student_attendance')
    .select('daily_schedule_id, status')
    .eq('student_id', studentId)
    .in('daily_schedule_id', dsIds);
  if (attErr) throw attErr;

  const statusMap = {};
  for (const row of (attRows ?? [])) statusMap[row.daily_schedule_id] = row.status;

  let present = 0, absent = 0, notRecorded = 0;
  const rows = lectures.map(l => {
    const status = statusMap[l.id]; // undefined = never recorded
    if (status === 'present') present++;
    else if (status === 'absent') absent++;
    else notRecorded++;
    return { ...l, status: status ?? 'not_recorded' };
  });

  const total = rows.length;
  const pct = total > 0 ? Math.round((present / total) * 1000) / 10 : null;

  return { rows, present, absent, notRecorded, total, pct };
}

// ── getDefaultersList / getClassAttendanceOverview ────────────────────────────
/**
 * Shared computation: every active student in a course, their present/absent
 * counts and attendance % (Present / Total Lectures Held, same rule as
 * getStudentAttendanceHistory), for a date range.
 */
async function computeClassAttendance(courseId, fromDate, toDate) {
  let lecQ = supabase
    .from('daily_schedule')
    .select('id')
    .eq('course_id', courseId)
    .eq('is_cancelled', false);
  if (fromDate) lecQ = lecQ.gte('schedule_date', fromDate);
  if (toDate)   lecQ = lecQ.lte('schedule_date', toDate);

  const [lecRes, studentsRes] = await Promise.all([
    lecQ,
    supabase.from('students').select('id, student_id, first_name, middle_name, last_name').eq('course_id', courseId).eq('is_active', true).order('student_id'),
  ]);
  if (lecRes.error) throw lecRes.error;
  if (studentsRes.error) throw studentsRes.error;

  const dsIds = (lecRes.data ?? []).map(l => l.id);
  const totalLectures = dsIds.length;
  const students = studentsRes.data ?? [];

  if (!totalLectures || !students.length) return { rows: [], totalLectures };

  const { data: attRows, error: attErr } = await supabase
    .from('student_attendance')
    .select('student_id, status')
    .in('daily_schedule_id', dsIds);
  if (attErr) throw attErr;

  const presentByStudent = {};
  for (const row of (attRows ?? [])) {
    if (row.status === 'present') presentByStudent[row.student_id] = (presentByStudent[row.student_id] ?? 0) + 1;
  }

  const rows = students.map(s => {
    const present = presentByStudent[s.id] ?? 0;
    const pct = Math.round((present / totalLectures) * 1000) / 10;
    return { student: s, present, absent: totalLectures - present, total: totalLectures, pct };
  });

  return { rows, totalLectures };
}

/**
 * All active students in a course whose attendance % falls below thresholdPct.
 */
export async function getDefaultersList(courseId, fromDate, toDate, thresholdPct = 75) {
  const { rows, totalLectures } = await computeClassAttendance(courseId, fromDate, toDate);
  return { rows: rows.filter(r => r.pct < thresholdPct).sort((a, b) => a.pct - b.pct), totalLectures };
}

/**
 * Every active student in a course with their attendance %, unfiltered —
 * used for the CR "Class Students" view.
 */
export async function getClassAttendanceOverview(courseId, fromDate, toDate) {
  const { rows, totalLectures } = await computeClassAttendance(courseId, fromDate, toDate);
  return { rows: rows.sort((a, b) => a.pct - b.pct), totalLectures };
}

// ── Formatters ────────────────────────────────────────────────────────────────
export function courseLbl(c) {
  if (!c) return '—';
  return c.division ? `${c.year} ${c.program} ${c.division}` : `${c.year} ${c.program}`;
}

export function studentName(s) {
  if (!s) return '—';
  return [s.first_name, s.middle_name, s.last_name].filter(Boolean).join(' ');
}

export function fmtDate(d) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
}

export function fmtTime(t) {
  return t ? t.slice(0,5) : '—';
}

export const LEAVE_TYPE_LABELS = {
  casual:'Casual', medical:'Medical', earned:'Earned', duty:'Duty',
  half_day_morning:'Half Day (AM)', half_day_afternoon:'Half Day (PM)',
  compensatory:'Compensatory', other:'Other',
};
