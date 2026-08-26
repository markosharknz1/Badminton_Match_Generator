// Session history / audit view. Read-only: three views (session list,
// one session's rounds, one player's cross-session game history) toggled
// client-side. Nothing here writes - the audit trail is append-only.

let searchDebounce = null;

function $(sel) { return document.querySelector(sel); }

async function api(path) {
    const res = await fetch(path);
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
    return body;
}

function showError(message) {
    const el = $('#error-banner');
    el.textContent = message;
    el.style.display = message ? 'block' : 'none';
}

function skillTag(skill) {
    return skill ? `<span class="badge skill-${skill}">${skill}</span>` : '';
}

function esc(s) {
    return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function showView(which) {
    $('#landing-view').style.display = which === 'landing' ? 'block' : 'none';
    $('#session-view').style.display = which === 'session' ? 'block' : 'none';
    $('#player-view').style.display = which === 'player' ? 'block' : 'none';
}

// --- Session list ---
let allSessions = [];

async function loadSessions() {
    allSessions = await api('/api/history/sessions');
    const tbody = $('#sessions-table tbody');
    if (allSessions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="muted">No sessions yet.</td></tr>';
    } else {
        tbody.innerHTML = allSessions.map((s) => `
            <tr data-session-id="${s.id}">
                <td>${esc(s.date)}</td>
                <td>${esc(s.label || 'Session')} ${s.status === 'open' ? '<span class="badge">open</span>' : ''}</td>
                <td>${esc(s.mode)}</td>
                <td class="num">${s.players_checked_in}</td>
                <td class="num">${s.rounds_played}</td>
                <td class="num">${s.games_played}</td>
            </tr>
        `).join('');
        tbody.querySelectorAll('tr[data-session-id]').forEach((tr) => {
            tr.addEventListener('click', () => openSession(Number(tr.dataset.sessionId)));
        });
    }
    renderCalendar();
}

// --- Calendar (ported from the club's other admin app, Club Training) ---
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const today = new Date();
let calYear = today.getFullYear();
let calMonth = today.getMonth() + 1; // 1-12

function pad2(n) { return String(n).padStart(2, '0'); }
function dateKey(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function mondayIndex(jsDay) { return (jsDay + 6) % 7; } // getDay(): 0=Sun..6=Sat -> Mon-first 0..6

// Weeks of date objects covering the given month, padded with adjacent-month
// days so every week is a full 7 days (Mon-first, matching Club Training's
// calendar.monthdatescalendar()).
function buildCalendarWeeks(year, month) {
    const first = new Date(year, month - 1, 1);
    const daysInMonth = new Date(year, month, 0).getDate();
    const startOffset = mondayIndex(first.getDay());
    const cells = [];
    for (let i = startOffset; i > 0; i--) cells.push(new Date(year, month - 1, 1 - i));
    for (let day = 1; day <= daysInMonth; day++) cells.push(new Date(year, month - 1, day));
    while (cells.length % 7 !== 0) {
        const last = cells[cells.length - 1];
        cells.push(new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1));
    }
    const weeks = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    return weeks;
}

function renderCalendar() {
    const byDate = new Map();
    for (const s of allSessions) {
        if (!byDate.has(s.date)) byDate.set(s.date, []);
        byDate.get(s.date).push(s);
    }

    $('#calendar-title').textContent = `${MONTH_NAMES[calMonth - 1]} ${calYear}`;
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    $('#calendar-thead').innerHTML = `<tr>${dayNames.map((d) => `<th>${d}</th>`).join('')}</tr>`;

    const todayKey = dateKey(today);
    const weeks = buildCalendarWeeks(calYear, calMonth);
    $('#calendar-tbody').innerHTML = weeks.map((week) => `
        <tr>${week.map((d) => {
            const key = dateKey(d);
            const inMonth = d.getMonth() === calMonth - 1;
            const cellClasses = ['calendar-cell', !inMonth && 'calendar-cell-out', key === todayKey && 'calendar-cell-today'].filter(Boolean).join(' ');
            const sessions = byDate.get(key) || [];
            const badges = sessions.map((s) => `
                <a href="#" class="badge calendar-badge session-${s.status}" data-session-id="${s.id}" title="${esc(s.label || 'Session')} - ${s.players_checked_in} player${s.players_checked_in === 1 ? '' : 's'}">${esc(s.label || 'Session')} - ${s.players_checked_in}</a>
            `).join('');
            return `<td class="${cellClasses}"><div class="calendar-date">${d.getDate()}</div>${badges}</td>`;
        }).join('')}</tr>
    `).join('');

    $('#calendar-tbody').querySelectorAll('.calendar-badge').forEach((el) => {
        el.addEventListener('click', (e) => {
            e.preventDefault();
            openSession(Number(el.dataset.sessionId));
        });
    });
}

$('#calendar-prev').addEventListener('click', () => {
    calMonth--;
    if (calMonth < 1) { calMonth = 12; calYear--; }
    renderCalendar();
});

$('#calendar-next').addEventListener('click', () => {
    calMonth++;
    if (calMonth > 12) { calMonth = 1; calYear++; }
    renderCalendar();
});

// --- One session's rounds ---
async function openSession(sessionId) {
    try {
        const data = await api(`/api/history/sessions/${sessionId}`);
        showView('session');
        $('#session-title').textContent = `${data.session.label || 'Session'} - ${data.session.date}`;
        mountTonightSummary($('#session-payment-summary'), sessionId);
        const container = $('#session-rounds');
        if (data.rounds.length === 0) {
            container.innerHTML = '<p class="muted">No games were played in this session.</p>';
            return;
        }
        container.innerHTML = data.rounds.map((round) => `
            <div class="round-block">
                <h3>Round ${round.round_number}</h3>
                ${round.games.map((g) => renderGameRow(g)).join('')}
            </div>
        `).join('');
    } catch (err) {
        showError(err.message);
    }
}

function renderGameRow(g) {
    const side = (n) => g.players
        .filter((p) => p.side === n)
        .map((p) => `${esc(p.first_name)} ${esc(p.last_name)}${skillTag(p.skill_level_at_time)}`)
        .join(' & ') || '<span class="muted">-</span>';
    return `
        <div class="history-game">
            <span class="court-tag">Court ${g.court_number}</span>
            <span class="team">${side(1)}</span>
            <span class="vs">vs</span>
            <span class="team">${side(2)}</span>
            <span class="muted">${esc(g.format)}</span>
        </div>
    `;
}

// --- One player's history ---
async function openPlayer(playerId) {
    const from = $('#filter-from').value;
    const to = $('#filter-to').value;
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString() ? `?${params.toString()}` : '';
    try {
        const data = await api(`/api/history/players/${playerId}${qs}`);
        showView('player');
        $('#player-title').textContent = `${data.player.first_name} ${data.player.last_name}`;
        const rangeNote = (from || to) ? ` (${from || 'start'} to ${to || 'now'})` : '';
        $('#player-subtitle').innerHTML = `Current grade ${skillTag(data.player.skill_level)} - ${data.games.length} game${data.games.length === 1 ? '' : 's'} on record${rangeNote}. Grade shown per row is what they were officially playing at that night.`;
        const tbody = $('#player-games-table tbody');
        if (data.games.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="muted">No games on record for this range.</td></tr>';
            return;
        }
        tbody.innerHTML = data.games.map((g) => `
            <tr>
                <td>${esc(g.date)}</td>
                <td>${esc(g.label || 'Session')}</td>
                <td class="num">${g.round_number}</td>
                <td class="num">${g.court_number}</td>
                <td class="num">${skillTag(g.skill_level_at_time)}</td>
                <td>${g.partners.map((p) => `${esc(p.first_name)} ${esc(p.last_name)}${skillTag(p.skill_level_at_time)}`).join(', ') || '<span class="muted">-</span>'}</td>
                <td>${g.opponents.map((p) => `${esc(p.first_name)} ${esc(p.last_name)}${skillTag(p.skill_level_at_time)}`).join(', ')}</td>
            </tr>
        `).join('');
    } catch (err) {
        showError(err.message);
    }
}

// --- Player search box ---
async function runPlayerSearch() {
    const q = $('#player-search').value.trim();
    const resultsEl = $('#player-search-results');
    if (!q) { resultsEl.innerHTML = ''; return; }
    try {
        const players = await api(`/api/players?search=${encodeURIComponent(q)}`);
        resultsEl.innerHTML = players.slice(0, 8).map((p) => `
            <div data-player-id="${p.id}">${esc(p.first_name)} ${esc(p.last_name)}${skillTag(p.skill_level)}</div>
        `).join('') || '<div class="muted">No matches</div>';
        resultsEl.querySelectorAll('div[data-player-id]').forEach((el) => {
            el.addEventListener('click', () => {
                $('#player-search').value = '';
                resultsEl.innerHTML = '';
                openPlayer(Number(el.dataset.playerId));
            });
        });
    } catch (err) {
        showError(err.message);
    }
}

$('#player-search').addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(runPlayerSearch, 200);
});

