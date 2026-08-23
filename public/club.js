// Club Settings page: club settings, permanent courts roster, skill
// compatibility matrix, payment categories, and session templates. Player
// roster management and CSV/Excel import live on the separate Members page.

const GRADES = ['A', 'B', 'C', 'D', 'E'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

let courts = []; // full courts table rows
let matrixState = {}; // "A-B" -> bool (canonical: both directions kept equal)
let templates = [];
let paymentCategories = [];

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

function flashSaved(sel) {
    const el = $(sel);
    el.textContent = 'Saved';
    setTimeout(() => { el.textContent = ''; }, 2000);
}

// --- Section switcher ---
function showSettingsSection(name) {
    document.querySelectorAll('[data-section]').forEach((el) => {
        el.style.display = el.dataset.section === name ? '' : 'none';
    });
}

$('#settings-section').addEventListener('change', () => showSettingsSection($('#settings-section').value));
showSettingsSection($('#settings-section').value);

// --- Club settings ---
async function loadSettings() {
    const s = await api('/api/club-settings');
    $('#club-name').textContent = s.club_name;
    $('#cs-name').value = s.club_name;
    $('#cs-game').value = s.default_game_minutes;
    $('#cs-break').value = s.default_break_minutes;
    $('#cs-capacity').value = s.max_capacity ?? '';
    $('#cs-square').checked = !!s.square_enabled;
    $('#email-api-key').value = s.smtp2go_api_key || '';
    $('#email-sender-address').value = s.smtp2go_sender_email || '';
    $('#email-sender-name').value = s.smtp2go_sender_name || '';
    $('#payments-access-token').value = s.square_access_token || '';
    $('#payments-location-id').value = s.square_location_id || '';
}

$('#cs-save').addEventListener('click', async () => {
    try {
        const capacity = $('#cs-capacity').value;
        const saved = await api('/api/club-settings', {
            method: 'PUT',
            body: JSON.stringify({
                club_name: $('#cs-name').value.trim(),
                default_game_minutes: Number($('#cs-game').value),
                default_break_minutes: Number($('#cs-break').value),
                max_capacity: capacity === '' ? null : Number(capacity),
                square_enabled: $('#cs-square').checked,
            }),
        });
        $('#club-name').textContent = saved.club_name;
        showError('');
        flashSaved('#cs-saved');
    } catch (err) {
        showError(err.message);
    }
});

// --- Email (SMTP2Go credentials - not wired to actually send anything yet) ---
$('#email-save').addEventListener('click', async () => {
    try {
        await api('/api/club-settings', {
            method: 'PUT',
            body: JSON.stringify({
                smtp2go_api_key: $('#email-api-key').value.trim() || null,
                smtp2go_sender_email: $('#email-sender-address').value.trim() || null,
                smtp2go_sender_name: $('#email-sender-name').value.trim() || null,
            }),
        });
        showError('');
        flashSaved('#email-saved');
    } catch (err) {
        showError(err.message);
    }
});

// --- Payments (Square credentials - not wired to actually process anything yet) ---
$('#payments-save').addEventListener('click', async () => {
    try {
        await api('/api/club-settings', {
            method: 'PUT',
            body: JSON.stringify({
                square_access_token: $('#payments-access-token').value.trim() || null,
                square_location_id: $('#payments-location-id').value.trim() || null,
            }),
        });
        showError('');
        flashSaved('#payments-saved');
    } catch (err) {
        showError(err.message);
    }
});

// --- Courts roster ---
async function loadCourts() {
    courts = await api('/api/courts');
    renderCourts();
}

function renderCourts() {
    const byNumber = new Map(courts.map((c) => [c.court_number, c]));
    $('#court-roster').innerHTML = Array.from({ length: 32 }, (_, i) => i + 1).map((n) => {
        const court = byNumber.get(n);
        const active = court && court.is_active;
        return `<div class="court-cell ${active ? 'active' : ''}" data-number="${n}">${n}</div>`;
    }).join('');
    document.querySelectorAll('.court-cell').forEach((cell) => {
        cell.addEventListener('click', () => toggleCourt(Number(cell.dataset.number)));
    });
}

async function toggleCourt(courtNumber) {
    const court = courts.find((c) => c.court_number === courtNumber);
    try {
        if (!court) {
            await api('/api/courts', { method: 'POST', body: JSON.stringify({ court_number: courtNumber, is_active: true }) });
        } else {
            await api(`/api/courts/${court.id}`, { method: 'PUT', body: JSON.stringify({ is_active: !court.is_active }) });
        }
        showError('');
        await loadCourts();
        await loadTemplates(); // template court checkboxes only list active courts
    } catch (err) {
        showError(err.message);
    }
}

// --- Skill compatibility matrix ---
async function loadMatrix() {
    const rows = await api('/api/skill-compatibility');
    matrixState = {};
    for (const r of rows) matrixState[`${r.skill_a}-${r.skill_b}`] = !!r.allowed;
    renderMatrix();
}

function matrixAllowed(a, b) {
    return matrixState[`${a}-${b}`] ?? matrixState[`${b}-${a}`] ?? true;
}

function renderMatrix() {
    const table = $('#matrix');
    table.innerHTML = `
        <tr><th></th>${GRADES.map((g) => `<th>${g}</th>`).join('')}</tr>
        ${GRADES.map((a) => `
            <tr>
                <th>${a}</th>
                ${GRADES.map((b) => `
                    <td><input type="checkbox" data-a="${a}" data-b="${b}" ${matrixAllowed(a, b) ? 'checked' : ''}></td>
                `).join('')}
            </tr>
        `).join('')}
    `;
    table.querySelectorAll('input[type="checkbox"]').forEach((box) => {
        box.addEventListener('change', () => {
            const { a, b } = box.dataset;
            matrixState[`${a}-${b}`] = box.checked;
            matrixState[`${b}-${a}`] = box.checked;
            // mirror the twin checkbox without a full re-render
            const twin = table.querySelector(`input[data-a="${b}"][data-b="${a}"]`);
            if (twin) twin.checked = box.checked;
        });
    });
}

$('#matrix-save').addEventListener('click', async () => {
    const pairs = [];
    for (const a of GRADES) {
        for (const b of GRADES) {
            if (a <= b) pairs.push({ skill_a: a, skill_b: b, allowed: matrixAllowed(a, b) });
        }
    }
    try {
        await api('/api/skill-compatibility', { method: 'PUT', body: JSON.stringify({ pairs }) });
        showError('');
        flashSaved('#matrix-saved');
    } catch (err) {
        showError(err.message);
    }
});

// --- Payment categories (club-wide list; prices themselves live per template) ---
async function loadPaymentCategories() {
    paymentCategories = await api('/api/payment-categories?all=true');
    renderPaymentCategories();
}

function paymentCategoryRowHtml(c) {
    return `
        <tr data-id="${c.id}">
            <td><input type="text" data-field="name" value="${c.name.replace(/"/g, '&quot;')}" style="width:100%;"></td>
            <td class="num"><input type="number" data-field="sort_order" value="${c.sort_order}" style="width:60px;"></td>
            <td class="num"><input type="checkbox" data-field="is_active" ${c.is_active ? 'checked' : ''}></td>
            <td>
                <button class="small" data-action="save-category">Save</button>
                <button class="small" data-action="delete-category">Delete</button>
            </td>
        </tr>
    `;
}

function renderPaymentCategories() {
    $('#payment-categories-tbody').innerHTML = paymentCategories.length
        ? paymentCategories.map(paymentCategoryRowHtml).join('')
        : '<tr><td colspan="4" class="muted">No payment categories yet.</td></tr>';
    document.querySelectorAll('#payment-categories-tbody button[data-action]').forEach((btn) => {
        const tr = btn.closest('tr');
        const id = Number(tr.dataset.id);
        btn.addEventListener('click', () => {
            if (btn.dataset.action === 'save-category') saveCategoryRow(id, tr);
            else deleteCategoryRow(id);
        });
    });
}

async function saveCategoryRow(id, tr) {
    const name = tr.querySelector('[data-field="name"]').value.trim();
    const sort_order = Number(tr.querySelector('[data-field="sort_order"]').value) || 0;
    const is_active = tr.querySelector('[data-field="is_active"]').checked;
    if (!name) {
        showError('Category name is required.');
        return;
    }
    try {
        await api(`/api/payment-categories/${id}`, { method: 'PUT', body: JSON.stringify({ name, sort_order, is_active }) });
        showError('');
        await loadPaymentCategories();
        await loadTemplates(); // rate inputs depend on the active category list
    } catch (err) {
        showError(err.message);
    }
}

async function deleteCategoryRow(id) {
    const c = paymentCategories.find((x) => x.id === id);
    if (!confirm(`Delete payment category "${c.name}"? Only works if it isn't used by a template, session, or attendance record yet - set it to inactive instead if it's already in use.`)) return;
    try {
        await api(`/api/payment-categories/${id}`, { method: 'DELETE' });
        showError('');
        await loadPaymentCategories();
        await loadTemplates();
    } catch (err) {
        showError(err.message);
    }
}

$('#pc-add').addEventListener('click', async () => {
    const name = $('#pc-new-name').value.trim();
    if (!name) {
        showError('Enter a name for the new category.');
        return;
    }
    try {
        await api('/api/payment-categories', { method: 'POST', body: JSON.stringify({ name, sort_order: paymentCategories.length }) });
        $('#pc-new-name').value = '';
        showError('');
        await loadPaymentCategories();
        await loadTemplates();
    } catch (err) {
        showError(err.message);
    }
});

// --- Session templates ---
async function loadTemplates() {
    templates = await api('/api/session-templates');
    renderTemplates();
}

function templateCardHtml(t, idx) {
    const isNew = !t.id;
    const activeCourts = courts.filter((c) => c.is_active);
    const templateCourtIds = new Set((t.courts || []).map((c) => c.court_id));
    const rateByCategory = new Map((t.payment_rates || []).map((r) => [r.payment_category_id, r.amount_cents]));
    const activeCategories = paymentCategories.filter((c) => c.is_active);
    return `
        <div class="template-card" data-idx="${idx}">
            <div class="template-card-header">
                <strong>${isNew ? 'New template' : t.label}</strong>
                ${isNew ? '' : `<button class="small" data-action="delete" data-idx="${idx}">Delete</button>`}
            </div>
            <div class="row">
                <div class="field"><label>Label</label><input type="text" data-field="label" value="${t.label || ''}"></div>
                <div class="field">
                    <label>Day</label>
                    <select data-field="day_of_week">${DAYS.map((d) => `<option value="${d}" ${t.day_of_week === d ? 'selected' : ''}>${d}</option>`).join('')}</select>
                </div>
                <div class="field"><label>Start</label><input type="time" data-field="start_time" value="${t.start_time || '19:30'}"></div>
                <div class="field"><label>End</label><input type="time" data-field="end_time" value="${t.end_time || '21:30'}"></div>
            </div>
            <div class="row">
                <div class="field">
                    <label>Mode</label>
                    <select data-field="default_mode">
                        <option value="manual" ${t.default_mode !== 'auto' && t.default_mode !== 'social' ? 'selected' : ''}>Manual</option>
                        <option value="auto" ${t.default_mode === 'auto' ? 'selected' : ''}>Auto</option>
                        <option value="social" ${t.default_mode === 'social' ? 'selected' : ''}>Social (check-in + payment only, no rounds)</option>
                    </select>
                </div>
                <div class="field"><label>Rotation guideline (optional)</label><input type="number" min="0" data-field="default_max_capacity" value="${t.default_max_capacity ?? ''}"></div>
            </div>
            <div class="field">
                <label>Normal courts</label>
                <div class="court-checks">
                    ${activeCourts.map((c) => `
                        <label><input type="checkbox" data-court-id="${c.id}" ${isNew || templateCourtIds.has(c.id) ? 'checked' : ''}> Court ${c.court_number}</label>
                    `).join('')}
                </div>
            </div>
            <div class="field">
                <label>Prices ($)</label>
                <div class="row">
                    ${activeCategories.length ? activeCategories.map((c) => `
                        <div class="field" style="min-width:130px;">
                            <label class="muted" style="font-size:0.75rem;">${c.name}</label>
                            <input type="number" min="0" step="0.01" data-rate-category-id="${c.id}" value="${((rateByCategory.get(c.id) ?? 0) / 100).toFixed(2)}">
                        </div>
                    `).join('') : '<p class="muted">No payment categories yet - add some above.</p>'}
                </div>
            </div>
            <button class="primary small" data-action="save" data-idx="${idx}">${isNew ? 'Create template' : 'Save changes'}</button>
        </div>
    `;
}

function renderTemplates() {
    $('#template-list').innerHTML = templates.map((t, idx) => templateCardHtml(t, idx)).join('');
    document.querySelectorAll('#template-list button[data-action]').forEach((btn) => {
        const idx = Number(btn.dataset.idx);
        btn.addEventListener('click', () => {
            if (btn.dataset.action === 'save') saveTemplate(idx);
            else if (btn.dataset.action === 'delete') deleteTemplate(idx);
        });
    });
}

function readTemplateCard(idx) {
    const card = document.querySelector(`.template-card[data-idx="${idx}"]`);
    const value = (field) => card.querySelector(`[data-field="${field}"]`).value;
    const capacity = value('default_max_capacity');
    const payment_rates = Array.from(card.querySelectorAll('[data-rate-category-id]')).map((input) => ({
        payment_category_id: Number(input.dataset.rateCategoryId),
        amount_cents: Math.round(parseFloat(input.value || '0') * 100),
    }));
    return {
        label: value('label').trim(),
        day_of_week: value('day_of_week'),
        start_time: value('start_time'),
        end_time: value('end_time'),
        default_mode: value('default_mode'),
        default_max_capacity: capacity === '' ? null : Number(capacity),
        court_ids: Array.from(card.querySelectorAll('input[data-court-id]:checked')).map((i) => Number(i.dataset.courtId)),
        payment_rates,
    };
}

async function saveTemplate(idx) {
    const t = templates[idx];
    const body = readTemplateCard(idx);
    try {
        if (t.id) {
            await api(`/api/session-templates/${t.id}`, { method: 'PUT', body: JSON.stringify(body) });
            await api(`/api/session-templates/${t.id}/courts`, { method: 'PUT', body: JSON.stringify({ court_ids: body.court_ids }) });
            await api(`/api/session-templates/${t.id}/payment-rates`, { method: 'PUT', body: JSON.stringify({ rates: body.payment_rates }) });
        } else {
            await api('/api/session-templates', { method: 'POST', body: JSON.stringify(body) });
        }
        showError('');
        await loadTemplates();
    } catch (err) {
        showError(err.message);
    }
}

async function deleteTemplate(idx) {
    const t = templates[idx];
    if (!confirm(`Delete template "${t.label}"?`)) return;
    try {
        await api(`/api/session-templates/${t.id}`, { method: 'DELETE' });
        showError('');
        await loadTemplates();
    } catch (err) {
        showError(err.message);
    }
}

$('#template-add').addEventListener('click', () => {
    templates.push({ label: '', day_of_week: 'Mon', default_mode: 'manual', courts: [] });
    renderTemplates();
});

// --- Boot ---
async function init() {
    try {
        await loadSettings();
        await loadCourts();
        await loadMatrix();
        await loadPaymentCategories();
        await loadTemplates();
    } catch (err) {
        showError(err.message);
    }
    subscribeToEvents((msg) => {
        // Another tab may edit the same data; refresh the affected section.
        if (msg.type === 'courts') loadCourts().then(loadTemplates).catch(() => {});
        else if (msg.type === 'session_templates') loadTemplates().catch(() => {});
        else if (msg.type === 'club_settings') loadSettings().catch(() => {});
        else if (msg.type === 'skill_compatibility') loadMatrix().catch(() => {});
        else if (msg.type === 'payment_categories') loadPaymentCategories().then(loadTemplates).catch(() => {});
    });
}

init();
