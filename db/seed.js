const { openDb, applySchema, saveDb, all } = require('./index');

async function main() {
    const db = await openDb();
    applySchema(db); // idempotent - CREATE TABLE IF NOT EXISTS

    // Wipe existing data so this script is re-runnable during development.
    const tables = [
        'game_players', 'games', 'attendance', 'session_payment_rates', 'session_courts', 'sessions',
        'session_template_payment_rates', 'session_template_courts', 'session_templates', 'pairing_rules',
        'skill_compatibility', 'players', 'courts', 'club_settings', 'payment_categories'
    ];
    for (const t of tables) db.run(`DELETE FROM ${t}`);
    db.run(`DELETE FROM sqlite_sequence WHERE name IN (${tables.map(() => '?').join(',')})`, tables);

    // --- club_settings ---
    db.run(`INSERT INTO club_settings (id, club_name, default_game_minutes, default_break_minutes, max_capacity, square_enabled)
            VALUES (1, 'Riverside Badminton Club', 15, 3, 24, 1)`);

    // --- courts: 7 physical courts, all active ---
    const courtIds = []; // index 0 -> court_number 1, etc. Real row ids, not assumed to equal court_number.
    for (let n = 1; n <= 7; n++) {
        db.run(`INSERT INTO courts (court_number, label, is_active) VALUES (?, NULL, 1)`, [n]);
        courtIds.push(db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0]);
    }

    // --- payment_categories: club-wide editable list, prices set per template below ---
    const categoryNames = ['Member', 'Non-Member', 'Member Concession', 'Non-member Concession', 'Sports Voucher', 'Other'];
    const categoryIds = {};
    categoryNames.forEach((name, i) => {
        db.run(`INSERT INTO payment_categories (name, sort_order) VALUES (?, ?)`, [name, i]);
        categoryIds[name] = db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0];
    });

    // --- skill_compatibility: full symmetric A-E grid, adjacent + same grade allowed ---
    const grades = ['A', 'B', 'C', 'D', 'E'];
    const rank = Object.fromEntries(grades.map((g, i) => [g, i]));
    for (const a of grades) {
        for (const b of grades) {
            const allowed = Math.abs(rank[a] - rank[b]) <= 1 ? 1 : 0;
            db.run(`INSERT INTO skill_compatibility (skill_a, skill_b, allowed) VALUES (?, ?, ?)`, [a, b, allowed]);
        }
    }

    // --- session_templates: Monday evening, Thursday morning, Thursday evening ---
    db.run(`INSERT INTO session_templates (label, day_of_week, start_time, end_time, default_mode, default_max_capacity)
            VALUES ('Monday evening', 'Mon', '19:30', '22:30', 'manual', 50)`);
    const mondayTemplateId = db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0];

    db.run(`INSERT INTO session_templates (label, day_of_week, start_time, end_time, default_mode, default_max_capacity)
            VALUES ('Thursday morning', 'Thu', '09:30', '11:30', 'auto', NULL)`);
    const thuMorningId = db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0];

    db.run(`INSERT INTO session_templates (label, day_of_week, start_time, end_time, default_mode, default_max_capacity)
            VALUES ('Thursday evening', 'Thu', '19:30', '21:30', 'manual', NULL)`);
    const thuEveningId = db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0];

    // Monday evening + Thursday morning use all 7 courts; Thursday evening uses 6 of 7.
    courtIds.forEach((courtId, i) => {
        db.run(`INSERT INTO session_template_courts (session_template_id, court_id) VALUES (?, ?)`, [mondayTemplateId, courtId]);
        db.run(`INSERT INTO session_template_courts (session_template_id, court_id) VALUES (?, ?)`, [thuMorningId, courtId]);
        if (i !== 6) { // court_number 7 (index 6) sits out of Thursday evening
            db.run(`INSERT INTO session_template_courts (session_template_id, court_id) VALUES (?, ?)`, [thuEveningId, courtId]);
        }
    });

    // --- Friday social: third mode, no rounds - just check-in + payment ---
    db.run(`INSERT INTO session_templates (label, day_of_week, start_time, end_time, default_mode, default_max_capacity)
            VALUES ('Friday social', 'Fri', '19:00', '21:30', 'social', NULL)`);
    const fridaySocialId = db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0];
    courtIds.forEach((courtId) => {
        db.run(`INSERT INTO session_template_courts (session_template_id, court_id) VALUES (?, ?)`, [fridaySocialId, courtId]);
    });

    // --- session_template_payment_rates: prices (cents) per template ---
    const templateRates = {
        [mondayTemplateId]: { Member: 500, 'Non-Member': 1000, 'Member Concession': 300, 'Non-member Concession': 700, 'Sports Voucher': 0, Other: 0 },
        [thuMorningId]: { Member: 500, 'Non-Member': 1000, 'Member Concession': 300, 'Non-member Concession': 700, 'Sports Voucher': 0, Other: 0 },
        [thuEveningId]: { Member: 500, 'Non-Member': 1000, 'Member Concession': 300, 'Non-member Concession': 700, 'Sports Voucher': 0, Other: 0 },
        [fridaySocialId]: { Member: 300, 'Non-Member': 600, 'Member Concession': 200, 'Non-member Concession': 400, 'Sports Voucher': 0, Other: 0 },
    };
    for (const [templateId, rates] of Object.entries(templateRates)) {
        for (const [name, cents] of Object.entries(rates)) {
            db.run(`INSERT INTO session_template_payment_rates (session_template_id, payment_category_id, amount_cents) VALUES (?, ?, ?)`,
                [templateId, categoryIds[name], cents]);
        }
    }

    // --- players: a spread of skill levels, genders, membership statuses ---
    const firstNames = ['Alex', 'Bailey', 'Casey', 'Drew', 'Emerson', 'Frankie', 'Gray', 'Harper',
        'Indigo', 'Jules', 'Kai', 'Logan', 'Morgan', 'Noor', 'Ollie', 'Parker',
        'Quinn', 'Riley', 'Sam', 'Toni', 'Uma', 'Val', 'Wren', 'Xu'];
    const lastNames = ['Nguyen', 'Smith', 'Patel', 'Kim', 'Garcia', 'Chen', 'Brown', 'Singh',
        'Wilson', 'Lee', 'Walker', 'Hall', 'Young', 'King', 'Wright', 'Lopez'];
    const skillCycle = ['A', 'B', 'B', 'C', 'C', 'C', 'D', 'D', 'E'];
    const genderCycle = ['M', 'F', 'M', 'F'];
    const statusCycle = ['active', 'active', 'active', 'lapsed', 'guest'];

    const playerIds = [];
    for (let i = 0; i < firstNames.length; i++) {
        const first = firstNames[i];
        const last = lastNames[i % lastNames.length];
        const email = `${first.toLowerCase()}.${last.toLowerCase()}@example.com`;
        const skill = skillCycle[i % skillCycle.length];
        const gender = genderCycle[i % genderCycle.length];
        const status = statusCycle[i % statusCycle.length];
        db.run(`INSERT INTO players
                (first_name, last_name, email, phone, dob, skill_level, gender, membership_status, membership_number, emergency_contact_name, emergency_contact_phone, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [first, last, email, `021${(1000000 + i * 37).toString().slice(-7)}`, `199${i % 9}-0${(i % 9) + 1}-1${i % 2}`,
                skill, gender, status, status === 'guest' ? null : `MEM${1000 + i}`,
                `${last} Emergency Contact`, `022${(2000000 + i * 41).toString().slice(-7)}`, null]);
        const id = db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0];
        playerIds.push(id);
    }

    // --- an open session for tonight (Monday evening template), manual mode ---
    const today = new Date().toISOString().slice(0, 10);
    db.run(`INSERT INTO sessions
            (template_id, date, label, scheduled_start_time, scheduled_end_time, location, status, mode, game_minutes, break_minutes, max_capacity, current_phase)
            VALUES (?, ?, ?, ?, ?, ?, 'open', 'manual', NULL, NULL, ?, 'idle')`,
        [mondayTemplateId, today, 'Monday evening', '19:30', '22:30', 'Riverside Sports Centre', 50]);
    const sessionId = db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0];

    for (const courtId of courtIds) {
        db.run(`INSERT INTO session_courts (session_id, court_id, in_use) VALUES (?, ?, 1)`, [sessionId, courtId]);
    }
    for (const [name, cents] of Object.entries(templateRates[mondayTemplateId])) {
        db.run(`INSERT INTO session_payment_rates (session_id, payment_category_id, amount_cents) VALUES (?, ?, ?)`,
            [sessionId, categoryIds[name], cents]);
    }

    // --- attendance: first 16 players checked in and moved to here_today ---
    const checkedInIds = playerIds.slice(0, 16);
    for (const pid of checkedInIds) {
        db.run(`INSERT INTO attendance (session_id, player_id, state) VALUES (?, ?, 'here_today')`, [sessionId, pid]);
    }
    // one player already left as a no-show record for realism
    db.run(`INSERT INTO attendance (session_id, player_id, state, left_reason) VALUES (?, ?, 'left', 'no-show')`, [sessionId, playerIds[20]]);

    // --- sample payment records for realism: a couple of paid entries, one comp entry, one first-timer ---
    db.run(`UPDATE attendance SET payment_category_id=?, payment_amount_cents=? WHERE session_id=? AND player_id=?`,
        [categoryIds.Member, 500, sessionId, checkedInIds[4]]);
    db.run(`UPDATE attendance SET payment_category_id=?, payment_amount_cents=? WHERE session_id=? AND player_id=?`,
        [categoryIds['Non-Member'], 1000, sessionId, checkedInIds[5]]);
    db.run(`UPDATE attendance SET payment_category_id=?, payment_amount_cents=?, payment_note=? WHERE session_id=? AND player_id=?`,
        [categoryIds.Other, 0, 'Coach - playing', sessionId, checkedInIds[6]]);
    db.run(`UPDATE attendance SET payment_category_id=?, payment_amount_cents=?, first_time=1 WHERE session_id=? AND player_id=?`,
        [categoryIds['Non-Member'], 1000, sessionId, checkedInIds[7]]);

    // --- a completed round 1 doubles game on court 1, using 4 of the checked-in players ---
    const roundOnePlayers = checkedInIds.slice(0, 4);
    db.run(`INSERT INTO games (session_id, court_id, round_number, format, mode, status) VALUES (?, ?, 1, 'doubles', 'manual', 'completed')`, [sessionId, courtIds[0]]);
    const gameId = db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0];
    const sides = [1, 1, 2, 2];
    for (let i = 0; i < roundOnePlayers.length; i++) {
        const player = all(db, 'SELECT skill_level FROM players WHERE id = ?', [roundOnePlayers[i]])[0];
        db.run(`INSERT INTO game_players (game_id, player_id, side, skill_level_at_time) VALUES (?, ?, ?, ?)`,
            [gameId, roundOnePlayers[i], sides[i], player.skill_level]);
    }
    // move those 4 players back to here_today since round 1 is completed and no round 2 exists yet
    for (const pid of roundOnePlayers) {
        db.run(`UPDATE attendance SET state = 'here_today' WHERE session_id = ? AND player_id = ?`, [sessionId, pid]);
    }

    // --- a pairing rule example ---
    db.run(`INSERT INTO pairing_rules (player_a_id, player_b_id, rule_type, scope) VALUES (?, ?, 'avoid', 'permanent')`,
        [playerIds[0], playerIds[1]]);

    saveDb(db);
    db.close();
    console.log(`Seeded: ${playerIds.length} players, 4 session_templates (incl. Friday social), ${categoryNames.length} payment categories, 7 courts, 1 open session (id=${sessionId}), 1 completed game.`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
