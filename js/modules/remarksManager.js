import { supabase } from '../config/supabase.js';
import { initSidebar } from '../components/sidebar.js';

let allRemarks = []; 
let activeFaculty = []; // Store faculty list for the autocomplete

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Initialize Auth & Sidebar
    const { data: { session }, error: authError } = await supabase.auth.getSession();
    
    if (authError || !session) {
        window.location.href = '../index.html';
        return;
    }

    const { data: userData } = await supabase
        .from('admin_users')
        .select('full_name, role')
        .eq('id', session.user.id)
        .single();

    const userSession = {
        profile: { full_name: userData?.full_name || 'User' },
        role: userData?.role || 'admin'
    };

    initSidebar(userSession, 'remarks');

    // 2. Set default date to today
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    document.getElementById('remark-date').value = `${yyyy}-${mm}-${dd}`;

    // 3. Load Initial Data
    await fetchActiveFaculty();
    await fetchAllRemarksFromDB();

    // 4. Initialize Autocomplete Component
    initFacultyAutocomplete();

    // 5. Form Submission Logic
    const form = document.getElementById('remark-form');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const date = document.getElementById('remark-date').value;
        const startTime = document.getElementById('start-time').value;
        const endTime = document.getElementById('end-time').value;
        const facultyId = document.getElementById('selected-faculty-id').value; 
        const remarkText = document.getElementById('remark-text').value;

        if (!facultyId) {
            showToast('Please select a valid faculty member from the list.', 'warning');
            return;
        }

        try {
            const { error } = await supabase
                .from('faculty_remarks')
                .insert([{
                    date: date,
                    start_time: startTime,
                    end_time: endTime,
                    faculty_id: facultyId,
                    remark: remarkText
                }]);

            if (error) throw error;

            showToast('Remark added successfully!', 'success');
            form.reset();
            
            // Reset the date back to today after submission
            document.getElementById('remark-date').value = `${yyyy}-${mm}-${dd}`;
            document.getElementById('selected-faculty-id').value = ''; 
            
            await fetchAllRemarksFromDB(); 
            
        } catch (error) {
            console.error('Error adding remark:', error);
            showToast('Failed to add remark. Please check the console.', 'error');
        }
    });

    // 6. Table Event Listeners
    document.getElementById('table-search-input').addEventListener('input', applyFiltersAndSort);
    document.getElementById('sort-select').addEventListener('change', applyFiltersAndSort);
    document.getElementById('export-btn').addEventListener('click', exportToCSV);
});

