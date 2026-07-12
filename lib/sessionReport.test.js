// Isolated tests for the session report metrics (especially peak_concurrent)
// against a throwaway in-memory db. Run: node lib/sessionReport.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const { peakConcurrent, sessionReportRows } = require('./sessionReport');

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

function addPlayer(db, id, status = 'active') {
    db.run(`INSERT INTO players (id, first_name, last_name, skill_level, membership_status) VALUES (?, ?, 'X', 'C', ?)`, [id, `P${id}`, status]);
}
function checkIn(db, playerId, at, state = 'here_today', leftReason = null) {
    db.run(`INSERT INTO attendance (session_id, player_id, checked_in_at, state, left_reason) VALUES (1, ?, ?, ?, ?)`, [playerId, at, state, leftReason]);
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

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
