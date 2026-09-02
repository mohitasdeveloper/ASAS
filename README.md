# ASAS — Academic Schedule & Attendance System

ASAS is a comprehensive, real-time scheduling and execution-tracking platform designed for educational institutions. It bridges the gap between static timetable planning (Master Timetable) and dynamic daily realities (Daily Scheduler, Faculty Absences, Replacements, and Execution Logging). 

Built with a lightweight Vanilla JavaScript frontend and a robust **Supabase (PostgreSQL)** backend, ASAS ensures absolute data integrity, responsive design, and seamless PDF/Excel reporting.

---

## 🌟 What's New in v2.0
The system has recently been upgraded with major architectural improvements:

* **🌐 Virtual & Flexible Load:** Master and Daily timetables now natively support "Virtual Lectures." These are slotless, flexible assignments that map to a dedicated `VIRTUAL` room, dynamically expanding as you add more lectures.
* **🛡️ Automated Audit Trail (Activity Logs):** A tamper-proof, database-level logging system. PostgreSQL triggers automatically intercept and log every `CREATE`, `UPDATE`, and `DELETE` action across the system, saving the previous and new JSON states. Viewable via the new *Activity Logs* UI.
* **📝 Faculty Remarks & Extra Duties:** A dedicated interface in the Daily Scheduler to log non-lecture activities (e.g., Exam Duties, Meetings). Fully integrated into the Daily PDF and Excel reports.
* **📖 Enhanced Course Management:** Added `Course Code` tracking and upgraded the UI with a clean, card-based modal design. 

---

## 🛠️ Core Modules

### 1. Master Timetable (`master-timetable.html`)
The blueprint of your institution's week.
* Assign Subjects and Faculty to specific Rooms and Time Slots.
* **New:** Manage unlimited "Virtual Lectures" for flexible workloads.
* Automatically enforces physical double-booking constraints while allowing infinite virtual assignments.

### 2. Daily Scheduler (`daily-scheduler.html`)
The operational reality of a specific day.
* **One-Click Generation:** Import the Master Timetable for today, or start blank.
* **Absence & Replacement Management:** Automatically flags absent faculty (via `faculty_leaves` integration) and allows you to dynamically assign replacement faculty. 
* **Remarks Module:** Log custom events and administrative duties for specific faculty members.

### 3. Execution Log (`execution.html`)
Real-time compliance and tracking.
* Click any cell (Physical or Virtual) to cycle its status: `Not Marked` → `On Time` → `Late` → `Not Engaged`.
* Automatically calculates daily statistics (Lectures Allotted vs. Taken vs. Late).
* Generates the **RC1 Daily Execution Report**.

### 4. Activity Logs (`activity-logs.html`)
Security and compliance.
* Filter system-wide events by Date and Action Type (`CREATE`, `UPDATE`, `DELETE`).
* Click "View JSON" to see the exact data state before and after a user made a change.

---

## 🏗️ Technology Stack

**Frontend:**
* HTML5 / CSS3 (Custom modular variables & responsive flex/grid layouts)
* Vanilla JavaScript (ES6 Modules)
* **Libraries:** * `jsPDF` & `jsPDF-AutoTable` (A0 High-Res PDF Generation)
  * `SheetJS / xlsx` (Excel Exporting)
  * `Flatpickr` (Date selection)
  * `Tom Select` (Searchable dropdowns)

**Backend (Supabase / PostgreSQL):**
* **Auth:** Supabase Authentication (Role-based access control via `admin_users` table).
* **Database:** PostgreSQL with highly relational schemas (Courses → Subjects → Faculty → CSF Mapping).
* **Security:** Row Level Security (RLS) policies enforcing `is_admin()` checks.
* **Automation:** PL/pgSQL Triggers handling background Audit Trail logging.

---

## 🗄️ Database Architecture Note (Virtual Lectures)
To support Virtual Lectures without breaking strict SQL constraints, the `time_slot_id` column in `master_timetable` and `daily_schedule` is `NULLABLE`. 

The system utilizes **Partial Unique Indexes** to ensure physical classrooms cannot be double-booked at the same time, while allowing infinite `NULL` time-slots for the virtual room:
```sql
CREATE UNIQUE INDEX idx_daily_unique_slot 
ON public.daily_schedule (schedule_date, time_slot_id, room_id) 
WHERE time_slot_id IS NOT NULL;
