// Isolated tests for the auto-generate algorithm against a throwaway
// in-memory database - no shared state with the real dev/seed db, so these
// are safe to run any time. Run with: node lib/autoGenerate.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const { generateRound } = require('./autoGenerate');

let SQL;
let passed = 0;
let failed = 0;

async function freshDb() {
    if (!SQL) SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8'));
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
        console.log(`        ${err.message}`);
    }
}

// --- Fixture helpers ---
const SESSION_ID = 1;

function addCourt(db, courtId, courtNumber) {
    db.run('INSERT INTO courts (id, court_number, is_active) VALUES (?, ?, 1)', [courtId, courtNumber]);
    db.run('INSERT INTO session_courts (session_id, court_id, in_use) VALUES (?, ?, 1)', [SESSION_ID, courtId]);
}

function addPlayer(db, id, skill, gender = 'M') {
    db.run(
        `INSERT INTO players (id, first_name, last_name, skill_level, gender, membership_status) VALUES (?, ?, ?, ?, ?, 'active')`,
        [id, `P${id}`, 'Test', skill, gender]
    );
    db.run(`INSERT INTO attendance (session_id, player_id, state) VALUES (?, ?, 'here_today')`, [SESSION_ID, id]);
}

function addPastGame(db, gameId, courtId, roundNumber, sides) {
    // sides: [[player_id, side], ...]
    db.run(
        `INSERT INTO games (id, session_id, court_id, round_number, format, mode, status) VALUES (?, ?, ?, ?, 'doubles', 'auto', 'completed')`,
        [gameId, SESSION_ID, courtId, roundNumber]
    );
    for (const [playerId, side] of sides) {
        db.run(
            `INSERT INTO game_players (game_id, player_id, side, skill_level_at_time) VALUES (?, ?, ?, 'C')`,
            [gameId, playerId, side]
        );
    }
}

function addStagedGame(db, gameId, courtId, roundNumber, sides) {
    // sides: [[player_id, side], ...] - status 'staged', for the same-round
    // partial-build scenario (staging doesn't move attendance.state).
    db.run(
        `INSERT INTO games (id, session_id, court_id, round_number, format, mode, status) VALUES (?, ?, ?, ?, 'doubles', 'manual', 'staged')`,
        [gameId, SESSION_ID, courtId, roundNumber]
    );
    for (const [playerId, side] of sides) {
        db.run(
            `INSERT INTO game_players (game_id, player_id, side, skill_level_at_time) VALUES (?, ?, ?, 'C')`,
            [gameId, playerId, side]
        );
    }
}

function addPairingRule(db, a, b, ruleType) {
    db.run(`INSERT INTO pairing_rules (player_a_id, player_b_id, rule_type, scope) VALUES (?, ?, ?, 'permanent')`, [a, b, ruleType]);
}

function addCompat(db, a, b, allowed) {
    db.run(`INSERT INTO skill_compatibility (skill_a, skill_b, allowed) VALUES (?, ?, ?)`, [a, b, allowed ? 1 : 0]);
    if (a !== b) db.run(`INSERT INTO skill_compatibility (skill_a, skill_b, allowed) VALUES (?, ?, ?)`, [b, a, allowed ? 1 : 0]);
}

function playersInPlan(plan) {
    return plan.flatMap((g) => g.players.map((p) => p.player_id));
}

