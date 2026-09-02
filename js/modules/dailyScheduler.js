/**
 * ASAS — Daily Scheduler
 * ───────────────────────
 * Generates and manages the working schedule for a specific date.
 */

import { supabase } from '../config/supabase.js';

// ── getDayType ────────────────────────────────────────────────────────────────
/**
 * Returns 'saturday' for Saturday dates, 'weekday' for all others.
 * @param {string} dateString  'YYYY-MM-DD'
 * @returns {'weekday'|'saturday'}
 */
export function getDayType(dateString) {
  const d = new Date(dateString + 'T00:00:00');
  return d.getDay() === 6 ? 'saturday' : 'weekday';
}

// ── generateDailySchedule ─────────────────────────────────────────────────────
/**
 * Idempotent: if a schedule already exists for this date, returns it.
 * Otherwise clones master_timetable rows into daily_schedule.
 *
 * @returns {{ rows: DailyScheduleRow[], absentFacultyIds: string[] }}
 */
export async function generateDailySchedule(date, adminId) {
  // 1. Check if already generated
  const { data: existing } = await supabase
    .from('daily_schedule')
    .select('id')
    .eq('schedule_date', date)
    .limit(1);

  if (existing && existing.length > 0) {
    return loadDailySchedule(date);
  }

  // 2. Fetch master timetable rows for day_type
  const dayType = getDayType(date);
  const { data: masterRows, error: masterErr } = await supabase
    .from('master_timetable')
    .select('id, time_slot_id, room_id, course_id, subject_id, csf_id, faculty_id, virtual_start_time, virtual_end_time')
    .eq('day_type', dayType)
    .eq('is_active', true);

  if (masterErr) throw masterErr;
  if (!masterRows || masterRows.length === 0) {
    return { rows: [], absentFacultyIds: [] };
  }

  // 3. Fetch approved leaves for date
  const { data: leaves } = await supabase
    .from('faculty_leaves')
    .select('faculty_id')
    .eq('leave_date', date)
    .eq('status', 'approved');

  const absentFacultyIds = new Set((leaves ?? []).map(l => l.faculty_id));

  // 4. Build daily_schedule insert payload
  const insertRows = masterRows.map(row => ({
    schedule_date:       date,
    time_slot_id:        row.time_slot_id,
    room_id:             row.room_id,
    course_id:           row.course_id,
    subject_id:          row.subject_id,
    csf_id:              row.csf_id,
    assigned_faculty_id: row.faculty_id,
    original_faculty_id: row.faculty_id,
    virtual_start_time:  row.virtual_start_time,
    virtual_end_time:    row.virtual_end_time,
    is_rescheduled:      false,
    is_cancelled:        false,
    generated_by:        adminId,
  }));

  const { error: insertErr } = await supabase
    .from('daily_schedule')
    .insert(insertRows);

  if (insertErr) throw insertErr;

  return loadDailySchedule(date);
}

// ── loadDailySchedule ─────────────────────────────────────────────────────────
/**
 * Loads all rows for a date with full joins.
 * @returns {{ rows: DailyScheduleRow[], absentFacultyIds: string[] }}
 */
export async function loadDailySchedule(date) {
  // Parallel fetch: schedule + leaves
  const [scheduleRes, leavesRes] = await Promise.all([
    supabase
      .from('daily_schedule')
      .select(`
        id,
        schedule_date,
        is_rescheduled,
        is_cancelled,
        cancel_reason,
        original_faculty_id,
        virtual_start_time,
        virtual_end_time,
        time_slot:time_slots!time_slot_id (
          id, slot_label, start_time, end_time, slot_type, sort_order
        ),
        room:rooms!room_id (id, room_code),
        course:courses!course_id (id, course_code, year, program, division),
        subject:subjects!subject_id (id, subject_name),
        assigned_faculty:faculty!assigned_faculty_id (id, full_name),
        original_faculty:faculty!original_faculty_id (id, full_name),
        csf_id,
        course_id,
        time_slot_id
      `)
      .eq('schedule_date', date)
      .order('time_slot_id'),

    supabase
      .from('faculty_leaves')
      .select('faculty_id')
      .eq('leave_date', date)
      .eq('status', 'approved'),
  ]);

  if (scheduleRes.error) throw scheduleRes.error;

  const absentFacultyIds = (leavesRes.data ?? []).map(l => l.faculty_id);

  // MAPPING HACK: Force the UI to display the original planned faculty, 
  // ignoring the replacement data for the Daily Scheduler visual grid.
  const rows = (scheduleRes.data ?? []).map(r => {
    if (r.original_faculty) {
      r.assigned_faculty = r.original_faculty;
    }
    return r;
  });

  return {
    rows,
    absentFacultyIds,
  };
}

