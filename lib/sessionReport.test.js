// Isolated tests for the session report metrics (especially peak_concurrent)
// against a throwaway in-memory db. Run: node lib/sessionReport.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const { peakConcurrent, ageCategory, sessionReportRows } = require('./sessionReport');

let SQL;
let passed = 0;
let failed = 0;

async function freshDb() {
    if (!SQL) SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8'));
    db.run(`INSERT INTO sessions (id, date, label, status, mode, current_phase) VALUES (1, '2026-07-01', 'Test', 'closed', 'manual', 'idle')`);
    return db;
}

async function test(name, fn) {
    try {
        const db = await freshDb();
        await fn(db);
        passed++;
        console.log(`  PASS  ${name}`);
    } catch (err) {
        failed++;
        console.log(`  FAIL  ${name}`);
        console.log(`        ${err.stack || err.message}`);
    }
}

function addPlayer(db, id, status = 'active', extra = {}) {
    const { skill = 'C', gender = null, dob = null } = extra;
    db.run(
        `INSERT INTO players (id, first_name, last_name, skill_level, membership_status, gender, dob) VALUES (?, ?, 'X', ?, ?, ?, ?)`,
        [id, `P${id}`, skill, status, gender, dob]
    );
}
function checkIn(db, playerId, at, state = 'here_today', leftReason = null) {
    db.run(`INSERT INTO attendance (session_id, player_id, checked_in_at, state, left_reason) VALUES (1, ?, ?, ?, ?)`, [playerId, at, state, leftReason]);
}
function pay(db, playerId, categoryId, amountCents, method = null) {
    db.run(
        `UPDATE attendance SET payment_category_id = ?, payment_amount_cents = ?, payment_method = ? WHERE session_id = 1 AND player_id = ?`,
        [categoryId, amountCents, method, playerId]
    );
}
let nextGameId = 1000;
function playGame(db, sessionId, playerIds, skill = 'C', status = 'completed') {
    const gameId = nextGameId++;
    const courtId = gameId;
    db.run(`INSERT INTO courts (id, court_number, is_active) VALUES (?, ?, 1)`, [courtId, (gameId % 32) + 1]);
    db.run(
        `INSERT INTO games (id, session_id, court_id, round_number, format, mode, status) VALUES (?, ?, ?, 1, ?, 'manual', ?)`,
        [gameId, sessionId, courtId, playerIds.length === 2 ? 'singles' : 'doubles', status]
    );
    playerIds.forEach((playerId, i) => {
        db.run(`INSERT INTO game_players (game_id, player_id, side, skill_level_at_time) VALUES (?, ?, ?, ?)`, [gameId, playerId, (i % 2) + 1, skill]);
    });
}

