/**
 * ASAS — User Manager
 * ────────────────────
 * Admin-only. Creates and manages admin_users, faculty, and cr_users accounts.
 *
 * NOTE on createCR(): this calls the same Edge Function as createAdmin/
 * createFaculty with type: 'cr'. That function's source lives outside this
 * repo (deployed separately on Supabase) — it must be updated server-side to
 * handle type === 'cr' (create the auth user, then insert into cr_users with
 * the given courseId) before CR account creation will work end-to-end.
 */

import { supabase } from '../config/supabase.js';

// ── Edge Function endpoint ────────────────────────────────────────────────────
// Ensure this points to your deployed Supabase Edge Function URL
const EDGE_FN_URL = 'https://cljjedekjkeabrvumsar.supabase.co/functions/v1/admin-create-user';

// ── createAdmin ───────────────────────────────────────────────────────────────
export async function createAdmin({ fullName, email, password, role = 'admin' }) {
  const { data: { session } } = await supabase.auth.getSession();

  const res = await fetch(EDGE_FN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      type:     'admin',
      email,
      password,
      fullName,
      role,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? 'Failed to create admin account');
  }

  return res.json();
}

// ── createFaculty ─────────────────────────────────────────────────────────────
export async function createFaculty({ fullName, email, password, employeeCode, phone, department, facultyType = 'fulltime' }) {
  const { data: { session } } = await supabase.auth.getSession();

  const res = await fetch(EDGE_FN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      type:         'faculty',
      email,
      password,
      fullName,
      employeeCode,
      phone:        phone || null,
      department:   department || null,
      facultyType:  facultyType || 'fulltime',
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? 'Failed to create faculty account');
  }

  return res.json();
}

// ── createCR ──────────────────────────────────────────────────────────────────
export async function createCR({ fullName, email, password, courseId }) {
  const { data: { session } } = await supabase.auth.getSession();

  const res = await fetch(EDGE_FN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      type:     'cr',
      email,
      password,
      fullName,
      courseId,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? 'Failed to create CR account');
  }

  return res.json();
}

// ── deactivateUser ────────────────────────────────────────────────────────────
export async function deactivateUser(userType, userId) {
  const table = userType === 'admin' ? 'admin_users' : userType === 'cr' ? 'cr_users' : 'faculty';
  const { error } = await supabase
    .from(table)
    .update({ is_active: false })
    .eq('id', userId);

  if (error) throw error;
}

// ── reactivateUser ────────────────────────────────────────────────────────────
export async function reactivateUser(userType, userId) {
  const table = userType === 'admin' ? 'admin_users' : userType === 'cr' ? 'cr_users' : 'faculty';
  const { error } = await supabase
    .from(table)
    .update({ is_active: true })
    .eq('id', userId);

  if (error) throw error;
}

// ── getAllAdmins ───────────────────────────────────────────────────────────────
export async function getAllAdmins() {
  const { data, error } = await supabase
    .from('admin_users')
    .select('id, full_name, role, is_active, created_at')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

// ── getAllFaculty ──────────────────────────────────────────────────────────────
export async function getAllFaculty() {
  const { data, error } = await supabase
    .from('faculty')
    // Important: supabase_uid must be selected for password/email reset functions to work
    .select('id, supabase_uid, employee_code, full_name, email, phone, department, faculty_type, is_active, created_at')
    .order('full_name');

  if (error) throw error;
  return data ?? [];
}

// ── getAllCR ───────────────────────────────────────────────────────────────────
export async function getAllCR() {
  const { data, error } = await supabase
    .from('cr_users')
    .select('id, full_name, email, course_id, is_active, created_at, course:courses!course_id(id, year, program, division)')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

// ── Update Profiles ───────────────────────────────────────────────────────────
export async function updateAdminProfile(id, { fullName, role }) {
  const { error } = await supabase
    .from('admin_users')
    .update({ full_name: fullName, role: role })
    .eq('id', id);
  if (error) throw error;
}

export async function updateFacultyProfile(id, { fullName, employeeCode, phone, department, facultyType }) {
  const { error } = await supabase
    .from('faculty')
    .update({ 
      full_name: fullName, 
      employee_code: employeeCode, 
      phone: phone, 
      department: department, 
      faculty_type: facultyType 
    })
    .eq('id', id);
  if (error) throw error;
}

export async function updateCRProfile(id, { fullName, courseId }) {
  const { error } = await supabase
    .from('cr_users')
    .update({ full_name: fullName, course_id: courseId })
    .eq('id', id);
  if (error) throw error;
}

// ── Unified Password Reset ────────────────────────────────────────────────────
export async function resetUserPassword(authUid, newPassword) {
  const { data: { session } } = await supabase.auth.getSession();

  const res = await fetch(EDGE_FN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      action: 'reset_password', 
      userId: authUid, 
      password: newPassword
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? 'Failed to reset password');
  }
  return res.json();
}

// ── Unified Email Change ──────────────────────────────────────────────────────
export async function changeUserEmail(authUid, newEmail, userType) {
  const { data: { session } } = await supabase.auth.getSession();

  const res = await fetch(EDGE_FN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      action: 'change_email', 
      userId: authUid, 
      email: newEmail,
      userType: userType // 'admin' or 'faculty'
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? 'Failed to change email');
  }
  return res.json();
}