$('#back-from-session').addEventListener('click', () => { showView('landing'); loadSessions(); });
$('#back-from-player').addEventListener('click', () => showView('landing'));

// --- Excel export (uses the From/To filter above) ---
function reportRangeQs() {
    const from = $('#filter-from').value;
    const to = $('#filter-to').value;
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return params.toString() ? `?${params.toString()}` : '';
}

$('#report-download').addEventListener('click', () => {
    // Direct navigation so the browser handles the file download with the
    // server-set filename; no fetch/blob juggling needed.
    window.location.href = `/api/export/report.xlsx${reportRangeQs()}`;
});

// --- Boot ---
async function init() {
    try {
        const club = await api('/api/club-settings');
        $('#club-name').textContent = club.club_name;
        applyBranding(club);
    } catch (err) { /* non-fatal */ }
    try {
        await loadSessions();
    } catch (err) {
        showError(err.message);
    }
    mountTonightSummary($('#tonight-summary'));
    // Live-refresh the session list as games complete in other tabs.
    subscribeToEvents((msg) => {
        if ($('#landing-view').style.display !== 'none' && (msg.type === 'game' || msg.type === 'session')) {
            loadSessions().catch(() => {});
        }
        if (msg.type === 'session' || msg.type === 'attendance') {
            mountTonightSummary($('#tonight-summary'));
        }
    });
}

init();