async function main() {
    console.log('\n=== peakConcurrent ===');

    await test('nobody checked in -> 0', async (db) => {
        assert.strictEqual(peakConcurrent(db, 1), 0);
    });

    await test('everyone still present -> peak equals headcount', async (db) => {
        for (let i = 1; i <= 5; i++) { addPlayer(db, i); checkIn(db, i, `2026-07-01 19:0${i}:00`); }
        assert.strictEqual(peakConcurrent(db, 1), 5);
    });

    await test('no-shows never count toward peak', async (db) => {
        addPlayer(db, 1); checkIn(db, 1, '2026-07-01 19:00:00');
        addPlayer(db, 2); checkIn(db, 2, '2026-07-01 19:00:00', 'left', 'no-show');
        addPlayer(db, 3); checkIn(db, 3, '2026-07-01 19:05:00');
        assert.strictEqual(peakConcurrent(db, 1), 2);
    });

    await test('a player who left before others arrived reduces the peak', async (db) => {
        // Player 1 arrives and leaves having never played (departs at arrival instant).
        addPlayer(db, 1); checkIn(db, 1, '2026-07-01 19:00:00', 'left', 'departed');
        // Players 2 and 3 arrive later and stay.
        addPlayer(db, 2); checkIn(db, 2, '2026-07-01 20:00:00');
        addPlayer(db, 3); checkIn(db, 3, '2026-07-01 20:00:00');
        // Peak should be 2 (players 2+3 overlap), not 3 - player 1 left before them.
        assert.strictEqual(peakConcurrent(db, 1), 2);
    });

    await test('a player who left AFTER playing counts through their last game', async (db) => {
        addPlayer(db, 1); checkIn(db, 1, '2026-07-01 19:00:00', 'left', 'departed');
        addPlayer(db, 2); checkIn(db, 2, '2026-07-01 19:00:00');
        // Player 1 played a game created at 19:30, so is present until then.
        db.run(`INSERT INTO courts (id, court_number, is_active) VALUES (1, 1, 1)`);
        db.run(`INSERT INTO games (id, session_id, court_id, round_number, format, mode, status, created_at) VALUES (1, 1, 1, 1, 'singles', 'manual', 'completed', '2026-07-01 19:30:00')`);
        db.run(`INSERT INTO game_players (game_id, player_id, side, skill_level_at_time) VALUES (1, 1, 1, 'C')`);
        // Player 3 arrives at 19:15, before player 1's game - all three overlap.
        addPlayer(db, 3); checkIn(db, 3, '2026-07-01 19:15:00');
        assert.strictEqual(peakConcurrent(db, 1), 3);
    });

    console.log('\n=== sessionReportRows ===');

    await test('one session row with correct membership breakdown', async (db) => {
        addPlayer(db, 1, 'active'); checkIn(db, 1, '2026-07-01 19:00:00');
        addPlayer(db, 2, 'active'); checkIn(db, 2, '2026-07-01 19:00:00');
        addPlayer(db, 3, 'lapsed'); checkIn(db, 3, '2026-07-01 19:00:00');
        addPlayer(db, 4, 'guest'); checkIn(db, 4, '2026-07-01 19:00:00');
        addPlayer(db, 5, 'guest'); checkIn(db, 5, '2026-07-01 19:00:00', 'left', 'no-show');
        const rows = sessionReportRows(db, null, null);
        assert.strictEqual(rows.length, 1);
        const r = rows[0];
        assert.strictEqual(r.unique_players, 4, 'no-show excluded from unique count');
        assert.strictEqual(r.active_members, 2);
        assert.strictEqual(r.lapsed_members, 1);
        assert.strictEqual(r.guests, 1, 'no-show guest excluded');
        assert.strictEqual(r.peak_concurrent, 4);
    });

    await test('date range filter excludes out-of-range sessions', async (db) => {
        db.run(`INSERT INTO sessions (id, date, label, status, mode, current_phase) VALUES (2, '2026-08-01', 'Aug', 'closed', 'manual', 'idle')`);
        addPlayer(db, 1); checkIn(db, 1, '2026-07-01 19:00:00');
        const rows = sessionReportRows(db, '2026-07-15', '2026-12-31');
        assert.strictEqual(rows.length, 1);
        assert.strictEqual(rows[0].date, '2026-08-01');
    });

    await test('players_played only counts those who actually played, not everyone checked in', async (db) => {
        addPlayer(db, 1); checkIn(db, 1, '2026-07-01 19:00:00');
        addPlayer(db, 2); checkIn(db, 2, '2026-07-01 19:00:00'); // checked in, never played
        playGame(db, 1, [1, 3, 4, 5]);
        addPlayer(db, 3); checkIn(db, 3, '2026-07-01 19:00:00');
        addPlayer(db, 4); checkIn(db, 4, '2026-07-01 19:00:00');
        addPlayer(db, 5); checkIn(db, 5, '2026-07-01 19:00:00');
        const r = sessionReportRows(db, null, null)[0];
        assert.strictEqual(r.players_played, 4, 'player 2 checked in but never played, excluded');
    });

    await test('a staged (not yet started) game does not count its players as having played', async (db) => {
        addPlayer(db, 1); checkIn(db, 1, '2026-07-01 19:00:00');
        addPlayer(db, 2); checkIn(db, 2, '2026-07-01 19:00:00');
        playGame(db, 1, [1, 2], 'C', 'staged');
        const r = sessionReportRows(db, null, null)[0];
        assert.strictEqual(r.players_played, 0);
    });

    await test('grade counts reflect the grade played that night, not current player record', async (db) => {
        addPlayer(db, 1, 'active', { skill: 'C' }); checkIn(db, 1, '2026-07-01 19:00:00');
        addPlayer(db, 2, 'active', { skill: 'A' }); checkIn(db, 2, '2026-07-01 19:00:00');
        playGame(db, 1, [1, 2], 'B'); // both played at grade B that night, regardless of current skill_level
        const r = sessionReportRows(db, null, null)[0];
        assert.deepStrictEqual(r.grade_counts, { A: 0, B: 2, C: 0, D: 0, E: 0 });
    });

    await test('gender counts split male/female/unknown among players who played', async (db) => {
        addPlayer(db, 1, 'active', { gender: 'M' });
        addPlayer(db, 2, 'active', { gender: 'F' });
        addPlayer(db, 3, 'active', { gender: 'F' });
        addPlayer(db, 4, 'active', { gender: null });
        [1, 2, 3, 4].forEach((id) => checkIn(db, id, '2026-07-01 19:00:00'));
        playGame(db, 1, [1, 2, 3, 4]);
        const r = sessionReportRows(db, null, null)[0];
        assert.deepStrictEqual(r.gender_counts, { M: 1, F: 2, unknown: 1 });
    });

    await test('age counts split junior (<=18) / senior (>=19) / unknown, as of the session date', async (db) => {
        addPlayer(db, 1, 'active', { dob: '2010-01-01' }); // 16 on 2026-07-01 - junior
        addPlayer(db, 2, 'active', { dob: '2008-07-01' }); // exactly 18 on 2026-07-01 (birthday today) - junior
        addPlayer(db, 3, 'active', { dob: '2007-06-30' }); // 19 (birthday was yesterday) - senior
        addPlayer(db, 4, 'active', { dob: null });
        [1, 2, 3, 4].forEach((id) => checkIn(db, id, '2026-07-01 19:00:00'));
        playGame(db, 1, [1, 2, 3, 4]);
        const r = sessionReportRows(db, null, null)[0];
        assert.deepStrictEqual(r.age_counts, { junior: 2, senior: 1, unknown: 1 });
    });

    await test('payment breakdown groups by category with count and total funds, over all checked-in players regardless of whether they played', async (db) => {
        db.run(`INSERT INTO payment_categories (id, name) VALUES (1, 'Cash'), (2, 'Card')`);
        addPlayer(db, 1); checkIn(db, 1, '2026-07-01 19:00:00'); pay(db, 1, 1, 1000);
        addPlayer(db, 2); checkIn(db, 2, '2026-07-01 19:00:00'); pay(db, 2, 1, 1000);
        addPlayer(db, 3); checkIn(db, 3, '2026-07-01 19:00:00'); pay(db, 3, 2, 1500);
        addPlayer(db, 4); checkIn(db, 4, '2026-07-01 19:00:00'); // never paid (e.g. waived) - excluded from breakdown
        const r = sessionReportRows(db, null, null)[0];
        assert.deepStrictEqual(r.payment_breakdown, [
            { category: 'Card', count: 1, amount_cents: 1500, methods: [] },
            { category: 'Cash', count: 2, amount_cents: 2000, methods: [] },
        ]);
        assert.strictEqual(r.total_funds_cents, 3500);
    });

    await test('payment method breakdown is a separate dimension from category - how they paid, not what type of player - and nests inside each category row too', async (db) => {
        db.run(`INSERT INTO payment_categories (id, name) VALUES (1, 'Member'), (2, 'Non-Member')`);
        addPlayer(db, 1); checkIn(db, 1, '2026-07-01 19:00:00'); pay(db, 1, 1, 500, 'Cash');
        addPlayer(db, 2); checkIn(db, 2, '2026-07-01 19:00:00'); pay(db, 2, 1, 500, 'Cash');
        addPlayer(db, 3); checkIn(db, 3, '2026-07-01 19:00:00'); pay(db, 3, 2, 1000, 'Card');
        addPlayer(db, 4); checkIn(db, 4, '2026-07-01 19:00:00'); pay(db, 4, 2, 1000, null); // paid but method not recorded
        const r = sessionReportRows(db, null, null)[0];
        assert.deepStrictEqual(r.payment_breakdown, [
            { category: 'Member', count: 2, amount_cents: 1000, methods: [{ method: 'Cash', count: 2, amount_cents: 1000 }] },
            { category: 'Non-Member', count: 2, amount_cents: 2000, methods: [{ method: 'Card', count: 1, amount_cents: 1000 }] },
        ]);
        assert.deepStrictEqual(r.payment_method_breakdown, [
            { method: 'Card', count: 1, amount_cents: 1000 },
            { method: 'Cash', count: 2, amount_cents: 1000 },
        ]);
        assert.strictEqual(r.total_funds_cents, 3000);
    });

    console.log('\n=== ageCategory ===');

    await test('exact junior/senior boundary at 18/19, and unknown for missing dob', async () => {
        assert.strictEqual(ageCategory('2008-07-01', '2026-07-01'), 'junior', 'turns 18 today -> still junior');
        assert.strictEqual(ageCategory('2008-07-02', '2026-07-01'), 'junior', 'turns 18 tomorrow -> 17 today, junior');
        assert.strictEqual(ageCategory('2007-06-30', '2026-07-01'), 'senior', 'turned 19 yesterday -> senior');
        assert.strictEqual(ageCategory(null, '2026-07-01'), 'unknown');
        assert.strictEqual(ageCategory('not-a-date', '2026-07-01'), 'unknown');
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
