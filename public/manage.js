// Management screen: round lifecycle controls + manual game builder
// (drag players from the pool onto a court's sides, stage/edit/unstage,
// stage rounds ahead of the one currently playing).

let openSession = null;
let sessionCourts = []; // [{court_id, court_number, label}]
let roundStatus = null; // last GET /rounds/status response
let buildRound = null;
let buildState = {}; // court_id -> { staged: {gameId,format,side1,side2} | null, draft: {format,side1,side2}, editing: bool }
let attendancePool = []; // present players (here_today or playing) for this session
let playedPreviousRoundIds = new Set(); // player ids who played in buildRound-1, for the pool split

const FORMAT_SIZES = { doubles: 4, singles: 2 };

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

function courtNumberFor(courtId) {
    const c = sessionCourts.find((sc) => sc.court_id === courtId);
    return c ? c.court_number : courtId;
}

function timeOnly(dtStr) {
    if (!dtStr) return '';
    return dtStr.split(' ')[1] || dtStr;
}

// --- Boot / session state ---
async function checkSessionState() {
    try {
        openSession = await api('/api/sessions/open');
        $('#no-session-panel').style.display = 'none';
        $('#session-meta').textContent = `${openSession.label || 'Session'} - ${openSession.date} - ${openSession.mode} mode`;

        if (openSession.mode === 'social') {
            // No rounds at all in social mode - the check-in screen is the whole workflow.
            $('#social-panel').style.display = 'block';
            $('#manage-panel').style.display = 'none';
            return;
        }
        $('#social-panel').style.display = 'none';
        $('#manage-panel').style.display = 'block';
        sessionCourts = await api(`/api/sessions/${openSession.id}/courts`);
        await refreshAll();
    } catch (err) {
        if (err.message.includes('No open session')) {
            openSession = null;
            $('#no-session-panel').style.display = 'block';
            $('#social-panel').style.display = 'none';
            $('#manage-panel').style.display = 'none';
            $('#session-meta').textContent = 'No session open';
        } else {
            showError(err.message);
        }
    }
}

async function refreshAll() {
    await loadRoundStatus();
    await loadAttendancePool();
    await loadActiveGames();
    const targetRound = buildRound && buildRound >= roundStatus.next_round_number ? buildRound : roundStatus.next_round_number;
    await loadBuilderForRound(targetRound);
}

function handleServerEvent(msg) {
    if (!msg.type) return;
    if (msg.type === 'session') {
        checkSessionState().catch((err) => showError(err.message));
        return;
    }
    if (!openSession) return;
    if (msg.type === 'game' && msg.session_id === openSession.id) {
        loadRoundStatus()
            .then(() => loadActiveGames())
            .then(() => loadBuilderForRound(buildRound))
            .catch((err) => showError(err.message));
    } else if (msg.type === 'attendance' && msg.session_id === openSession.id) {
        loadAttendancePool()
            .then(() => renderBuilder())
            .catch((err) => showError(err.message));
    } else if (msg.type === 'auto_generate_failed' && msg.session_id === openSession.id) {
        showError(msg.message);
    } else if (msg.type === 'scheduler_error' && msg.session_id === openSession.id) {
        showError(`Scheduler error: ${msg.message}`);
    }
}

async function init() {
    try {
        const club = await api('/api/club-settings');
        $('#club-name').textContent = club.club_name;
    } catch (err) {
        // non-fatal
    }
    await checkSessionState();
    subscribeToEvents(handleServerEvent);
}

// --- Round status + controls ---
async function loadRoundStatus() {
    roundStatus = await api(`/api/sessions/${openSession.id}/rounds/status`);
    renderRoundControls();
}

