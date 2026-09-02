/**
 * ASAS — Master Timetable Manager
 */

import { supabase } from '../config/supabase.js';

// ── getTimeSlots ──────────────────────────────────────────────────────────────
export async function getTimeSlots(dayType) {
  const { data, error } = await supabase
    .from('time_slots')
    .select('id, slot_label, start_time, end_time, slot_type, sort_order')
    .eq('day_type', dayType)
    .order('sort_order');

  if (error) throw error;
  return data ?? [];
}

// ── getActiveRooms ────────────────────────────────────────────────────────────
export async function getActiveRooms() {
  const { data, error } = await supabase
    .from('rooms')
    .select('id, room_code')
    .eq('is_active', true)
    .order('room_code');

  if (error) throw error;
  return data ?? [];
}

// ── getMasterTimetable ────────────────────────────────────────────────────────
export async function getMasterTimetable(dayType) {
  const { data, error } = await supabase
    .from('master_timetable')
    .select(`
      id,
      day_type,
      is_active,
      time_slot_id, 
      room_id,
      virtual_start_time,
      virtual_end_time,
      time_slot:time_slots (id, slot_label, start_time, end_time, slot_type, sort_order),
      room:rooms (id, room_code),
      course:courses (id, course_code, year, program, division),
      subject:subjects (id, subject_name),
      faculty:faculty (id, full_name),
      csf_id,
      course_id,
      subject_id,
      faculty_id
    `)
    .eq('day_type', dayType)
    .eq('is_active', true);

  if (error) throw error;

  // Build lookup map
  const map = {};
  for (const row of (data ?? [])) {
    // We MUST use the raw room_id and time_slot_id fetched directly
    const rId = row.room_id; 
    if (!rId) continue;

    if (!row.time_slot_id) {
      // It's a Virtual Lecture
      if (!map['null']) map['null'] = {};
      map['null'][row.id] = row;
    } else {
      // Standard physical lectures
      const tsId = row.time_slot_id;
      if (!map[tsId]) map[tsId] = {};
      map[tsId][rId] = row;
    }
  }
  return map;
}

// ── upsertMasterEntry ─────────────────────────────────────────────────────────
export async function upsertMasterEntry({ entryId, dayType, timeSlotId, roomId, csfId, courseId, subjectId, facultyId, virtual_start_time, virtual_end_time }) {
  const payload = {
    day_type:           dayType,
    time_slot_id:       timeSlotId || null,
    room_id:            roomId,
    csf_id:             csfId,
    course_id:          courseId,
    subject_id:         subjectId,
    faculty_id:         facultyId,
    virtual_start_time: virtual_start_time || null, 
    virtual_end_time:   virtual_end_time || null,
    is_active:          true,
  };

  let result;

  if (entryId) {
    result = await supabase.from('master_timetable').update(payload).eq('id', entryId).select().single();
  } else {
    // If it's a new entry AND has a time slot, UPSERT securely
    if (timeSlotId) {
      result = await supabase.from('master_timetable').upsert(payload, { onConflict: 'day_type,time_slot_id,room_id' }).select().single();
    } else {
      // If it has NO time slot (Virtual), forcefully INSERT so we can have infinite rows
      result = await supabase.from('master_timetable').insert([payload]).select().single();
    }
  }

  if (result.error) throw result.error;
  return result.data;
}

// ── clearMasterEntry ──────────────────────────────────────────────────────────
export async function clearMasterEntry(entryId) {
  const { error } = await supabase
    .from('master_timetable')
    .update({ is_active: false })
    .eq('id', entryId);

  if (error) throw error;
}

// ── getCSFForCourse ───────────────────────────────────────────────────────────
export async function getCSFForCourse(courseId) {
  const { data, error } = await supabase
    .from('course_subject_faculty')
    .select(`
      id,
      subject_id,
      faculty_id,
      subject:subjects!subject_id (id, subject_name),
      faculty:faculty!faculty_id  (id, full_name)
    `)
    .eq('course_id', courseId)
    .eq('is_active', true);

  if (error) throw error;

  return (data ?? []).map(row => ({
    csfId:       row.id,
    subjectId:   row.subject_id,
    subjectName: row.subject.subject_name,
    facultyId:   row.faculty_id,
    facultyName: row.faculty.full_name,
    label:       `${row.subject.subject_name} — Prof. ${row.faculty.full_name}`,
  }));
}

// ── getAllActiveCourses ───────────────────────────────────────────────────────
export async function getAllActiveCourses() {
  const { data, error } = await supabase
    .from('courses')
    .select('id, course_code, year, program, division')
    .eq('is_active', true)
    .order('year').order('program').order('division');

  if (error) throw error;
  return (data ?? []).map(c => ({
    ...c,
    label: c.division ? `${c.year} ${c.program} ${c.division}` : `${c.year} ${c.program}`,
  }));
}
