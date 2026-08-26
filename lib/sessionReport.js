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

// Junior/senior split is a single cutoff at 18/19 (the club's own call, not
// a general convention) - everyone with a known date of birth falls into
// exactly one of the two, no separate "adult" bucket. Age is calculated as
// of the session's own date, not today's, so a historical report still
// shows a player's bracket as it was on the night, not as it is now.
function ageCategory(dob, asOfDate) {
    if (!dob) return 'unknown';
    const birth = new Date(dob);
    const asOf = new Date(asOfDate);
    if (isNaN(birth.getTime()) || isNaN(asOf.getTime())) return 'unknown';
    let age = asOf.getFullYear() - birth.getFullYear();
    const hadBirthdayYet = asOf.getMonth() > birth.getMonth()
        || (asOf.getMonth() === birth.getMonth() && asOf.getDate() >= birth.getDate());
    if (!hadBirthdayYet) age--;
    return age <= 18 ? 'junior' : 'senior';
}

// Players who actually played (were in game_players for an active/completed
// game), not just checked in - a no-show or a "checked in then left before
// their first game" never appears here, matching what "X players, Y of them
// grade A, Z women played" means to a club reporting on the night's
// turnout. Payment, by contrast, is a check-in-time event independent of
// whether they went on to play, so it's counted separately below over all
// of attendance, not just this played set.
function playedDemographics(db, sessionId, sessionDate) {
    const played = all(
        db,
        `SELECT gp.player_id, MAX(gp.skill_level_at_time) AS skill_level_at_time, p.gender, p.dob
         FROM game_players gp
         JOIN games g ON g.id = gp.game_id
         JOIN players p ON p.id = gp.player_id
         WHERE g.session_id = ? AND g.status IN ('active','completed')
         GROUP BY gp.player_id`,
        [sessionId]
    );

    const gradeCounts = { A: 0, B: 0, C: 0, D: 0, E: 0 };
    const genderCounts = { M: 0, F: 0, unknown: 0 };
    const ageCounts = { junior: 0, senior: 0, unknown: 0 };
    for (const row of played) {
        gradeCounts[row.skill_level_at_time]++;
        genderCounts[row.gender === 'M' || row.gender === 'F' ? row.gender : 'unknown']++;
        ageCounts[ageCategory(row.dob, sessionDate)]++;
    }
    return { players_played: played.length, grade_counts: gradeCounts, gender_counts: genderCounts, age_counts: ageCounts };
}

// Category breakdown (what TYPE of player - Member/Non-Member/Concession/
// etc.) + total funds for the session - every attendance row with a
// payment recorded, regardless of whether that player went on to play (see
// playedDemographics above for why the split differs).
function paymentBreakdown(db, sessionId) {
    const rows = all(
        db,
        `SELECT pc.name AS category, COUNT(*) AS count, COALESCE(SUM(a.payment_amount_cents), 0) AS amount_cents
         FROM attendance a JOIN payment_categories pc ON pc.id = a.payment_category_id
         WHERE a.session_id = ? AND a.payment_category_id IS NOT NULL
         GROUP BY pc.name ORDER BY pc.name`,
        [sessionId]
    );
    const total_funds_cents = rows.reduce((sum, r) => sum + r.amount_cents, 0);

    // Separately, HOW they paid (Cash/Card/Voucher) - a different dimension
    // that follows whichever category was picked, not a category itself.
    // Only rows where it was actually recorded (it's optional - e.g. a
    // Sports Voucher redemption has no cash/card method at all).
    const payment_method_breakdown = all(
        db,
        `SELECT a.payment_method AS method, COUNT(*) AS count, COALESCE(SUM(a.payment_amount_cents), 0) AS amount_cents
         FROM attendance a
         WHERE a.session_id = ? AND a.payment_method IS NOT NULL
         GROUP BY a.payment_method ORDER BY a.payment_method`,
        [sessionId]
    );

    return { payment_breakdown: rows, payment_method_breakdown, total_funds_cents };
}

// Checked in and stayed (excludes no-shows) - the "how many players tonight"
// number used both in the full report and the quick tonight-only summary.
function uniquePlayerCount(db, sessionId) {
    return all(
        db,
        `SELECT COUNT(DISTINCT player_id) AS n FROM attendance
         WHERE session_id = ? AND NOT (state = 'left' AND left_reason = 'no-show')`,
        [sessionId]
    )[0].n;
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
        const unique = uniquePlayerCount(db, s.id);

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
            ...playedDemographics(db, s.id, s.date),
            ...paymentBreakdown(db, s.id),
        };
    });
}

module.exports = { peakConcurrent, ageCategory, uniquePlayerCount, paymentBreakdown, sessionReportRows };
