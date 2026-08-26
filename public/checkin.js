// Check-in screen: search/select an existing player or quick-add a new one,
// move them into the "here today" pool for the currently open session.
// Subscribes to the SSE event stream so changes made from any other tab
// (or curl/API call) show up here without a manual reload.

let openSession = null;
let attendance = []; // current session's attendance rows (joined with player fields)
let allPlayers = []; // full roster, refreshed on load and on 'players' events
let sessionPaymentRates = []; // this session's category prices [{payment_category_id, name, amount_cents}]
let paymentModalContext = null; // { attendanceId } while the payment modal is open
let paymentTrackingEnabled = false; // club_settings.square_enabled - gates the whole payment feature
let checkinModalPlayerId = null; // player id the check-in modal is currently open for

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
}

function skillBadge(skill) {
    return skill ? `<span class="badge skill-${skill}">${skill}</span>` : '';
}

function esc(s) {
    return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function formatCents(cents) {
    return `$${((cents ?? 0) / 100).toFixed(2)}`;
}

// --- Boot ---
async function checkSessionState() {
    try {
        openSession = await api('/api/sessions/open');
        await enterCheckinMode();
    } catch (err) {
        if (err.message.includes('No open session')) {
            openSession = null;
            await enterStartSessionMode();
        } else {
            showError(err.message);
        }
    }
}

function handleServerEvent(msg) {
    if (msg.type === 'session') {
        // Covers a session starting, closing, or changing mode/phase from any
        // tab - simplest correct response is to just re-derive which mode
        // this screen should be in and re-render from fresh server state.
        checkSessionState().catch((err) => showError(err.message));
        mountTonightSummary($('#tonight-summary'));
    } else if (msg.type === 'attendance') {
        if (openSession && msg.session_id === openSession.id) {
            refreshAttendance().catch((err) => showError(err.message));
        }
        mountTonightSummary($('#tonight-summary'));
    } else if (msg.type === 'players') {
        loadAllPlayers().then(renderAvailableTable).catch((err) => showError(err.message));
    } else if (msg.type === 'auto_generate_failed' && openSession && msg.session_id === openSession.id) {
        showError(msg.message);
    } else if (msg.type === 'scheduler_error' && openSession && msg.session_id === openSession.id) {
        showError(`Scheduler error: ${msg.message}`);
    }
}

async function init() {
    try {
        const club = await api('/api/club-settings');
        $('#club-name').textContent = club.club_name;
        applyBranding(club);
        paymentTrackingEnabled = !!club.square_enabled;
    } catch (err) {
        // Club settings should always exist (seeded row id=1); non-fatal if it fails.
    }
    $('#payment-th').style.display = paymentTrackingEnabled ? '' : 'none';
    $('#here-hint').textContent = paymentTrackingEnabled
        ? 'Double-click a player to remove them from today. Click the payment cell to record payment.'
        : 'Double-click a player to remove them from today.';

    await checkSessionState();
    mountTonightSummary($('#tonight-summary'));
    subscribeToEvents(handleServerEvent);
}

// --- Start-session mode ---
async function enterStartSessionMode() {
    $('#start-session-panel').style.display = 'block';
    $('#checkin-panel').style.display = 'none';
    $('#session-meta').textContent = 'No session open';
    $('#session-mode-select').style.display = 'none';
    $('#finish-session-btn').style.display = 'none';

    const data = await api('/api/session-templates/for-date');
    const body = $('#start-session-body');

    if (data.templates.length === 0) {
        body.innerHTML = `
            <p class="muted">No session template is scheduled for today (${data.date}, ${data.day_of_week}).</p>
            <p class="muted">Add one on the club management page, or start a one-off session below.</p>
            <div id="adhoc-form"></div>
        `;
        renderAdhocForm(data.date);
        return;
    }

    if (data.templates.length === 1) {
        renderTemplateChoice(data.templates[0], data.date);
    } else {
        body.innerHTML = `<p>Which session is starting today?</p><div id="template-picker"></div>`;
        const picker = $('#template-picker');
        data.templates.forEach((t) => {
            const btn = document.createElement('button');
            btn.textContent = `${t.label} (${t.start_time}-${t.end_time})`;
            btn.style.marginRight = '8px';
            btn.style.marginBottom = '8px';
            btn.onclick = () => renderTemplateChoice(t, data.date);
            picker.appendChild(btn);
        });
    }
}

function renderTemplateChoice(template, date) {
    const body = $('#start-session-body');
    body.innerHTML = `
        <p><strong>${template.label}</strong> - ${template.start_time} to ${template.end_time}
        (${template.courts.length} court${template.courts.length === 1 ? '' : 's'}, mode: ${template.default_mode}${template.default_max_capacity ? `, guideline: ${template.default_max_capacity} players` : ''})</p>
        <div class="template-choice">
            <button class="primary" id="same-as-usual">Same as usual</button>
            <button id="need-to-change">Need to change something</button>
        </div>
        <div id="change-form" style="margin-top:16px;"></div>
    `;
    $('#same-as-usual').onclick = async () => {
        try {
            openSession = await api('/api/sessions/start', {
                method: 'POST',
                body: JSON.stringify({ template_id: template.id, date }),
            });
            await enterCheckinMode();
        } catch (err) {
            showError(err.message);
        }
    };
    $('#need-to-change').onclick = () => renderChangeForm(template, date);
}

async function renderChangeForm(template, date) {
    const allCourts = await api('/api/courts');
    const activeCourts = allCourts.filter((c) => c.is_active);
    const normalCourtIds = new Set(template.courts.map((c) => c.court_id));

    const form = $('#change-form');
    form.innerHTML = `
        <div class="row">
            <div class="field">
                <label>Mode</label>
                <select id="cf-mode">
                    <option value="manual" ${template.default_mode === 'manual' ? 'selected' : ''}>Manual</option>
                    <option value="auto" ${template.default_mode === 'auto' ? 'selected' : ''}>Auto</option>
                    <option value="social" ${template.default_mode === 'social' ? 'selected' : ''}>Social (check-in + payment only, no rounds)</option>
                </select>
            </div>
            <div class="field">
                <label>Comfortable rotation guideline (optional)</label>
                <input type="number" id="cf-capacity" value="${template.default_max_capacity ?? ''}" min="0">
            </div>
        </div>
        <div class="field">
            <label>Courts in use tonight</label>
            <div class="court-checks" id="cf-courts">
                ${activeCourts.map((c) => `
                    <label>
                        <input type="checkbox" value="${c.id}" ${normalCourtIds.has(c.id) ? 'checked' : ''}>
                        Court ${c.court_number}
                    </label>
                `).join('')}
            </div>
        </div>
        <button class="primary" id="cf-submit">Start session</button>
    `;
    $('#cf-submit').onclick = async () => {
        const court_ids = Array.from(form.querySelectorAll('#cf-courts input:checked')).map((i) => Number(i.value));
        const capacityVal = $('#cf-capacity').value;
        try {
            openSession = await api('/api/sessions/start', {
                method: 'POST',
                body: JSON.stringify({
                    template_id: template.id,
                    date,
                    overrides: {
                        mode: $('#cf-mode').value,
                        max_capacity: capacityVal === '' ? null : Number(capacityVal),
                        court_ids,
                    },
                }),
            });
            await enterCheckinMode();
        } catch (err) {
            showError(err.message);
        }
    };
}

async function renderAdhocForm(date) {
    const allCourts = await api('/api/courts');
    const activeCourts = allCourts.filter((c) => c.is_active);
    const form = $('#adhoc-form');
    form.innerHTML = `
        <div class="row">
            <div class="field"><label>Label</label><input type="text" id="ah-label" value="One-off session"></div>
            <div class="field">
                <label>Mode</label>
                <select id="ah-mode"><option value="manual">Manual</option><option value="auto">Auto</option><option value="social">Social (check-in + payment only, no rounds)</option></select>
            </div>
        </div>
        <div class="field">
            <label>Courts in use</label>
            <div class="court-checks" id="ah-courts">
                ${activeCourts.map((c) => `<label><input type="checkbox" value="${c.id}" checked> Court ${c.court_number}</label>`).join('')}
            </div>
        </div>
        <button class="primary" id="ah-submit">Start session</button>
    `;
    $('#ah-submit').onclick = async () => {
        const court_ids = Array.from(form.querySelectorAll('#ah-courts input:checked')).map((i) => Number(i.value));
        try {
            openSession = await api('/api/sessions', {
                method: 'POST',
                body: JSON.stringify({
                    date,
                    label: $('#ah-label').value,
                    mode: $('#ah-mode').value,
                    court_ids,
                }),
            });
            await enterCheckinMode();
        } catch (err) {
            showError(err.message);
        }
    };
}

// --- Check-in mode ---
async function enterCheckinMode() {
    $('#start-session-panel').style.display = 'none';
    $('#checkin-panel').style.display = 'block';
    showError('');
    $('#session-meta').textContent = `${openSession.label || 'Session'} - ${openSession.date}`;
    $('#session-mode-select').value = openSession.mode;
    $('#session-mode-select').style.display = '';
    $('#finish-session-btn').style.display = '';
    await loadAllPlayers();
    sessionPaymentRates = paymentTrackingEnabled ? await api(`/api/sessions/${openSession.id}/payment-rates`) : [];
    await refreshAttendance();
}

$('#session-mode-select').addEventListener('change', async () => {
    if (!openSession) return;
    const newMode = $('#session-mode-select').value;
    try {
        openSession = await api(`/api/sessions/${openSession.id}`, {
            method: 'PUT',
            body: JSON.stringify({ mode: newMode }),
        });
        showError('');
    } catch (err) {
        $('#session-mode-select').value = openSession.mode; // revert the dropdown on failure
        showError(err.message);
    }
});

async function loadAllPlayers() {
    allPlayers = await api('/api/players');
}

async function refreshAttendance() {
    attendance = await api(`/api/sessions/${openSession.id}/attendance`);
    renderHereTable();
    renderAvailableTable(); // re-filter in case a just-checked-in/removed player affects the pool
}

function alreadyPresentIds() {
    return new Set(attendance.filter((a) => a.state !== 'left').map((a) => a.player_id));
}

function renderAvailableTable() {
    const query = $('#player-search').value.trim();
    const queryLower = query.toLowerCase();
    const present = alreadyPresentIds();
    const pool = allPlayers.filter((p) => !present.has(p.id));
    $('#available-count').textContent = pool.length;

    const filtered = queryLower
        ? pool.filter((p) => `${p.first_name} ${p.last_name}`.toLowerCase().includes(queryLower))
        : pool;

    const tbody = $('#available-tbody');
    if (filtered.length === 0) {
        if (!queryLower) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="3" class="muted">Everyone is checked in.</td></tr>';
            return;
        }
        const matchesSomeoneAlreadyPresent = allPlayers.some(
            (p) => present.has(p.id) && `${p.first_name} ${p.last_name}`.toLowerCase().includes(queryLower)
        );
        if (matchesSomeoneAlreadyPresent) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="3" class="muted">Already checked in.</td></tr>';
        } else {
            tbody.innerHTML = `
                <tr class="empty-row"><td colspan="3" class="muted">No matching players.</td></tr>
                <tr class="empty-row"><td colspan="3"><a class="textlink" data-action="add-new" data-query="${esc(query)}">+ Add "${esc(query)}" as a new player</a></td></tr>
            `;
        }
        return;
    }
    tbody.innerHTML = filtered
        .slice()
        .sort((a, b) => a.last_name.localeCompare(b.last_name))
        .map((p) => `
            <tr data-player-id="${p.id}">
                <td>${p.first_name} ${p.last_name}</td>
                <td>${skillBadge(p.skill_level)}</td>
                <td class="muted">${p.membership_status}</td>
            </tr>
        `).join('');
}