// --- TOAST NOTIFICATION LOGIC --- //
function showToast(message, type = 'success') {
    if (!document.getElementById('ases-toast-styles')) {
        const style = document.createElement('style');
        style.id = 'ases-toast-styles';
        style.innerHTML = `
            .ases-toast-container { position: fixed; bottom: 24px; right: 24px; display: flex; flex-direction: column; gap: 10px; z-index: 9999; }
            .ases-toast { min-width: 250px; padding: 12px 20px; border-radius: 8px; color: white; font-family: var(--ff-body, sans-serif); font-size: 0.95rem; font-weight: 500; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05); display: flex; align-items: center; gap: 12px; animation: slideInRight 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards; }
            .ases-toast.success { background-color: var(--success, #10b981); }
            .ases-toast.error { background-color: var(--danger, #ef4444); }
            .ases-toast.warning { background-color: var(--warning, #f59e0b); }
            .ases-toast svg { width: 20px; height: 20px; flex-shrink: 0; }
            @keyframes slideInRight { from { transform: translateX(120%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
            @keyframes fadeOutDown { to { transform: translateY(20px); opacity: 0; } }
        `;
        document.head.appendChild(style);
    }

    let container = document.getElementById('ases-toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'ases-toast-container';
        container.className = 'ases-toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `ases-toast ${type}`;
    
    let iconSvg = type === 'success' 
        ? `<svg fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`
        : `<svg fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;

    toast.innerHTML = `${iconSvg} <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'fadeOutDown 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// --- FACULTY AUTOCOMPLETE LOGIC --- //
async function fetchActiveFaculty() {
    try {
        const { data, error } = await supabase
            .from('faculty')
            .select('id, full_name')
            .eq('is_active', true)
            .order('full_name', { ascending: true });

        if (error) throw error;
        activeFaculty = data || [];
    } catch (error) {
        console.error('Error loading faculty:', error);
    }
}

function initFacultyAutocomplete() {
    const input = document.getElementById('faculty-search');
    const suggestionsBox = document.getElementById('faculty-suggestions');
    const hiddenIdInput = document.getElementById('selected-faculty-id');

    input.addEventListener('input', () => {
        const query = input.value.toLowerCase();
        suggestionsBox.innerHTML = ''; 
        hiddenIdInput.value = ''; 

        if (!query) {
            suggestionsBox.classList.remove('active');
            return;
        }

        const filtered = activeFaculty.filter(f => f.full_name.toLowerCase().includes(query));

        if (filtered.length === 0) {
            const li = document.createElement('li');
            li.textContent = "No faculty found";
            li.style.color = "var(--text-muted)";
            suggestionsBox.appendChild(li);
        } else {
            filtered.forEach(faculty => {
                const li = document.createElement('li');
                li.textContent = faculty.full_name;
                li.addEventListener('click', () => {
                    input.value = faculty.full_name;
                    hiddenIdInput.value = faculty.id;
                    suggestionsBox.classList.remove('active');
                });
                suggestionsBox.appendChild(li);
            });
        }
        suggestionsBox.classList.add('active');
    });

    document.addEventListener('click', (e) => {
        if (e.target !== input && e.target !== suggestionsBox) {
            suggestionsBox.classList.remove('active');
        }
    });
}

// --- TABLE DATA LOGIC --- //
async function fetchAllRemarksFromDB() {
    const tbody = document.getElementById('remarks-tbody');
    try {
        const { data: remarks, error } = await supabase
            .from('faculty_remarks')
            .select('*, faculty(full_name)');

        if (error) throw error;

        allRemarks = remarks || [];
        applyFiltersAndSort(); 

    } catch (error) {
        console.error('Error loading remarks:', error);
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: red; padding: 2rem;">Failed to load remarks.</td></tr>';
    }
}

function applyFiltersAndSort() {
    const searchTerm = document.getElementById('table-search-input').value.toLowerCase();
    const sortBy = document.getElementById('sort-select').value;

    let filteredData = allRemarks.filter(record => {
        const facName = (record.faculty?.full_name || '').toLowerCase();
        const remarkText = (record.remark || '').toLowerCase();
        return facName.includes(searchTerm) || remarkText.includes(searchTerm);
    });

    filteredData.sort((a, b) => {
        if (sortBy === 'date-desc') {
            const dateA = new Date(a.date + 'T' + (a.start_time || '00:00:00'));
            const dateB = new Date(b.date + 'T' + (b.start_time || '00:00:00'));
            return dateB - dateA;
        } else if (sortBy === 'date-asc') {
            const dateA = new Date(a.date + 'T' + (a.start_time || '00:00:00'));
            const dateB = new Date(b.date + 'T' + (b.start_time || '00:00:00'));
            return dateA - dateB;
        } else if (sortBy === 'name-asc') {
            const nameA = (a.faculty?.full_name || '').toLowerCase();
            const nameB = (b.faculty?.full_name || '').toLowerCase();
            return nameA.localeCompare(nameB);
        }
        return 0;
    });

    renderTable(filteredData);
}

function renderTable(data) {
    const tbody = document.getElementById('remarks-tbody');
    tbody.innerHTML = ''; 

    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 3rem; color: var(--text-muted);">No matching remarks found.</td></tr>';
        return;
    }

    const formatTime = (timeStr) => timeStr ? timeStr.substring(0, 5) : '';

    data.forEach(record => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${new Date(record.date).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })}</strong></td>
            <td>${formatTime(record.start_time)} - ${formatTime(record.end_time)}</td>
            <td>${record.faculty?.full_name || '<span style="color:var(--text-muted)">Unknown</span>'}</td>
            <td>${record.remark}</td>
            <td style="text-align: center;">
                <button class="btn-action-icon delete btn-delete-remark" data-id="${record.id}" title="Delete Remark">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        <line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line>
                    </svg>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    // Attach Event Listeners to the new Delete Buttons
    document.querySelectorAll('.btn-delete-remark').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const id = e.currentTarget.getAttribute('data-id');
            // Browser Confirm Dialog
            if (confirm('Are you sure you want to delete this remark? This action cannot be undone.')) {
                await deleteRemarkFromDB(id);
            }
        });
    });
}

// --- DELETE LOGIC --- //
async function deleteRemarkFromDB(id) {
    try {
        const { error } = await supabase
            .from('faculty_remarks')
            .delete()
            .eq('id', id);

        if (error) throw error;

        showToast('Remark deleted successfully!', 'success');
        
        // Remove locally and re-render so we don't have to fetch the whole table again
        allRemarks = allRemarks.filter(r => r.id != id);
        applyFiltersAndSort();
        
    } catch (error) {
        console.error('Error deleting remark:', error);
        showToast('Failed to delete remark.', 'error');
    }
}

// --- EXPORT LOGIC --- //
function exportToCSV() {
    if (allRemarks.length === 0) {
        showToast("No data available to export.", "warning");
        return;
    }

    const searchTerm = document.getElementById('table-search-input').value.toLowerCase();
    const exportData = allRemarks.filter(record => {
        const facName = (record.faculty?.full_name || '').toLowerCase();
        const remarkText = (record.remark || '').toLowerCase();
        return facName.includes(searchTerm) || remarkText.includes(searchTerm);
    });

    const headers = ["Date", "Start Time", "End Time", "Faculty Name", "Remark"];
    
    const rows = exportData.map(record => {
        const facName = record.faculty?.full_name || "Unknown";
        const safeRemark = `"${record.remark.replace(/"/g, '""')}"`; 
        return [record.date, record.start_time, record.end_time, `"${facName}"`, safeRemark];
    });

    const csvContent = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', `Faculty_Remarks_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