async function main() {
    console.log('\n=== Spec-named edge cases ===');

    await test('fewer players than one court needs -> generates nothing', async (db) => {
        for (let c = 1; c <= 7; c++) addCourt(db, c, c);
        for (let p = 1; p <= 3; p++) addPlayer(db, p, 'C');
        const plan = generateRound(db, SESSION_ID, 1);
        assert.deepStrictEqual(plan, []);
    });

    await test('exactly one full court worth, leftovers excluded', async (db) => {
        for (let c = 1; c <= 7; c++) addCourt(db, c, c);
        for (let p = 1; p <= 5; p++) addPlayer(db, p, 'C');
        const plan = generateRound(db, SESSION_ID, 1);
        assert.strictEqual(plan.length, 1);
        assert.strictEqual(plan[0].players.length, 4);
        const used = new Set(playersInPlan(plan));
        assert.strictEqual(used.size, 4, 'exactly 4 of the 5 players should be used, one left over');
    });

    await test('odd number of players fills as many full courts as possible', async (db) => {
        for (let c = 1; c <= 7; c++) addCourt(db, c, c);
        for (let p = 1; p <= 15; p++) addPlayer(db, p, 'C');
        const plan = generateRound(db, SESSION_ID, 1);
        assert.strictEqual(plan.length, 3); // floor(15/4) = 3
        const used = playersInPlan(plan);
        assert.strictEqual(used.length, 12);
        assert.strictEqual(new Set(used).size, 12, 'no player should be double-booked');
    });

    await test('all players at the same skill level does not crash and fills courts', async (db) => {
        for (let c = 1; c <= 7; c++) addCourt(db, c, c);
        for (let p = 1; p <= 8; p++) addPlayer(db, p, 'C');
        const plan = generateRound(db, SESSION_ID, 1);
        assert.strictEqual(plan.length, 2);
        for (const g of plan) {
            assert.strictEqual(g.players.filter((p) => p.side === 1).length, 2);
            assert.strictEqual(g.players.filter((p) => p.side === 2).length, 2);
        }
    });

    await test('no free courts -> generates nothing even with plenty of players', async (db) => {
        addCourt(db, 1, 1);
        for (let p = 1; p <= 8; p++) addPlayer(db, p, 'C');
        // court 1 already has a game this round
        addPastGame(db, 900, 1, 1, [[1, 1], [2, 1], [3, 2], [4, 2]]);
        const plan = generateRound(db, SESSION_ID, 1);
        assert.deepStrictEqual(plan, []);
    });

    await test('players already staged into another court this round are excluded from the pool', async (db) => {
        // Regression: staging doesn't change attendance.state, so a naive
        // pool query (state = 'here_today' only) would happily reuse players
        // already staged elsewhere in this round when filling remaining
        // empty courts - this must never double-book them.
        addCourt(db, 1, 1);
        addCourt(db, 2, 2);
        for (let p = 1; p <= 8; p++) addPlayer(db, p, 'C');
        // Players 1-4 already staged (not played) on court 1 for round 1.
        addStagedGame(db, 901, 1, 1, [[1, 1], [2, 1], [3, 2], [4, 2]]);
        const plan = generateRound(db, SESSION_ID, 1);
        // Only court 2 is free; only players 5-8 remain eligible.
        assert.strictEqual(plan.length, 1);
        assert.strictEqual(plan[0].court_id, 2);
        const used = new Set(playersInPlan(plan));
        for (const p of [1, 2, 3, 4]) assert.ok(!used.has(p), `player ${p} is already staged this round and must not be reused`);
        for (const p of [5, 6, 7, 8]) assert.ok(used.has(p), `player ${p} should be available to fill the remaining court`);
    });

    console.log('\n=== Priority rule 1: avoid pairing (hard) ===');

    await test('avoid-paired players are never placed on the same team', async (db) => {
        addCourt(db, 1, 1);
        addPlayer(db, 1, 'C');
        addPlayer(db, 2, 'C');
        addPlayer(db, 3, 'C');
        addPlayer(db, 4, 'C');
        addPairingRule(db, 1, 2, 'avoid');
        const plan = generateRound(db, SESSION_ID, 1);
        assert.strictEqual(plan.length, 1);
        const side1 = plan[0].players.filter((p) => p.side === 1).map((p) => p.player_id);
        const side2 = plan[0].players.filter((p) => p.side === 2).map((p) => p.player_id);
        const sameTeam = (side1.includes(1) && side1.includes(2)) || (side2.includes(1) && side2.includes(2));
        assert.strictEqual(sameTeam, false, 'players 1 and 2 must not be partnered');
    });

    await test('avoid-triangle across one bucket gets repaired via a swap with another bucket', async (db) => {
        addCourt(db, 1, 1);
        addCourt(db, 2, 2);
        // 8 players, skill-sorted into two buckets of 4: [1,2,3,4] and [5,6,7,8]
        for (let p = 1; p <= 8; p++) addPlayer(db, p, 'C');
        // 1,2,3 all mutually avoid each other - any split of a bucket containing all three has a hard violation
        addPairingRule(db, 1, 2, 'avoid');
        addPairingRule(db, 1, 3, 'avoid');
        addPairingRule(db, 2, 3, 'avoid');
        const plan = generateRound(db, SESSION_ID, 1);
        assert.strictEqual(plan.length, 2);
        for (const g of plan) {
            const side1 = g.players.filter((p) => p.side === 1).map((p) => p.player_id);
            const side2 = g.players.filter((p) => p.side === 2).map((p) => p.player_id);
            for (const [a, b] of [[1, 2], [1, 3], [2, 3]]) {
                const sameTeam = (side1.includes(a) && side1.includes(b)) || (side2.includes(a) && side2.includes(b));
                assert.strictEqual(sameTeam, false, `avoid pair ${a}-${b} must not end up partnered after repair`);
            }
        }
    });

    console.log('\n=== Priority rule 2: sat-out-last-round (hard priority for selection) ===');

    await test('players who sat out last round are selected ahead of those who played', async (db) => {
        addCourt(db, 1, 1); // only room for 4 players
        for (let p = 1; p <= 8; p++) addPlayer(db, p, 'C');
        // players 1-4 played round 1; players 5-8 did not (sat out)
        addPastGame(db, 900, 1, 1, [[1, 1], [2, 1], [3, 2], [4, 2]]);
        const plan = generateRound(db, SESSION_ID, 2);
        assert.strictEqual(plan.length, 1);
        const used = new Set(playersInPlan(plan));
        for (const p of [5, 6, 7, 8]) assert.ok(used.has(p), `player ${p} sat out last round and should be prioritized`);
        for (const p of [1, 2, 3, 4]) assert.ok(!used.has(p), `player ${p} played last round and should not displace a sat-out player`);
    });

    console.log('\n=== Priority rule 3: prefer pairing (soft) ===');

    await test('prefer-paired players are partnered when nothing else conflicts', async (db) => {
        addCourt(db, 1, 1);
        addPlayer(db, 1, 'C');
        addPlayer(db, 2, 'C');
        addPlayer(db, 3, 'C');
        addPlayer(db, 4, 'C');
        addPairingRule(db, 1, 2, 'prefer');
        const plan = generateRound(db, SESSION_ID, 1);
        const side1 = plan[0].players.filter((p) => p.side === 1).map((p) => p.player_id);
        const side2 = plan[0].players.filter((p) => p.side === 2).map((p) => p.player_id);
        const sameTeam = (side1.includes(1) && side1.includes(2)) || (side2.includes(1) && side2.includes(2));
        assert.strictEqual(sameTeam, true, 'preferred pair should be partnered when there is no conflicting constraint');
    });

    console.log('\n=== Priority rule 4: recent pairing avoidance (soft) ===');

    await test('recently-partnered players are not repartnered when an alternative split exists', async (db) => {
        addCourt(db, 1, 1);
        addPlayer(db, 1, 'C');
        addPlayer(db, 2, 'C');
        addPlayer(db, 3, 'C');
        addPlayer(db, 4, 'C');
        // round 1: 1&2 partnered against two players (5,6) who aren't in tonight's round-2
        // pool at all - so the only "recent" pair among {1,2,3,4} is 1-2 itself, not
        // every combination, which is what makes an alternative split actually better.
        addPastGame(db, 900, 1, 1, [[1, 1], [2, 1], [5, 2], [6, 2]]);
        const plan = generateRound(db, SESSION_ID, 2);
        const side1 = plan[0].players.filter((p) => p.side === 1).map((p) => p.player_id);
        const side2 = plan[0].players.filter((p) => p.side === 2).map((p) => p.player_id);
        const onePartneredWithTwo = (side1.includes(1) && side1.includes(2)) || (side2.includes(1) && side2.includes(2));
        assert.strictEqual(onePartneredWithTwo, false, '1 and 2 just played together and should be split up when an alternative exists');
    });

    console.log('\n=== Priority rule 5: skill_compatibility matrix ===');

    await test('an incompatible skill combination is avoided when a compatible split exists', async (db) => {
        addCourt(db, 1, 1);
        addPlayer(db, 1, 'A');
        addPlayer(db, 2, 'A');
        addPlayer(db, 3, 'E');
        addPlayer(db, 4, 'B');
        // A-E explicitly disallowed; everything else allowed by default (permissive fallback)
        addCompat(db, 'A', 'E', false);
        addCompat(db, 'A', 'A', true);
        addCompat(db, 'A', 'B', true);
        addCompat(db, 'B', 'E', true);
        const plan = generateRound(db, SESSION_ID, 1);
        const side1 = plan[0].players.filter((p) => p.side === 1).map((p) => p.player_id);
        const side2 = plan[0].players.filter((p) => p.side === 2).map((p) => p.player_id);
        const aAndEPartnered = (side1.includes(1) && side1.includes(3)) || (side2.includes(1) && side2.includes(3));
        assert.strictEqual(aAndEPartnered, false, 'players 1 (A) and 3 (E) should not be forced into an explicitly disallowed partnership when avoidable');
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