function memberFlagBadges(a) {
    const firstTime = a.first_time ? '<span class="first-time-badge">1st</span>' : '';
    const newMember = a.new_member ? '<span class="first-time-badge">New</span>' : '';
    return `${firstTime}${newMember}`;
}

function paymentCellHtml(a) {
    if (a.payment_category_id) {
        const cls = (a.payment_amount_cents ?? 0) === 0 ? 'free' : '';
        return `<span class="payment-badge ${cls}">${esc(a.payment_category_name || 'Paid')} ${formatCents(a.payment_amount_cents)}</span>`;
    }
    return '<span class="payment-badge unpaid">Unpaid</span>';
}

function renderHereTable() {
    const present = attendance.filter((a) => a.state !== 'left');
    $('#here-count').textContent = present.length;

    const tbody = $('#here-tbody');
    const colspan = paymentTrackingEnabled ? 4 : 3;
    if (present.length === 0) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="${colspan}" class="muted">No one checked in yet.</td></tr>`;
        return;
    }
    tbody.innerHTML = present
        .slice()
        .sort((a, b) => a.last_name.localeCompare(b.last_name))
        .map((a) => `
            <tr data-attendance-id="${a.id}" data-player-id="${a.player_id}">
                <td>${a.first_name} ${a.last_name} ${memberFlagBadges(a)}</td>
                <td>${skillBadge(a.skill_level)}</td>
                <td class="muted">${a.state === 'playing' ? 'playing' : 'waiting'}</td>
                ${paymentTrackingEnabled ? `<td class="payment-cell">${paymentCellHtml(a)}</td>` : ''}
            </tr>
        `).join('');
}

async function checkInPlayer(playerId) {
    try {
        await api(`/api/sessions/${openSession.id}/attendance`, {
            method: 'POST',
            body: JSON.stringify({ player_id: playerId }),
        });
        await refreshAttendance();
    } catch (err) {
        showError(err.message);
    }
}

async function removeFromToday(attendanceId, playerId) {
    const a = attendance.find((x) => x.player_id === playerId);
    const name = a ? `${a.first_name} ${a.last_name}` : 'this player';
    if (!confirm(`Remove ${name} from today?`)) return;
    try {
        await api(`/api/attendance/${attendanceId}`, {
            method: 'PUT',
            body: JSON.stringify({ state: 'left', left_reason: 'removed' }),
        });
        await refreshAttendance();
    } catch (err) {
        showError(err.message);
    }
}

$('#available-tbody').addEventListener('dblclick', (e) => {
    const tr = e.target.closest('tr[data-player-id]');
    if (!tr) return;
    openCheckinModal(Number(tr.dataset.playerId));
});

$('#available-tbody').addEventListener('click', (e) => {
    const link = e.target.closest('a[data-action="add-new"]');
    if (!link) return;
    openAddPlayerForm(link.dataset.query);
});

function openAddPlayerForm(prefillFullName) {
    const form = $('#add-player-form');
    form.style.display = 'block';
    if (prefillFullName) $('#np-name').value = prefillFullName.trim();
    $('#np-name').focus();
}

// Splits "Joe Bloggs" -> {first: "Joe", last: "Bloggs"}; "Joe Van Bloggs" ->
// {first: "Joe", last: "Van Bloggs"} (first word is the first name, the rest
// - however many words - is the last name). Returns null if there's no space
// at all, since a last name is required.
function splitFullName(fullName) {
    const trimmed = fullName.trim().replace(/\s+/g, ' ');
    const spaceIdx = trimmed.indexOf(' ');
    if (spaceIdx === -1) return null;
    return { first: trimmed.slice(0, spaceIdx), last: trimmed.slice(spaceIdx + 1) };
}

// --- Check-in modal (double-click an available player) ---
function openCheckinModal(playerId) {
    const p = allPlayers.find((x) => x.id === playerId);
    if (!p) return;
    checkinModalPlayerId = playerId;
    $('#cm-player-name').textContent = `${p.first_name} ${p.last_name}`;
    $('#cm-grade').value = p.skill_level;
    $('#cm-grade-saved').style.display = 'none';
    $('#cm-gender-quick').value = p.gender || '';
    $('#cm-gender-saved').style.display = 'none';
    $('#cm-edit-form').style.display = 'none';
    fillEditFormFromPlayer(p);
    $('#cm-error').style.display = 'none';
    $('#cm-visitor-new-member').checked = false;

    if (paymentTrackingEnabled && sessionPaymentRates.length === 0) {
        // Should be rare now that a new session always gets seeded with at
        // least the club's active categories (see routes/sessions.js), but
        // stay safe if a club deactivates every category mid-session - a
        // dead-end empty dropdown is worse than a clear message here.
        showError('This session has no payment categories configured, so nobody can be checked in. Add rates on the Club page, or ask an admin to fix this session\'s pricing.');
        return;
    }

    if (paymentTrackingEnabled) {
        $('#cm-payment-section').style.display = 'block';
        $('#cm-note-section').style.display = 'block';
        const select = $('#cm-category');
        select.innerHTML = '<option value="" selected>Select payment&hellip;</option>'
            + sessionPaymentRates.map((r) => `<option value="${r.payment_category_id}" data-cents="${r.amount_cents}">${esc(r.name)}${r.amount_cents > 0 ? ` - ${formatCents(r.amount_cents)}` : ''}</option>`).join('');
        $('#cm-amount').value = '';
        $('#cm-note').value = '';
        $('#cm-hint').style.display = 'none';
    } else {
        $('#cm-payment-section').style.display = 'none';
        $('#cm-note-section').style.display = 'none';
    }

    $('#checkin-modal-backdrop').style.display = 'flex';
}

function fillEditFormFromPlayer(p) {
    $('#cm-first').value = p.first_name;
    $('#cm-last').value = p.last_name;
    $('#cm-status').value = p.membership_status;
}

// Grade is edited directly (not behind "Edit") since it's the field staff
// change most often - saves immediately and sticks with the player record,
// same as any other profile edit.
$('#cm-grade').addEventListener('change', async () => {
    if (!checkinModalPlayerId) return;
    try {
        const updated = await api(`/api/players/${checkinModalPlayerId}`, {
            method: 'PUT',
            body: JSON.stringify({ skill_level: $('#cm-grade').value }),
        });
        const idx = allPlayers.findIndex((x) => x.id === checkinModalPlayerId);
        if (idx !== -1) allPlayers[idx] = updated;
        $('#cm-grade-saved').style.display = 'block';
        setTimeout(() => { $('#cm-grade-saved').style.display = 'none'; }, 1500);
    } catch (err) {
        showError(err.message);
    }
});

// Gender, same pattern as Grade above - edited directly, saves immediately.
$('#cm-gender-quick').addEventListener('change', async () => {
    if (!checkinModalPlayerId) return;
    try {
        const updated = await api(`/api/players/${checkinModalPlayerId}`, {
            method: 'PUT',
            body: JSON.stringify({ gender: $('#cm-gender-quick').value || null }),
        });
        const idx = allPlayers.findIndex((x) => x.id === checkinModalPlayerId);
        if (idx !== -1) allPlayers[idx] = updated;
        $('#cm-gender-saved').style.display = 'block';
        setTimeout(() => { $('#cm-gender-saved').style.display = 'none'; }, 1500);
    } catch (err) {
        showError(err.message);
    }
});

function closeCheckinModal() {
    $('#checkin-modal-backdrop').style.display = 'none';
    checkinModalPlayerId = null;
}

function updateCheckinHint() {
    const amount = parseFloat($('#cm-amount').value);
    $('#cm-hint').style.display = !Number.isNaN(amount) && amount === 0 ? 'block' : 'none';
}

$('#cm-edit-toggle').addEventListener('click', () => {
    const form = $('#cm-edit-form');
    if (form.style.display === 'none') {
        const p = allPlayers.find((x) => x.id === checkinModalPlayerId);
        if (p) fillEditFormFromPlayer(p);
        form.style.display = 'block';
    } else {
        form.style.display = 'none';
    }
});

$('#cm-edit-cancel').addEventListener('click', () => {
    $('#cm-edit-form').style.display = 'none';
});

$('#cm-edit-save').addEventListener('click', async () => {
    const first_name = $('#cm-first').value.trim();
    const last_name = $('#cm-last').value.trim();
    if (!first_name || !last_name) {
        showError('First and last name are required.');
        return;
    }
    try {
        const updated = await api(`/api/players/${checkinModalPlayerId}`, {
            method: 'PUT',
            body: JSON.stringify({
                first_name,
                last_name,
                membership_status: $('#cm-status').value,
            }),
        });
        const idx = allPlayers.findIndex((x) => x.id === checkinModalPlayerId);
        if (idx !== -1) allPlayers[idx] = updated;
        $('#cm-player-name').textContent = `${updated.first_name} ${updated.last_name}`;
        $('#cm-edit-form').style.display = 'none';
        showError('');
    } catch (err) {
        showError(err.message);
    }
});

$('#cm-category').addEventListener('change', () => {
    const opt = $('#cm-category').selectedOptions[0];
    // Only auto-fill from a category with a real configured price (template
    // sessions - Member/Non-Member/etc). A $0 category is a payment *type*
    // with no fixed price of its own (e.g. Cash/Card/Voucher on a one-off
    // session) - picking one shouldn't stomp on an amount staff already typed.
    if (opt && opt.dataset.cents !== undefined && Number(opt.dataset.cents) > 0) {
        $('#cm-amount').value = (Number(opt.dataset.cents) / 100).toFixed(2);
        updateCheckinHint();
    }
});

$('#cm-amount').addEventListener('input', updateCheckinHint);
$('#cm-cancel').addEventListener('click', closeCheckinModal);
// Only closes when BOTH the mousedown and the click landed on the backdrop
// itself - otherwise dragging inside a field (e.g. selecting text in the
// Amount box) and releasing the mouse past the modal's edge closed it and
// threw away everything typed so far.
let checkinModalMouseDownTarget = null;
$('#checkin-modal-backdrop').addEventListener('mousedown', (e) => { checkinModalMouseDownTarget = e.target; });
$('#checkin-modal-backdrop').addEventListener('click', (e) => {
    if (e.target.id === 'checkin-modal-backdrop' && checkinModalMouseDownTarget?.id === 'checkin-modal-backdrop') closeCheckinModal();
});

$('#cm-checkin').addEventListener('click', async () => {
    const playerId = checkinModalPlayerId;
    if (!playerId) return;
    $('#cm-error').style.display = 'none';

    let categoryId = null;
    let amountCents = 0;
    if (paymentTrackingEnabled) {
        const categoryValue = $('#cm-category').value;
        if (!categoryValue) {
            $('#cm-error').textContent = 'Please select a payment option before checking in.';
            $('#cm-error').style.display = 'block';
            return;
        }
        // A voucher is already prepaid - no amount to collect or log, so an
        // empty Amount field just means $0 rather than a validation error.
        const selectedRate = sessionPaymentRates.find((r) => String(r.payment_category_id) === categoryValue);
        const amountRaw = $('#cm-amount').value.trim();
        let amountDollars = 0;
        if (amountRaw === '' && selectedRate?.name === 'Voucher') {
            amountDollars = 0;
        } else {
            amountDollars = parseFloat(amountRaw);
            if (Number.isNaN(amountDollars) || amountDollars < 0) {
                $('#cm-error').textContent = 'Amount must be a valid non-negative number.';
                $('#cm-error').style.display = 'block';
                return;
            }
        }
        categoryId = Number(categoryValue);
        amountCents = Math.round(amountDollars * 100);
    }

    // "Visitor / New Member" sets both underlying flags together - they're
    // still two independent columns (first_time, new_member) for existing
    // reports, just no longer distinguished from each other at check-in.
    const visitorOrNewMember = $('#cm-visitor-new-member').checked;
    const patch = {};
    if (paymentTrackingEnabled) {
        patch.payment_category_id = categoryId;
        patch.payment_amount_cents = amountCents;
        patch.payment_note = $('#cm-note').value.trim() || null;
    }
    if (visitorOrNewMember) {
        patch.first_time = true;
        patch.new_member = true;
    }

    try {
        const newAttendance = await api(`/api/sessions/${openSession.id}/attendance`, {
            method: 'POST',
            body: JSON.stringify({ player_id: playerId }),
        });
        if (Object.keys(patch).length > 0) {
            await api(`/api/attendance/${newAttendance.id}`, {
                method: 'PUT',
                body: JSON.stringify(patch),
            });
        }
        closeCheckinModal();
        await refreshAttendance();
    } catch (err) {
        $('#cm-error').textContent = err.message;
        $('#cm-error').style.display = 'block';
    }
});

$('#here-tbody').addEventListener('dblclick', (e) => {
    if (e.target.closest('.payment-cell')) return; // payment editing lives on single-click, not removal
    const tr = e.target.closest('tr[data-attendance-id]');
    if (!tr) return;
    removeFromToday(Number(tr.dataset.attendanceId), Number(tr.dataset.playerId));
});

$('#here-tbody').addEventListener('click', (e) => {
    const cell = e.target.closest('.payment-cell');
    if (!cell) return;
    const tr = cell.closest('tr[data-attendance-id]');
    openPaymentModal(Number(tr.dataset.attendanceId));
});

// --- Payment recording ---
function openPaymentModal(attendanceId) {
    const a = attendance.find((x) => x.id === attendanceId);
    if (!a) return;
    if (sessionPaymentRates.length === 0) {
        showError('This session has no payment categories configured. Add them on the Club page.');
        return;
    }
    paymentModalContext = { attendanceId };
    $('#pm-player-name').textContent = `${a.first_name} ${a.last_name}`;

    const select = $('#pm-category');
    select.innerHTML = sessionPaymentRates.map((r) => `<option value="${r.payment_category_id}" data-cents="${r.amount_cents}">${esc(r.name)}${r.amount_cents > 0 ? ` - ${formatCents(r.amount_cents)}` : ''}</option>`).join('');
    if (a.payment_category_id) select.value = String(a.payment_category_id);

    const selectedRate = sessionPaymentRates.find((r) => r.payment_category_id === Number(select.value)) || sessionPaymentRates[0];
    $('#pm-amount').value = a.payment_amount_cents != null ? (a.payment_amount_cents / 100).toFixed(2) : ((selectedRate.amount_cents) / 100).toFixed(2);
    $('#pm-note').value = a.payment_note || '';
    $('#pm-visitor-new-member').checked = !!a.first_time || !!a.new_member;
    updatePaymentHint();
    $('#payment-modal-backdrop').style.display = 'flex';
}

function updatePaymentHint() {
    const amount = parseFloat($('#pm-amount').value);
    $('#pm-hint').style.display = !Number.isNaN(amount) && amount === 0 ? 'block' : 'none';
}

function closePaymentModal() {
    $('#payment-modal-backdrop').style.display = 'none';
    paymentModalContext = null;
}

$('#pm-category').addEventListener('change', () => {
    const opt = $('#pm-category').selectedOptions[0];
    if (opt && Number(opt.dataset.cents) > 0) {
        $('#pm-amount').value = (Number(opt.dataset.cents) / 100).toFixed(2);
        updatePaymentHint();
    }
});

$('#pm-amount').addEventListener('input', updatePaymentHint);
$('#pm-cancel').addEventListener('click', closePaymentModal);
let paymentModalMouseDownTarget = null;
$('#payment-modal-backdrop').addEventListener('mousedown', (e) => { paymentModalMouseDownTarget = e.target; });
$('#payment-modal-backdrop').addEventListener('click', (e) => {
    if (e.target.id === 'payment-modal-backdrop' && paymentModalMouseDownTarget?.id === 'payment-modal-backdrop') closePaymentModal();
});

$('#pm-save').addEventListener('click', async () => {
    if (!paymentModalContext) return;
    const categoryId = Number($('#pm-category').value);
    const amountDollars = parseFloat($('#pm-amount').value);
    if (Number.isNaN(amountDollars) || amountDollars < 0) {
        showError('Amount must be a valid non-negative number.');
        return;
    }
    try {
        await api(`/api/attendance/${paymentModalContext.attendanceId}`, {
            method: 'PUT',
            body: JSON.stringify({
                payment_category_id: categoryId,
                payment_amount_cents: Math.round(amountDollars * 100),
                payment_note: $('#pm-note').value.trim() || null,
                first_time: $('#pm-visitor-new-member').checked,
                new_member: $('#pm-visitor-new-member').checked,
            }),
        });
        closePaymentModal();
        showError('');
        await refreshAttendance();
    } catch (err) {
        showError(err.message);
    }
});

// --- Quick-add new player ---
$('#show-add-player').addEventListener('click', () => {
    const form = $('#add-player-form');
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
});

$('#np-submit').addEventListener('click', async () => {
    const name = splitFullName($('#np-name').value);
    if (!name) {
        showError('Enter a first and last name, e.g. "Joe Bloggs".');
        return;
    }
    try {
        const player = await api('/api/players', {
            method: 'POST',
            body: JSON.stringify({
                first_name: name.first,
                last_name: name.last,
                skill_level: $('#np-skill').value,
                gender: $('#np-gender').value || null,
                membership_status: $('#np-status').value,
            }),
        });
        await loadAllPlayers();
        $('#player-search').value = '';
        $('#np-name').value = '';
        $('#add-player-form').style.display = 'none';
        // Same prompt as checking in an existing player - a new player is
        // not "here today" until the check-in (and payment) modal is
        // completed, not just created.
        openCheckinModal(player.id);
    } catch (err) {
        showError(err.message);
    }
});

$('#player-search').addEventListener('input', renderAvailableTable);

// After closing, show the night's cash-up totals so whoever's finishing up
// can reconcile the cash box before leaving - without a trip to History to
// run a date-range export just to see tonight's numbers. Non-fatal if this
// part fails (session is already closed either way).
async function showFinishedSessionSummary(sessionId) {
    try {
        const summary = await api(`/api/sessions/${sessionId}/payment-summary`);
        const body = summary.payment_breakdown.length
            ? summary.payment_breakdown.map((p) => `${p.category}: $${(p.amount_cents / 100).toFixed(2)}`).join('\n')
                + `\n\nTotal funds: $${(summary.total_funds_cents / 100).toFixed(2)}`
            : 'No payments recorded.';
        alert(`Session finished - ${summary.session.label || 'Session'} (${summary.session.date})\n\n${body}`);
    } catch (err) { /* non-fatal */ }
}

$('#finish-session-btn').addEventListener('click', async () => {
    if (!openSession) return;
    if (!confirm(`Finish today's session (${openSession.label || 'Session'} - ${openSession.date})? This closes check-in and rounds for the day - you can start a new session afterwards.`)) return;
    try {
        const sessionId = openSession.id;
        await api(`/api/sessions/${sessionId}`, {
            method: 'PUT',
            body: JSON.stringify({ status: 'closed' }),
        });
        showError('');
        await checkSessionState();
        await showFinishedSessionSummary(sessionId);
    } catch (err) {
        showError(err.message);
    }
});

init();
