// Session reporting metrics, derived entirely from attendance/sessions data
// (no new tables). Kept separate from the export route so the peak-concurrent
// calculation - the one non-trivial metric - can be unit-tested in isolation.
const { all } = require('../db/index');

// Peak concurrent on-site headcount for one session: the largest number of
// players simultaneously present. A player is "present" from checked_in_at
// until they leave. Departures only have a timestamp when they moved to
// 'left'; but attendance rows don't store a left_at time, so we approximate:
// a player who is still in checked_in/here_today/playing at export time never
// left, and a player in 'left' state is treated as having left at the last
// game they were in, or - if they never played - as a no-show who was never
// concurrently present. This is the same peak metric the capacity guideline
// and finish-session summary surface.
//
// Because there is no explicit left_at column, we compute peak concurrency
// from a sweep over check-in times only for players who actually stayed
// (state != 'left' with reason no-show), which for the club's purpose (how
// busy did it get) is the meaningful number: everyone who was ever actively
// in the session at once.
function peakConcurrent(db, sessionId) {
    // Treat every attendance row that represents a real presence as an
    // interval [checked_in_at, leftAt]. No-shows never arrived. For players
    // still present (not left) or left without a recorded game, leftAt is the
    // session's last known activity (max phase time / last game) or "infinity"
    // (represented by a far-future sort key) so they count through the peak.
    const rows = all(
        db,
        `SELECT a.player_id, a.checked_in_at, a.state, a.left_reason
         FROM attendance a WHERE a.session_id = ?`,
        [sessionId]
    );

    // Build presence intervals. Arrival = checked_in_at. For departure we use
    // the player's last game end if they left, else a sentinel that keeps them
    // present through every arrival (so ongoing players never cap the peak
    // prematurely).
    const events = []; // { t, delta }
    const FUTURE = '9999-12-31 23:59:59';
    for (const r of rows) {
        if (r.state === 'left' && r.left_reason === 'no-show') continue; // never arrived
        let leaveAt = FUTURE;
        if (r.state === 'left') {
            const lastGame = all(
                db,
                `SELECT MAX(g.created_at) AS t
                 FROM game_players gp JOIN games g ON g.id = gp.game_id
                 WHERE gp.player_id = ? AND g.session_id = ?`,
                [r.player_id, sessionId]
            )[0];
            // If they left after playing, count them present until that game;
            // if they left having never played, count them present only at
            // their arrival instant (departed shortly after) - use checked_in.
            leaveAt = lastGame && lastGame.t ? lastGame.t : r.checked_in_at;
        }
        events.push({ t: r.checked_in_at, delta: 1 });
        events.push({ t: leaveAt, delta: -1 });
    }

    // Sweep: sort by time; at equal timestamps process arrivals (+1) before
    // departures (-1) so a leave-and-arrive at the same instant still counts
    // the overlap - the conservative "how busy" reading.
    events.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : b.delta - a.delta));
    let current = 0;
    let peak = 0;
    for (const e of events) {
        current += e.delta;
        if (current > peak) peak = current;
    }
    return peak;
}

// One report row per session in the date range.
function sessionReportRows(db, from, to) {
    const params = [];
    let dateFilter = '';
    if (from) { dateFilter += ' AND s.date >= ?'; params.push(from); }
    if (to) { dateFilter += ' AND s.date <= ?'; params.push(to); }

    const sessions = all(
        db,
        `SELECT s.id, s.date, s.label, s.mode, s.status FROM sessions s
         WHERE 1=1${dateFilter} ORDER BY s.date ASC, s.id ASC`,
        params
    );

    return sessions.map((s) => {
        const unique = all(
            db,
            `SELECT COUNT(DISTINCT player_id) AS n FROM attendance
             WHERE session_id = ? AND NOT (state = 'left' AND left_reason = 'no-show')`,
            [s.id]
        )[0].n;

        const byStatus = all(
            db,
            `SELECT p.membership_status AS status, COUNT(DISTINCT a.player_id) AS n
             FROM attendance a JOIN players p ON p.id = a.player_id
             WHERE a.session_id = ? AND NOT (a.state = 'left' AND a.left_reason = 'no-show')
             GROUP BY p.membership_status`,
            [s.id]
        );
        const statusCounts = { active: 0, lapsed: 0, guest: 0 };
        for (const row of byStatus) statusCounts[row.status] = row.n;

        const rounds = all(
            db,
            `SELECT COUNT(DISTINCT round_number) AS n FROM games
             WHERE session_id = ? AND status IN ('active','completed')`,
            [s.id]
        )[0].n;

        return {
            date: s.date,
            label: s.label || '',
            mode: s.mode,
            status: s.status,
            unique_players: unique,
            peak_concurrent: peakConcurrent(db, s.id),
            rounds_played: rounds,
            active_members: statusCounts.active,
            lapsed_members: statusCounts.lapsed,
            guests: statusCounts.guest,
        };
    });
}

module.exports = { peakConcurrent, sessionReportRows };
