/**
 * ASAS — Leave Manager
 * ─────────────────────
 * All leave operations. Admin-only writes; faculty read their own via reports.
 *
 * DB table expected:
 *   faculty_leaves (
 *     id uuid PK default gen_random_uuid(),
 *     faculty_id uuid FK → profiles(id),
 *     leave_date date NOT NULL,
 *     leave_type text CHECK (casual|medical|earned|duty|half_day_morning|half_day_afternoon|compensatory|other),
 *     reason text,
 *     status text DEFAULT 'approved' CHECK (approved|rejected),
 *     entered_by uuid FK → profiles(id),
 *     created_at timestamptz DEFAULT now(),
 *     UNIQUE(faculty_id, leave_date)
 *   )
 */

import { supabase } from '../config/supabase.js';

export const LEAVE_TYPES = [
  { value: 'casual',              label: 'Casual Leave' },
  { value: 'medical',             label: 'Medical Leave' },
  { value: 'earned',              label: 'Earned Leave' },
  { value: 'duty',                label: 'Duty Leave' },
  { value: 'half_day_morning',    label: 'Half Day (Morning)' },
  { value: 'half_day_afternoon',  label: 'Half Day (Afternoon)' },
  { value: 'compensatory',        label: 'Compensatory Leave' },
  { value: 'other',               label: 'Other' },
];

export function leaveTypeLabel(val) {
  return LEAVE_TYPES.find(t => t.value === val)?.label ?? val;
}

// ── addLeave ──────────────────────────────────────────────────────────────────
/**
 * Insert or update a leave record for a faculty member.
 * Status is always 'approved' — admin enters leave directly.
 * Upserts on (faculty_id, leave_date) unique constraint.
 */
export async function addLeave(facultyId, leaveDate, leaveType, reason = '', adminId) {
  const { data, error } = await supabase
    .from('faculty_leaves')
    .upsert(
      {
        faculty_id: facultyId,
        leave_date: leaveDate,
        leave_type: leaveType,
        reason:     reason || null,
        status:     'approved',
        entered_by: adminId,
      },
      { onConflict: 'faculty_id,leave_date', returning: 'representation' }
    )
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ── markAbsentToday ───────────────────────────────────────────────────────────
/**
 * Quick walk-in absence: marks today as leave_type='other', reason='Walk-in absence'.
 */
export async function markAbsentToday(facultyId, adminId) {
  const today = new Date().toISOString().slice(0, 10);
  return addLeave(facultyId, today, 'other', 'Walk-in absence', adminId);
}

// ── updateLeaveStatus ─────────────────────────────────────────────────────────
/**
 * Change a leave record's status (approved ↔ rejected).
 */
export async function updateLeaveStatus(leaveId, status) {
  const { data, error } = await supabase
    .from('faculty_leaves')
    .update({ status })
    .eq('id', leaveId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ── deleteLeave ───────────────────────────────────────────────────────────────
/**
 * Hard delete — admin correcting an error.
 */
export async function deleteLeave(leaveId) {
  const { error } = await supabase
    .from('faculty_leaves')
    .delete()
    .eq('id', leaveId);

  if (error) throw error;
}

// ── getLeavesByDate ───────────────────────────────────────────────────────────
/**
 * All approved leaves for a given date, with faculty names.
 * Used by daily scheduler to detect absent faculty.
 */
export async function getLeavesByDate(date) {
  const { data, error } = await supabase
    .from('faculty_leaves')
    .select(`
      id,
      leave_date,
      leave_type,
      reason,
      status,
      faculty:faculty!faculty_id           (id, full_name),
      entered_by_profile:admin_users!entered_by (full_name)
    `)
    .eq('leave_date', date)
    .eq('status', 'approved')
    .order('leave_date', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

// ── getLeavesByFaculty ────────────────────────────────────────────────────────
/**
 * Leave history for one faculty in a date range.
 */
export async function getLeavesByFaculty(facultyId, fromDate, toDate) {
  let q = supabase
    .from('faculty_leaves')
    .select(`
      id,
      leave_date,
      leave_type,
      reason,
      status,
      entered_by_profile:admin_users!entered_by (full_name)
    `)
    .eq('faculty_id', facultyId)
    .order('leave_date', { ascending: false });

  if (fromDate) q = q.gte('leave_date', fromDate);
  if (toDate)   q = q.lte('leave_date', toDate);

  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

// ── getAllLeaves ───────────────────────────────────────────────────────────────
/**
 * All leaves in a date range with faculty names — for admin table view.
 */
export async function getAllLeaves(fromDate, toDate) {
  let q = supabase
    .from('faculty_leaves')
    .select(`
      id,
      leave_date,
      leave_type,
      reason,
      status,
      faculty:faculty!faculty_id           (id, full_name),
      entered_by_profile:admin_users!entered_by (full_name)
    `)
    .order('leave_date', { ascending: false });

  if (fromDate) q = q.gte('leave_date', fromDate);
  if (toDate)   q = q.lte('leave_date', toDate);

  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

// ── getActiveFaculty ──────────────────────────────────────────────────────────
/**
 * Convenience: all active faculty profiles for dropdowns.
 */
export async function getActiveFaculty() {
  const { data, error } = await supabase
    .from('faculty')
    .select('id, full_name')
    .eq('is_active', true)
    .order('full_name');

  if (error) throw error;
  return data ?? [];
}
