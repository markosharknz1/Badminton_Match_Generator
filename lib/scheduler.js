// Server-side scheduler: the process that makes unattended rotation actually
// happen. Polls the one open session (single-session-at-a-time, per spec) and
// drives phase transitions when phase_ends_at has passed. Must run inside
// this Node process - client-side JS in a browser tab cannot be relied on to
// keep timers running when no tab is open.
const store = require('../db/store');
const lifecycle = require('./roundLifecycle');
const { broadcast } = require('./eventBus');

const CHECK_INTERVAL_MS = 5000;
let intervalHandle = null;

function parseUtc(dtStr) {
    // Stored as 'YYYY-MM-DD HH:MM:SS' (matches SQLite's datetime('now'), UTC).
    return new Date(`${dtStr.replace(' ', 'T')}Z`).getTime();
}

function todayUtc() {
    return new Date().toISOString().slice(0, 10);
}

function tick() {
    let session;
    try {
        session = store.queryOne(`SELECT * FROM sessions WHERE status = 'open' LIMIT 1`);
    } catch (err) {
        console.error('[scheduler] failed to read open session:', err);
        return;
    }
    if (!session) return;

    // Same cleanup db/index.js's closeStaleOpenSessions does on boot, but
    // live - covers the computer being left on through midnight instead of
    // shut down, where nothing ever restarts to trigger the boot-time check.
    // Closing here (rather than waiting for someone to open a browser tab)
    // means tomorrow's "Start session" is never blocked by tonight's session
    // still technically being open.
    if (session.date < todayUtc()) {
        console.log(`[scheduler] session ${session.id} (${session.date}) is stale - auto-closing`);
        store.run(`UPDATE sessions SET status = 'closed' WHERE id = ?`, [session.id]);
        store.persist();
        broadcast('session', { session_id: session.id });
        return;
    }

    if (!session.phase_ends_at) return;

    const msRemaining = parseUtc(session.phase_ends_at) - Date.now();
    if (msRemaining > 0) {
        // Not expired yet - the only other thing a tick can do is get the
        // next round ready early (auto mode's external-display fix, see
        // lib/roundLifecycle.js's preGenerateNextRound doc comment).
        if (session.current_phase === 'game' && msRemaining <= lifecycle.PRE_GENERATE_WINDOW_MS) {
            try {
                lifecycle.preGenerateNextRound(session.id);
            } catch (err) {
                console.error(`[scheduler] pre-generate failed for session ${session.id}:`, err);
            }
        }
        return;
    }

    try {
        if (session.current_phase === 'game') {
            console.log(`[scheduler] game timer expired for session ${session.id} - ending round`);
            lifecycle.endGamePhase(session.id);
        } else if (session.current_phase === 'break') {
            console.log(`[scheduler] break timer expired for session ${session.id} - ending break`);
            lifecycle.endBreakPhase(session.id);
        }
        // idle/awaiting_lineup have no timer running (phase_ends_at is null), so nothing to do there.
    } catch (err) {
        // A silent failure here means a stuck timer nobody notices - this must
        // be loud: logged clearly and pushed to any connected screen.
        console.error(`[scheduler] FAILED to transition session ${session.id} out of phase "${session.current_phase}":`, err);
        broadcast('scheduler_error', { session_id: session.id, message: err.message });
    }
}

function start() {
    if (intervalHandle) return;
    intervalHandle = setInterval(tick, CHECK_INTERVAL_MS);
    console.log(`[scheduler] started (checking every ${CHECK_INTERVAL_MS / 1000}s)`);
}

function stop() {
    if (intervalHandle) clearInterval(intervalHandle);
    intervalHandle = null;
}

module.exports = { start, stop, tick };