function renderRoundControls() {
    const badge = $('#phase-badge');
    badge.textContent = roundStatus.current_phase.replace('_', ' ');
    badge.className = `phase-badge ${roundStatus.current_phase}`;

    const detail = $('#phase-detail');
    const btn = $('#round-action-btn');

    if (roundStatus.current_phase === 'game') {
        detail.textContent = roundStatus.phase_ends_at ? `round ${roundStatus.current_round} - ends ${timeOnly(roundStatus.phase_ends_at)}` : `round ${roundStatus.current_round}`;
        btn.textContent = `End round ${roundStatus.current_round}`;
        btn.disabled = false;
        btn.onclick = () => runRoundAction(() => api(`/api/sessions/${openSession.id}/rounds/end-game`, { method: 'POST' }));
    } else if (roundStatus.current_phase === 'break') {
        detail.textContent = roundStatus.phase_ends_at ? `break - ends ${timeOnly(roundStatus.phase_ends_at)}` : 'break';
        btn.textContent = 'End break';
        btn.disabled = false;
        btn.onclick = () => runRoundAction(() => api(`/api/sessions/${openSession.id}/rounds/end-break`, { method: 'POST' }));
    } else {
        // idle or awaiting_lineup
        const isAuto = openSession.mode === 'auto';
        const canStart = roundStatus.staged_next_count > 0 || isAuto;
        if (roundStatus.staged_next_count > 0) {
            detail.textContent = `${roundStatus.staged_next_count} court${roundStatus.staged_next_count === 1 ? '' : 's'} staged for round ${roundStatus.next_round_number}`;
        } else if (isAuto) {
            detail.textContent = `auto mode - will auto-generate round ${roundStatus.next_round_number} from checked-in players`;
        } else {
            detail.textContent = `stage round ${roundStatus.next_round_number} below first`;
        }
        btn.textContent = `Start round ${roundStatus.next_round_number}`;
        btn.disabled = !canStart;
        btn.onclick = () => runRoundAction(() => api(`/api/sessions/${openSession.id}/rounds/start-next`, { method: 'POST' }));
    }
}

async function runRoundAction(fn) {
    try {
        await fn();
        await refreshAll();
    } catch (err) {
        showError(err.message);
    }
}

// --- Currently on court ---
async function loadActiveGames() {
    const panel = $('#active-games-panel');
    if (roundStatus.current_phase !== 'game') {
        panel.style.display = 'none';
        return;
    }
    const games = await api(`/api/sessions/${openSession.id}/games?status=active`);
    panel.style.display = 'block';
    $('#active-round-number').textContent = roundStatus.current_round;
    $('#active-games-grid').innerHTML = games.map((g) => `
        <div class="active-game-card">
            <h4>Court ${courtNumberFor(g.court_id)} <span class="muted">(${g.format})</span></h4>
            <div class="side-line"><strong>1:</strong> ${g.players.filter((p) => p.side === 1).map((p) => `${p.first_name} ${p.last_name}${skillBadge(p.skill_level_at_time)}`).join(', ')}</div>
            <div class="side-line"><strong>2:</strong> ${g.players.filter((p) => p.side === 2).map((p) => `${p.first_name} ${p.last_name}${skillBadge(p.skill_level_at_time)}`).join(', ')}</div>
        </div>
    `).join('') || '<p class="muted">No active games.</p>';
}

// --- Attendance pool ---
async function loadAttendancePool() {
    const attendance = await api(`/api/sessions/${openSession.id}/attendance`);
    attendancePool = attendance.filter((a) => a.state === 'here_today' || a.state === 'playing');
}

