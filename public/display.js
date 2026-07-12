// Read-only kiosk display for a TV at the venue. No controls - players
// glance at it for current matches, the countdown, and the waiting list.
// State updates arrive over SSE; the countdown ticks locally every second
// between updates so the timer never looks stale.

let displayData = null;
let countdownHandle = null;

function $(sel) { return document.querySelector(sel); }

async function api(path) {
    const res = await fetch(path);
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
    return body;
}

function parseUtc(dtStr) {
    // Server stores 'YYYY-MM-DD HH:MM:SS' in UTC (SQLite datetime('now')).
    return new Date(`${dtStr.replace(' ', 'T')}Z`).getTime();
}

function skillTag(skill) {
    return skill ? `<span class="skill">${skill}</span>` : '';
}

function playerName(p) {
    return `${p.first_name} ${p.last_name}`;
}

async function refresh() {
    let session;
    try {
        session = await api('/api/sessions/open');
    } catch (err) {
        showIdle();
        return;
    }
    try {
        displayData = await api(`/api/sessions/${session.id}/display`);
        render();
    } catch (err) {
        console.error(err);
    }
}

function showIdle() {
    displayData = null;
    $('#idle-screen').style.display = 'block';
    $('#live-screen').style.display = 'none';
}

function render() {
    const d = displayData;
    $('#idle-screen').style.display = 'none';
    $('#live-screen').style.display = 'block';

    $('#club-name').textContent = d.club_name;
    $('#session-label').textContent = `${d.session.label || 'Session'} - ${d.session.date}`;

    renderPhase();
    renderCourts();
    renderWaiting();
}

function renderPhase() {
    const phase = displayData.session.current_phase;
    const label = $('#phase-label');
    label.className = `phase-label ${phase}`;
    if (phase === 'game') label.textContent = 'Round ends in';
    else if (phase === 'break') label.textContent = 'Next round in';
    else if (phase === 'awaiting_lineup') label.textContent = 'Waiting for next lineup';
    else label.textContent = 'Session starting soon';
    tickCountdown();
}

function tickCountdown() {
    const el = $('#countdown');
    const phase = displayData?.session.current_phase;
    const endsAt = displayData?.session.phase_ends_at;
    if (!displayData || !endsAt || (phase !== 'game' && phase !== 'break')) {
        el.textContent = '';
        return;
    }
    const remainingMs = parseUtc(endsAt) - Date.now();
    if (remainingMs <= 0) {
        // Timer hit zero; the server scheduler transitions within a few
        // seconds and an SSE event will re-render. Show 0:00, never negative.
        el.textContent = '0:00';
        el.className = 'urgent';
        return;
    }
    const totalSeconds = Math.floor(remainingMs / 1000);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    el.textContent = `${mins}:${String(secs).padStart(2, '0')}`;
    el.className = totalSeconds <= 60 ? 'urgent' : '';
}

function renderCourts() {
    const d = displayData;
    const gamesByCourt = new Map(d.active_games.map((g) => [g.court_id, g]));
    $('#courts').innerHTML = d.courts.map((c) => {
        const game = gamesByCourt.get(c.court_id);
        if (!game) {
            return `<div class="court free"><span>Court ${c.court_number} - free</span></div>`;
        }
        const side = (n) => game.players
            .filter((p) => p.side === n)
            .map((p) => `${playerName(p)}${skillTag(p.skill_level_at_time)}`)
            .join(' &amp; ');
        return `
            <div class="court">
                <h2>Court ${c.court_number} <span class="format">${game.format}</span></h2>
                <div class="team">${side(1)}</div>
                <div class="vs">vs</div>
                <div class="team">${side(2)}</div>
            </div>
        `;
    }).join('');
}

function renderWaiting() {
    const d = displayData;
    $('#waiting-count').textContent = `(${d.waiting.length})`;
    $('#waiting-list').innerHTML = d.waiting.length
        ? d.waiting.map((w) => `
            <div class="waiting-player">
                ${playerName(w)}${skillTag(w.skill_level)}
                ${w.sit_out_count > 0 ? `<span class="sit-out">sat out ${w.sit_out_count}</span>` : ''}
            </div>
        `).join('')
        : '<div class="waiting-player">Everyone is on court</div>';
}

subscribeToEvents((msg) => {
    // Any state change that could affect what's on screen -> refetch the one
    // aggregate payload. Cheap on a LAN and keeps the logic trivial.
    if (['session', 'game', 'attendance', 'club_settings'].includes(msg.type)) {
        refresh();
    }
});

countdownHandle = setInterval(tickCountdown, 1000);

api('/api/club-settings')
    .then((club) => { $('#idle-club-name').textContent = club.club_name; })
    .catch(() => {});

refresh();
