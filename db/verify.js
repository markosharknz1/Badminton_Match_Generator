const { openDb, all, get } = require('./index');

function section(title) {
    console.log(`\n=== ${title} ===`);
}

async function main() {
    const db = await openDb();

    section('club_settings');
    console.log(get(db, 'SELECT * FROM club_settings'));

    section('courts');
    console.table(all(db, 'SELECT * FROM courts ORDER BY court_number'));

    section('session_templates + court counts');
    console.table(all(db, `
        SELECT st.id, st.label, st.day_of_week, st.start_time, st.end_time, st.default_mode,
               st.default_max_capacity, COUNT(stc.court_id) AS num_courts
        FROM session_templates st
        LEFT JOIN session_template_courts stc ON stc.session_template_id = st.id
        GROUP BY st.id
    `));

    section('players (count by skill_level)');
    console.table(all(db, 'SELECT skill_level, COUNT(*) AS n FROM players GROUP BY skill_level ORDER BY skill_level'));

    section('players (count by membership_status)');
    console.table(all(db, 'SELECT membership_status, COUNT(*) AS n FROM players GROUP BY membership_status'));

    section('skill_compatibility matrix (allowed=1 pairs)');
    console.table(all(db, "SELECT skill_a, skill_b FROM skill_compatibility WHERE allowed = 1 ORDER BY skill_a, skill_b"));

    section('open sessions');
    console.table(all(db, "SELECT id, date, label, status, mode, current_phase, max_capacity FROM sessions WHERE status = 'open'"));

    section('session_courts for open session');
    console.table(all(db, `
        SELECT sc.session_id, c.court_number, sc.in_use
        FROM session_courts sc JOIN courts c ON c.id = sc.court_id
        WHERE sc.session_id = (SELECT id FROM sessions WHERE status = 'open' LIMIT 1)
        ORDER BY c.court_number
    `));

    section('attendance breakdown for open session');
    console.table(all(db, `
        SELECT state, COUNT(*) AS n
        FROM attendance
        WHERE session_id = (SELECT id FROM sessions WHERE status = 'open' LIMIT 1)
        GROUP BY state
    `));

    section('here_today pool (waiting list)');
    console.table(all(db, `
        SELECT p.id, p.first_name, p.last_name, p.skill_level, p.gender
        FROM attendance a JOIN players p ON p.id = a.player_id
        WHERE a.session_id = (SELECT id FROM sessions WHERE status = 'open' LIMIT 1)
          AND a.state = 'here_today'
        ORDER BY p.last_name
    `));

    section('games + game_players for open session (round history)');
    console.table(all(db, `
        SELECT g.id AS game_id, g.round_number, g.court_id, g.format, g.status,
               p.first_name || ' ' || p.last_name AS player, gp.side, gp.skill_level_at_time
        FROM games g
        JOIN game_players gp ON gp.game_id = g.id
        JOIN players p ON p.id = gp.player_id
        WHERE g.session_id = (SELECT id FROM sessions WHERE status = 'open' LIMIT 1)
        ORDER BY g.round_number, g.court_id, gp.side
    `));

    section('pairing_rules');
    console.table(all(db, `
        SELECT pr.rule_type, pr.scope,
               pa.first_name || ' ' || pa.last_name AS player_a,
               pb.first_name || ' ' || pb.last_name AS player_b
        FROM pairing_rules pr
        JOIN players pa ON pa.id = pr.player_a_id
        JOIN players pb ON pb.id = pr.player_b_id
    `));

    section('sanity checks');
    const checks = [
        ['players total', 'SELECT COUNT(*) AS n FROM players'],
        ['courts total', 'SELECT COUNT(*) AS n FROM courts'],
        ['session_templates total', 'SELECT COUNT(*) AS n FROM session_templates'],
        ['open sessions (expect 1)', "SELECT COUNT(*) AS n FROM sessions WHERE status = 'open'"],
        ['attendance rows with no matching session (expect 0)',
            'SELECT COUNT(*) AS n FROM attendance a LEFT JOIN sessions s ON s.id = a.session_id WHERE s.id IS NULL'],
        ['game_players rows with no matching game (expect 0)',
            'SELECT COUNT(*) AS n FROM game_players gp LEFT JOIN games g ON g.id = gp.game_id WHERE g.id IS NULL'],
        ['games with player count != 4 for doubles (expect 0)', `
            SELECT COUNT(*) AS n FROM (
                SELECT g.id, COUNT(gp.player_id) AS cnt
                FROM games g JOIN game_players gp ON gp.game_id = g.id
                WHERE g.format = 'doubles'
                GROUP BY g.id
                HAVING cnt != 4
            )`],
    ];
    for (const [label, sql] of checks) {
        const row = get(db, sql);
        console.log(`${label}: ${row.n}`);
    }

    db.close();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