// --- Builder ---
async function loadBuilderForRound(round) {
    buildRound = round;
    $('#build-round-number').textContent = buildRound;
    $('#round-minus').disabled = buildRound <= roundStatus.next_round_number;

    const staged = await api(`/api/sessions/${openSession.id}/games?round_number=${buildRound}&status=staged`);
    buildState = {};
    for (const c of sessionCourts) {
        buildState[c.court_id] = { staged: null, draft: { format: 'doubles', side1: [], side2: [] }, editing: false };
    }
    for (const g of staged) {
        const side1 = g.players.filter((p) => p.side === 1).map((p) => p.player_id);
        const side2 = g.players.filter((p) => p.side === 2).map((p) => p.player_id);
        buildState[g.court_id] = {
            staged: { gameId: g.id, format: g.format, side1, side2 },
            draft: { format: g.format, side1: [...side1], side2: [...side2] },
            editing: false,
        };
    }

    // Who played the immediately preceding round, so the pool can surface
    // players who sat out last round ahead of everyone else (they carry sit-out
    // priority into the next one, per the auto-generate rules) - round_number
    // here is always < next_round_number, so these games are never 'staged'.
    playedPreviousRoundIds = new Set();
    if (buildRound > 1) {
        const previousGames = await api(`/api/sessions/${openSession.id}/games?round_number=${buildRound - 1}`);
        for (const g of previousGames) {
            for (const p of g.players) playedPreviousRoundIds.add(p.player_id);
        }
    }

    renderBuilder();
}

function effectiveIdsFor(courtId) {
    const st = buildState[courtId];
    const source = st.editing || !st.staged ? st.draft : st.staged;
    return [...source.side1, ...source.side2];
}

function allUsedPlayerIds() {
    const used = new Set();
    for (const courtId of Object.keys(buildState)) {
        for (const id of effectiveIdsFor(Number(courtId))) used.add(id);
    }
    return used;
}

function playerLabel(playerId) {
    const a = attendancePool.find((p) => p.player_id === playerId);
    if (!a) return `#${playerId}`;
    return `${a.first_name} ${a.last_name}`;
}

function playerSkill(playerId) {
    const a = attendancePool.find((p) => p.player_id === playerId);
    return a ? a.skill_level : null;
}

function byLastName(a, b) {
    return a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name);
}

function poolPlayerHtml(p) {
    return `
        <div class="pool-player" draggable="true" data-player-id="${p.player_id}">
            ${p.first_name} ${p.last_name}${skillBadge(p.skill_level)} <span class="muted">${p.state === 'playing' ? '(playing now)' : ''}</span>
        </div>
    `;
}

function renderBuilder() {
    const grid = $('#courts-grid');
    grid.innerHTML = sessionCourts.map((c) => renderCourtCard(c)).join('');
    wireCourtCardEvents();

    const used = allUsedPlayerIds();
    const pool = attendancePool.filter((p) => !used.has(p.player_id));
    $('#pool-count').textContent = pool.length;

    const poolEl = $('#player-pool');
    if (pool.length === 0) {
        poolEl.innerHTML = '<p class="muted">No players available to place.</p>';
    } else if (buildRound <= 1) {
        // No previous round exists yet to split against.
        poolEl.innerHTML = pool.slice().sort(byLastName).map(poolPlayerHtml).join('');
    } else {
        const readyToPlay = pool.filter((p) => !playedPreviousRoundIds.has(p.player_id)).sort(byLastName);
        const restedLastGame = pool.filter((p) => playedPreviousRoundIds.has(p.player_id)).sort(byLastName);
        poolEl.innerHTML = [
            readyToPlay.length ? `<div class="pool-section-label">Ready to play (${readyToPlay.length})</div>${readyToPlay.map(poolPlayerHtml).join('')}` : '',
            restedLastGame.length ? `<div class="pool-section-label">Rested last game (${restedLastGame.length})</div>${restedLastGame.map(poolPlayerHtml).join('')}` : '',
        ].join('');
    }

    poolEl.querySelectorAll('.pool-player').forEach((el) => {
        el.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', el.dataset.playerId);
        });
    });
}

