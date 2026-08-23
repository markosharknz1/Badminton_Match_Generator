// Player Database page: browse/search/edit/delete the full player roster,
// import players from CSV/Excel, and manage database backups.

let allMembers = [];

function $(sel) { return document.querySelector(sel); }

async function api(path, options = {}) {
    const res = await fetch(path, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    const isJson = res.headers.get('content-type')?.includes('application/json');
    const body = isJson ? await res.json() : null;
    if (!res.ok) {
        const message = body?.error || body?.errors?.join(', ') || `Request failed (${res.status})`;
        throw new Error(message);
    }
    return body;
}

function showError(message) {
    const el = $('#error-banner');
    el.textContent = message;
    el.style.display = message ? 'block' : 'none';
    if (message) window.scrollTo(0, 0);
}

function esc(s) {
    return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// --- Club members ---
let editingMemberId = null; // only one row editable at a time

async function loadMembers() {
    allMembers = await api('/api/players');
    renderMembers();
}

function skillBadge(skill) {
    return skill ? `<span class="badge skill-${skill}">${skill}</span>` : '';
}

function memberRowReadonlyHtml(p) {
    const statusLabel = { active: 'Active', lapsed: 'Lapsed', guest: 'Guest' }[p.membership_status] || p.membership_status;
    return `
        <tr data-id="${p.id}">
            <td>${esc(p.first_name)} ${esc(p.last_name)}</td>
            <td>${skillBadge(p.skill_level)}</td>
            <td>${p.gender || '-'}</td>
            <td class="muted">${statusLabel}</td>
            <td class="muted">${esc(p.membership_number || '')}</td>
            <td>
                <button class="small" data-action="edit-member">Edit</button>
                <button class="small" data-action="delete-member">Delete</button>
            </td>
        </tr>
    `;
}

function memberRowEditHtml(p) {
    return `
        <tr data-id="${p.id}">
            <td>
                <input type="text" data-field="first_name" value="${esc(p.first_name)}" style="width:90px;">
                <input type="text" data-field="last_name" value="${esc(p.last_name)}" style="width:110px;">
            </td>
            <td>
                <select data-field="skill_level">
                    ${['A', 'B', 'C', 'D', 'E'].map((g) => `<option value="${g}" ${p.skill_level === g ? 'selected' : ''}>${g}</option>`).join('')}
                </select>
            </td>
            <td>
                <select data-field="gender">
                    <option value="" ${!p.gender ? 'selected' : ''}>-</option>
                    <option value="F" ${p.gender === 'F' ? 'selected' : ''}>F</option>
                    <option value="M" ${p.gender === 'M' ? 'selected' : ''}>M</option>
                </select>
            </td>
            <td>
                <select data-field="membership_status">
                    <option value="active" ${p.membership_status === 'active' ? 'selected' : ''}>Active</option>
                    <option value="lapsed" ${p.membership_status === 'lapsed' ? 'selected' : ''}>Lapsed</option>
                    <option value="guest" ${p.membership_status === 'guest' ? 'selected' : ''}>Guest</option>
                </select>
            </td>
            <td><input type="text" data-field="membership_number" value="${esc(p.membership_number || '')}" style="width:90px;"></td>
            <td>
                <button class="primary small" data-action="save-member">Save</button>
                <button class="small" data-action="cancel-edit-member">Cancel</button>
            </td>
        </tr>
    `;
}

function renderMembers() {
    const query = $('#member-search').value.trim().toLowerCase();
    const filtered = query
        ? allMembers.filter((p) => `${p.first_name} ${p.last_name}`.toLowerCase().includes(query))
        : allMembers;
    $('#member-count').textContent = allMembers.length;

    $('#members-tbody').innerHTML = filtered.length
        ? filtered.slice().sort((a, b) => a.last_name.localeCompare(b.last_name))
            .map((p) => (p.id === editingMemberId ? memberRowEditHtml(p) : memberRowReadonlyHtml(p))).join('')
        : `<tr class="empty-row"><td colspan="6" class="muted">${query ? 'No matching members.' : 'No members yet.'}</td></tr>`;

    document.querySelectorAll('#members-tbody button[data-action]').forEach((btn) => {
        const tr = btn.closest('tr');
        const id = Number(tr.dataset.id);
        btn.addEventListener('click', () => {
            if (btn.dataset.action === 'edit-member') { editingMemberId = id; renderMembers(); }
            else if (btn.dataset.action === 'cancel-edit-member') { editingMemberId = null; renderMembers(); }
            else if (btn.dataset.action === 'save-member') saveMemberRow(id, tr);
            else deleteMemberRow(id, tr);
        });
    });
}

async function saveMemberRow(id, tr) {
    const field = (name) => tr.querySelector(`[data-field="${name}"]`).value.trim();
    const first_name = field('first_name');
    const last_name = field('last_name');
    if (!first_name || !last_name) {
        showError('First and last name are required.');
        return;
    }
    try {
        await api(`/api/players/${id}`, {
            method: 'PUT',
            body: JSON.stringify({
                first_name,
                last_name,
                skill_level: field('skill_level'),
                gender: field('gender') || null,
                membership_status: field('membership_status'),
                membership_number: field('membership_number') || null,
            }),
        });
        editingMemberId = null;
        showError('');
        await loadMembers();
    } catch (err) {
        showError(err.message);
    }
}

async function deleteMemberRow(id, tr) {
    const name = `${tr.querySelector('td').textContent.trim()}`;
    if (!confirm(`Delete ${name}? This cannot be undone.`)) return;
    try {
        await api(`/api/players/${id}`, { method: 'DELETE' });
        showError('');
        await loadMembers();
    } catch (err) {
        showError(err.message);
    }
}

$('#member-search').addEventListener('input', renderMembers);

$('#show-add-member').addEventListener('click', () => {
    const form = $('#add-member-form');
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
});

$('#am-submit').addEventListener('click', async () => {
    const first_name = $('#am-first').value.trim();
    const last_name = $('#am-last').value.trim();
    if (!first_name || !last_name) {
        showError('First and last name are required.');
        return;
    }
    try {
        await api('/api/players', {
            method: 'POST',
            body: JSON.stringify({
                first_name,
                last_name,
                skill_level: $('#am-skill').value,
                gender: $('#am-gender').value || null,
                membership_status: $('#am-status').value,
            }),
        });
        $('#am-first').value = '';
        $('#am-last').value = '';
        $('#add-member-form').style.display = 'none';
        showError('');
        await loadMembers();
    } catch (err) {
        showError(err.message);
    }
});

// --- CSV / Excel import ---
let xlsxFile = null; // set when the chosen file is .xlsx; takes priority over pasted CSV text

$('#import-file').addEventListener('change', () => {
    const file = $('#import-file').files[0];
    if (!file) return;
    if (file.name.toLowerCase().endsWith('.xlsx')) {
        xlsxFile = file;
        $('#import-text').value = '';
        $('#import-text-field').style.display = 'none';
        return;
    }
    xlsxFile = null;
    $('#import-text-field').style.display = '';
    const reader = new FileReader();
    reader.onload = () => { $('#import-text').value = reader.result; };
    reader.readAsText(file);
});

async function runImport(commit) {
    const membershipStatus = $('#import-status').value;
    try {
        let result;
        if (xlsxFile) {
            const bytes = await xlsxFile.arrayBuffer();
            result = await api(`/api/players/import-xlsx?membership_status=${membershipStatus}&commit=${commit}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/octet-stream' },
                body: bytes,
            });
        } else {
            const csvText = $('#import-text').value.trim();
            if (!csvText) {
                showError('Choose a CSV/Excel file or paste CSV text first.');
                return;
            }
            result = await api('/api/players/import', {
                method: 'POST',
                body: JSON.stringify({ csv_text: csvText, membership_status: membershipStatus, commit }),
            });
        }
        showError('');
        renderImportResult(result);
        if (result.committed) await loadMembers();
    } catch (err) {
        showError(err.message);
    }
}

$('#import-preview').addEventListener('click', () => runImport(false));

function renderImportResult(r) {
    const container = $('#import-result');
    const listItems = (arr, fmt) => arr.length ? `<ul>${arr.map(fmt).join('')}</ul>` : '<p class="muted" style="margin:0;">None</p>';
    container.innerHTML = `
        ${r.committed ? `<div class="bucket create"><h4>Imported ${r.created} player${r.created === 1 ? '' : 's'}${r.defaulted_skill ? ` (${r.defaulted_skill} defaulted to skill C - review their grades)` : ''}</h4></div>` : ''}
        <div class="bucket create">
            <h4>${r.committed ? 'Created' : 'Will create'} (${r.to_create.length})</h4>
            ${listItems(r.to_create, (i) => `<li>Row ${i.row}: ${i.name}${i.email ? ` &lt;${i.email}&gt;` : ''}</li>`)}
        </div>
        <div class="bucket skip">
            <h4>Skipped - already exist (${r.to_skip.length})</h4>
            ${listItems(r.to_skip, (i) => `<li>Row ${i.row}: ${i.name} (${i.reason})</li>`)}
        </div>
        <div class="bucket review">
            <h4>Needs manual review - not imported (${r.to_review.length})</h4>
            ${listItems(r.to_review, (i) => `<li>Row ${i.row}: ${i.name} (${i.email || 'no email'}, ${i.dob || 'no DOB'}) - possible duplicate of ${i.candidates.map((c) => `#${c.id} ${c.name}`).join(', ')}</li>`)}
        </div>
        ${!r.committed && r.to_create.length > 0 ? `<button class="primary" id="import-commit">Import ${r.to_create.length} new player${r.to_create.length === 1 ? '' : 's'}</button>` : ''}
    `;
    const commitBtn = $('#import-commit');
    if (commitBtn) commitBtn.addEventListener('click', () => runImport(true));
}

// --- Database backups ---
function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function loadBackups() {
    const status = await api('/api/backup/status');
    $('#backup-location').textContent = `Automatic backups are saved to ${status.backup_dir} every time the app opens (the newest 30 are kept, older ones are pruned automatically).`;
    $('#backups-tbody').innerHTML = status.backups.length
        ? status.backups.map((b) => `
            <tr>
                <td>${esc(b.name)}</td>
                <td>${new Date(b.created_at).toLocaleString()}</td>
                <td class="num">${formatBytes(b.size_bytes)}</td>
            </tr>
        `).join('')
        : '<tr class="empty-row"><td colspan="3" class="muted">No backups yet.</td></tr>';
}

$('#backup-now').addEventListener('click', async () => {
    try {
        await api('/api/backup/now', { method: 'POST' });
        showError('');
        await loadBackups();
    } catch (err) {
        showError(err.message);
    }
});

$('#backup-download').addEventListener('click', () => {
    window.location.href = '/api/backup/download';
});

// --- Boot ---
async function init() {
    try {
        const club = await api('/api/club-settings');
        $('#club-name').textContent = club.club_name;
    } catch (err) {
        // non-fatal, matches other pages
    }
    try {
        await loadMembers();
        await loadBackups();
    } catch (err) {
        showError(err.message);
    }
    subscribeToEvents((msg) => {
        if (msg.type === 'players') loadMembers().catch(() => {});
        else if (msg.type === 'club_settings') {
            api('/api/club-settings').then((c) => { $('#club-name').textContent = c.club_name; }).catch(() => {});
        }
    });
}

init();