// ── resolveAbsentSlot ─────────────────────────────────────────────────────────
/**
 * Replaces an absent faculty's slot with a new subject + faculty entirely.
 * The absent faculty has NO connection to this slot after this call.
 */
export async function resolveAbsentSlot(scheduleId, { csfId, courseId, subjectId, facultyId }, adminId) {
  const { data, error } = await supabase
    .from('daily_schedule')
    .update({
      csf_id:              csfId,
      course_id:           courseId,
      subject_id:          subjectId,
      assigned_faculty_id: facultyId,
      is_rescheduled:      true,
      is_cancelled:        false,
      cancel_reason:       null,
    })
    .eq('id', scheduleId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ── cancelSlot ────────────────────────────────────────────────────────────────
/**
 * Marks a slot as cancelled with an optional reason.
 */
export async function cancelSlot(scheduleId, cancelReason = '') {
  const { data, error } = await supabase
    .from('daily_schedule')
    .update({
      is_cancelled:  true,
      cancel_reason: cancelReason || null,
    })
    .eq('id', scheduleId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ── uncancelSlot ──────────────────────────────────────────────────────────────
/**
 * Reverses a cancellation (admin changed mind).
 */
export async function uncancelSlot(scheduleId) {
  const { data, error } = await supabase
    .from('daily_schedule')
    .update({ is_cancelled: false, cancel_reason: null })
    .eq('id', scheduleId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ── getAvailableReplacementOptions ────────────────────────────────────────────
/**
 * Returns all CSF options for a course, tagged with absence/busy warnings.
 * Does NOT exclude warned options — admin decides.
 *
 * @returns {Array<{
 * csfId: string,
 * subjectId: string,
 * subjectName: string,
 * facultyId: string,
 * facultyName: string,
 * warnAbsent: boolean,
 * warnBusy: boolean
 * }>}
 */
export async function getAvailableReplacementOptions(courseId, date, timeSlotId) {
  // 1. All active CSF rows for this course
  const { data: csfRows, error: csfErr } = await supabase
    .from('course_subject_faculty')
    .select(`
      id,
      faculty_id,
      subject:subjects!subject_id (id, subject_name),
      faculty:faculty!faculty_id (id, full_name)
    `)
    .eq('course_id', courseId)
    .eq('is_active', true);

  if (csfErr) throw csfErr;
  if (!csfRows || csfRows.length === 0) return [];

  // 2. Absent faculty IDs for this date
  const { data: leaves } = await supabase
    .from('faculty_leaves')
    .select('faculty_id')
    .eq('leave_date', date)
    .eq('status', 'approved');

  const absentIds = new Set((leaves ?? []).map(l => l.faculty_id));

  // 3. Faculty already scheduled in ANY room at this time slot on this date
  const { data: busySlots } = await supabase
    .from('daily_schedule')
    .select('assigned_faculty_id')
    .eq('schedule_date', date)
    .eq('time_slot_id', timeSlotId)
    .eq('is_cancelled', false);

  const busyIds = new Set((busySlots ?? []).map(s => s.assigned_faculty_id));

  // 4. Build result
  return csfRows.map(row => ({
    csfId:       row.id,
    subjectId:   row.subject.id,
    subjectName: row.subject.subject_name,
    facultyId:   row.faculty_id,
    facultyName: row.faculty.full_name,
    warnAbsent:  absentIds.has(row.faculty_id),
    warnBusy:    busyIds.has(row.faculty_id),
  }));
}

// ── getScheduleSummary ────────────────────────────────────────────────────────
/**
 * Counts for the status bar: needsAttention | resolved | cancelled | total.
 */
export function getScheduleSummary(rows, absentFacultyIds) {
  const absentSet = new Set(absentFacultyIds);
  let needsAttention = 0, resolved = 0, cancelled = 0;

  for (const row of rows) {
    if (row.is_cancelled) { cancelled++; continue; }
    if (row.is_rescheduled) { resolved++; continue; }
    if (absentSet.has(row.assigned_faculty?.id)) { needsAttention++; }
  }

  return { needsAttention, resolved, cancelled, total: rows.length };
}