function renderCourtCard(court) {
    const st = buildState[court.court_id];
    const isReadOnly = st.staged && !st.editing;
    const state = isReadOnly ? st.staged : st.draft;
    const perSide = FORMAT_SIZES[state.format] / 2;

    const sideHtml = (sideNum) => {
        const ids = sideNum === 1 ? state.side1 : state.side2;
        const slots = [];
        for (let i = 0; i < perSide; i++) {
            const playerId = ids[i];
            if (playerId !== undefined) {
                slots.push(`
                    <div class="slot filled">
                        <span>${playerLabel(playerId)}${skillBadge(playerSkill(playerId))}</span>
                        ${isReadOnly ? '' : `<span class="remove-slot" data-court="${court.court_id}" data-side="${sideNum}" data-player="${playerId}">&times;</span>`}
                    </div>
                `);
            } else {
                slots.push('<div class="slot empty">Drop here</div>');
            }
        }
        return `
            <div class="side-box" data-court="${court.court_id}" data-side="${sideNum}">
                <div class="side-label">Side ${sideNum}</div>
                ${slots.join('')}
            </div>
        `;
    };

    const full = state.side1.length === perSide && state.side2.length === perSide;

    let actions;
    if (isReadOnly) {
        actions = `
            <button class="small" data-action="edit" data-court="${court.court_id}">Edit</button>
            <button class="small" data-action="unstage" data-court="${court.court_id}">Unstage</button>
        `;
    } else if (st.staged) {
        actions = `
            <button class="small" data-action="cancel" data-court="${court.court_id}">Cancel</button>
            <button class="small primary" data-action="save" data-court="${court.court_id}" ${full ? '' : 'disabled'}>Save</button>
        `;
    } else {
        actions = `
            <button class="small" data-action="clear" data-court="${court.court_id}">Clear</button>
            <button class="small primary" data-action="save" data-court="${court.court_id}" ${full ? '' : 'disabled'}>Save</button>
        `;
    }

    return `
        <div class="court-card ${isReadOnly ? 'staged' : ''}">
            <div class="court-card-header">
                <strong>Court ${court.court_number}</strong>
                ${isReadOnly
                    ? `<span class="muted">${state.format} - staged</span>`
                    : `<select data-action="format" data-court="${court.court_id}" ${st.staged ? '' : ''}>
                        <option value="doubles" ${state.format === 'doubles' ? 'selected' : ''}>Doubles</option>
                        <option value="singles" ${state.format === 'singles' ? 'selected' : ''}>Singles</option>
                    </select>`
                }
            </div>
            <div class="sides">${sideHtml(1)}${sideHtml(2)}</div>
            <div class="court-actions">${actions}</div>
        </div>
    `;
}

function wireCourtCardEvents() {
    document.querySelectorAll('.side-box').forEach((box) => {
        box.addEventListener('dragover', (e) => {
            e.preventDefault();
            box.classList.add('drag-over');
        });
        box.addEventListener('dragleave', () => box.classList.remove('drag-over'));
        box.addEventListener('drop', (e) => {
            e.preventDefault();
            box.classList.remove('drag-over');
            const playerId = Number(e.dataTransfer.getData('text/plain'));
            const courtId = Number(box.dataset.court);
            const side = Number(box.dataset.side);
            dropPlayer(courtId, side, playerId);
        });
    });

    document.querySelectorAll('.remove-slot').forEach((el) => {
        el.addEventListener('click', () => {
            const courtId = Number(el.dataset.court);
            const side = Number(el.dataset.side);
            const playerId = Number(el.dataset.player);
            const st = buildState[courtId];
            const key = side === 1 ? 'side1' : 'side2';
            st.draft[key] = st.draft[key].filter((id) => id !== playerId);
            renderBuilder();
        });
    });

    document.querySelectorAll('select[data-action="format"]').forEach((sel) => {
        sel.addEventListener('change', () => {
            const courtId = Number(sel.dataset.court);
            const st = buildState[courtId];
            st.draft.format = sel.value;
            const perSide = FORMAT_SIZES[sel.value] / 2;
            st.draft.side1 = st.draft.side1.slice(0, perSide);
            st.draft.side2 = st.draft.side2.slice(0, perSide);
            renderBuilder();
        });
    });

    document.querySelectorAll('button[data-action]').forEach((btn) => {
        const courtId = Number(btn.dataset.court);
        const action = btn.dataset.action;
        btn.addEventListener('click', () => {
            if (action === 'edit') return editCourt(courtId);
            if (action === 'unstage') return unstageCourt(courtId);
            if (action === 'cancel') return cancelEditCourt(courtId);
            if (action === 'clear') return clearCourt(courtId);
            if (action === 'save') return saveCourt(courtId);
        });
    });
}

function dropPlayer(courtId, side, playerId) {
    const st = buildState[courtId];
    if (st.staged && !st.editing) return; // read-only until Edit is clicked
    const key = side === 1 ? 'side1' : 'side2';
    const perSide = FORMAT_SIZES[st.draft.format] / 2;
    if (st.draft[key].length >= perSide) return;
    if (st.draft.side1.includes(playerId) || st.draft.side2.includes(playerId)) return;
    st.draft[key] = [...st.draft[key], playerId];
    renderBuilder();
}

function editCourt(courtId) {
    const st = buildState[courtId];
    st.draft = { format: st.staged.format, side1: [...st.staged.side1], side2: [...st.staged.side2] };
    st.editing = true;
    renderBuilder();
}

function cancelEditCourt(courtId) {
    const st = buildState[courtId];
    st.editing = false;
    renderBuilder();
}

function clearCourt(courtId) {
    const st = buildState[courtId];
    st.draft.side1 = [];
    st.draft.side2 = [];
    renderBuilder();
}

async function unstageCourt(courtId) {
    const st = buildState[courtId];
    try {
        await api(`/api/games/${st.staged.gameId}`, { method: 'DELETE' });
        await loadRoundStatus();
        await loadBuilderForRound(buildRound);
    } catch (err) {
        showError(err.message);
    }
}

async function saveCourt(courtId) {
    const st = buildState[courtId];
    const players = [
        ...st.draft.side1.map((id) => ({ player_id: id, side: 1 })),
        ...st.draft.side2.map((id) => ({ player_id: id, side: 2 })),
    ];
    const payload = { court_id: courtId, round_number: buildRound, format: st.draft.format, players };
    try {
        if (st.staged) {
            await api(`/api/games/${st.staged.gameId}`, { method: 'PUT', body: JSON.stringify(payload) });
        } else {
            await api(`/api/sessions/${openSession.id}/games`, { method: 'POST', body: JSON.stringify(payload) });
        }
        await loadRoundStatus();
        await loadBuilderForRound(buildRound);
    } catch (err) {
        showError(err.message);
    }
}

// --- Auto-generate ---
// Fills any courts still empty in the current build round using the
// auto-generate algorithm (same one auto mode uses at break-end). Courts
// that already have a staged game for this round are left untouched - the
// algorithm only ever proposes games for courts with no game yet this round.
async function autoGenerateBuildRound() {
    const btn = $('#auto-generate-btn');
    btn.disabled = true;
    try {
        const data = await api(`/api/sessions/${openSession.id}/auto-generate/preview?round_number=${buildRound}`);
        if (data.games.length === 0) {
            showError(`Auto-generate couldn't build round ${buildRound}: not enough players present, or no empty courts left.`);
            return;
        }
        const errors = [];
        for (const g of data.games) {
            try {
                await api(`/api/sessions/${openSession.id}/games`, {
                    method: 'POST',
                    body: JSON.stringify({ court_id: g.court_id, round_number: buildRound, format: g.format, players: g.players }),
                });
            } catch (err) {
                errors.push(err.message);
            }
        }
        showError(errors.length ? `Auto-generate staged ${data.games.length - errors.length} of ${data.games.length} courts - ${errors.join('; ')}` : '');
        await loadRoundStatus();
        await loadBuilderForRound(buildRound);
    } catch (err) {
        showError(err.message);
    } finally {
        btn.disabled = false;
    }
}

$('#auto-generate-btn').addEventListener('click', autoGenerateBuildRound);

// --- Round stepper ---
$('#round-minus').addEventListener('click', () => {
    if (buildRound > roundStatus.next_round_number) loadBuilderForRound(buildRound - 1).catch((err) => showError(err.message));
});
$('#round-plus').addEventListener('click', () => {
    loadBuilderForRound(buildRound + 1).catch((err) => showError(err.message));
});

init();
