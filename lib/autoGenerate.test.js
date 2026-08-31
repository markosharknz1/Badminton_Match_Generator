// Isolated tests for the auto-generate algorithm against a throwaway
// in-memory database - no shared state with the real dev/seed db, so these
// are safe to run any time. Run with: node lib/autoGenerate.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const { generateRound, seededShuffle } = require('./autoGenerate');

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

    await test('stage-ahead: players still marked "playing" (round 1 hasn\'t ended yet) remain eligible for round 2, and sat-out players still get priority', async (db) => {
        // Reproduces a real bug hit at a real club night: staging the next
        // round while the current one is still live used to only see
        // 'here_today' players, so a nearly-full roster (everyone mid-match)
        // read as "not enough players" even though everyone would be free
        // again well before the staged round actually started.
        addCourt(db, 1, 1);
        addCourt(db, 2, 2); // room for 2 courts (8 players)
        for (let p = 1; p <= 10; p++) addPlayer(db, p, 'C');
        // Round 1 (still in progress): players 1-6 are on court right now.
        addPastGame(db, 900, 1, 1, [[1, 1], [2, 1], [3, 2], [4, 2]]);
        addPastGame(db, 901, 2, 1, [[5, 1], [6, 1]]);
        for (const id of [1, 2, 3, 4, 5, 6]) {
            db.run(`UPDATE attendance SET state = 'playing' WHERE session_id = ? AND player_id = ?`, [SESSION_ID, id]);
        }
        // Players 7-10 sat out round 1 (still 'here_today').

        const plan = generateRound(db, SESSION_ID, 2);
        assert.strictEqual(plan.length, 2, 'both courts should fill even though most of the pool is still marked "playing"');
        const used = new Set(playersInPlan(plan));
        for (const p of [7, 8, 9, 10]) assert.ok(used.has(p), `player ${p} sat out round 1 and must be prioritized into round 2`);
        assert.strictEqual(used.size, 8, 'exactly 8 of the 10 available players should be used (2 full doubles courts)');
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

    console.log('\n=== Priority rule 6b: gender-aware pairing ===');

    function courtGenderTier(game, genderById) {
        const side1 = game.players.filter((p) => p.side === 1).map((p) => genderById[p.player_id]);
        const side2 = game.players.filter((p) => p.side === 2).map((p) => genderById[p.player_id]);
        const same = (pair) => pair[0] === pair[1];
        const mixed = (pair) => pair[0] !== pair[1];
        if (mixed(side1) && mixed(side2)) return 1;
        if (same(side1) && same(side2)) return side1[0] === side2[0] ? 1 : 3;
        return 2;
    }

    function courtGenderType(game, genderById) {
        const genders = game.players.map((p) => genderById[p.player_id]);
        const women = genders.filter((g) => g === 'F').length;
        if (women === 4) return 'ladies';
        if (women === 0) return "men's";
        return 'mixed-or-other';
    }

    await test('balanced pool (4 men, 4 women) - every court reaches tier 1 (mixed pairs or same-gender)', async (db) => {
        addCourt(db, 1, 1);
        addCourt(db, 2, 2);
        addPlayer(db, 1, 'C', 'M');
        addPlayer(db, 2, 'C', 'M');
        addPlayer(db, 3, 'C', 'M');
        addPlayer(db, 4, 'C', 'M');
        addPlayer(db, 5, 'C', 'F');
        addPlayer(db, 6, 'C', 'F');
        addPlayer(db, 7, 'C', 'F');
        addPlayer(db, 8, 'C', 'F');
        const plan = generateRound(db, SESSION_ID, 1);
        assert.strictEqual(plan.length, 2);
        const genderById = { 1: 'M', 2: 'M', 3: 'M', 4: 'M', 5: 'F', 6: 'F', 7: 'F', 8: 'F' };
        for (const game of plan) {
            assert.strictEqual(courtGenderTier(game, genderById), 1, 'a perfectly balanced 4M/4F pool should always reach tier 1');
        }
    });

    await test('male-heavy pool (7 men, 1 woman) - degrades gracefully, never an invalid court', async (db) => {
        addCourt(db, 1, 1);
        addCourt(db, 2, 2);
        for (let p = 1; p <= 7; p++) addPlayer(db, p, 'C', 'M');
        addPlayer(db, 8, 'C', 'F');
        const plan = generateRound(db, SESSION_ID, 1);
        assert.strictEqual(plan.length, 2);
        const genderById = { 1: 'M', 2: 'M', 3: 'M', 4: 'M', 5: 'M', 6: 'M', 7: 'M', 8: 'F' };
        const tiers = plan.map((g) => courtGenderTier(g, genderById)).sort();
        assert.deepStrictEqual(tiers, [1, 2], 'with only one woman in the pool, one court is a same-gender tier 1 court and the other is an unavoidable 3-1 tier 2 - never tier 3, never invalid');
        for (const g of plan) assert.strictEqual(g.players.length, 4);
    });

    await test('female-heavy pool (7 women, 1 man) - mirrors the male-heavy case', async (db) => {
        addCourt(db, 1, 1);
        addCourt(db, 2, 2);
        for (let p = 1; p <= 7; p++) addPlayer(db, p, 'C', 'F');
        addPlayer(db, 8, 'C', 'M');
        const plan = generateRound(db, SESSION_ID, 1);
        const genderById = { 1: 'F', 2: 'F', 3: 'F', 4: 'F', 5: 'F', 6: 'F', 7: 'F', 8: 'M' };
        const tiers = plan.map((g) => courtGenderTier(g, genderById)).sort();
        assert.deepStrictEqual(tiers, [1, 2]);
    });

    await test('women scattered thin across a male-heavy pool (18 men, 6 women, 6 courts) still reaches tier 1 everywhere', async (db) => {
        // Reproduces a real bad outcome at a real club night: with women
        // outnumbered 3-to-1 and scattered ~one-per-bucket by a gender-blind
        // skill sort, the old post-hoc single-swap repair could only fix one
        // opposite-skewed *pair* of buckets - it left 4 of 6 courts as a 3-1
        // split even though a better arrangement was available (6 of 6 at
        // tier 1 instead of 2 of 6). With only 6 women, forming one ladies'
        // doubles (4) plus one mixed doubles (2+2) is the only way to use
        // them all without a leftover - see the even-mix test below for a
        // pool with enough women to actually balance ladies' vs mixed.
        for (let c = 1; c <= 6; c++) addCourt(db, c, c);
        for (let p = 1; p <= 18; p++) addPlayer(db, p, 'C', 'M');
        for (let p = 19; p <= 24; p++) addPlayer(db, p, 'C', 'F');
        const genderById = Object.fromEntries(
            Array.from({ length: 24 }, (_, i) => i + 1).map((id) => [id, id <= 18 ? 'M' : 'F'])
        );
        const plan = generateRound(db, SESSION_ID, 1);
        assert.strictEqual(plan.length, 6);
        const tiers = plan.map((g) => courtGenderTier(g, genderById));
        assert.ok(tiers.every((t) => t === 1), `every court should reach tier 1 - got tiers ${tiers.join(',')}`);
        const types = plan.map((g) => courtGenderType(g, genderById));
        assert.strictEqual(types.filter((t) => t === 'ladies').length, 1, 'the 6 women should form exactly one ladies\' doubles court');
        assert.strictEqual(types.filter((t) => t === 'mixed-or-other').length, 1, 'and exactly one mixed doubles court with the 2 remaining women');
        assert.strictEqual(types.filter((t) => t === "men's").length, 4, 'leaving 4 all-male courts from the remaining men');
    });

    await test('with plenty of both genders, ladies\' doubles and mixed doubles come out roughly even rather than always favoring one', async (db) => {
        for (let c = 1; c <= 6; c++) addCourt(db, c, c);
        for (let p = 1; p <= 12; p++) addPlayer(db, p, 'C', 'M');
        for (let p = 13; p <= 24; p++) addPlayer(db, p, 'C', 'F');
        const genderById = Object.fromEntries(
            Array.from({ length: 24 }, (_, i) => i + 1).map((id) => [id, id <= 12 ? 'M' : 'F'])
        );
        const plan = generateRound(db, SESSION_ID, 1);
        assert.strictEqual(plan.length, 6);
        const tiers = plan.map((g) => courtGenderTier(g, genderById));
        assert.ok(tiers.every((t) => t === 1), `every court should reach tier 1 - got tiers ${tiers.join(',')}`);
        const types = plan.map((g) => courtGenderType(g, genderById));
        const ladiesCount = types.filter((t) => t === 'ladies').length;
        const mixedCount = types.filter((t) => t === 'mixed-or-other').length;
        assert.ok(ladiesCount > 0 && mixedCount > 0, `expected both ladies' and mixed courts to appear, got types ${types.join(',')}`);
        assert.ok(Math.abs(ladiesCount - mixedCount) <= 1, `ladies' (${ladiesCount}) and mixed (${mixedCount}) counts should be roughly even, not skewed to one type`);
    });

    await test('skill-compatibility restrictions still produce valid, non-crashing courts alongside gender tiering', async (db) => {
        addCourt(db, 1, 1);
        addCourt(db, 2, 2);
        addPlayer(db, 1, 'A', 'M');
        addPlayer(db, 2, 'A', 'F');
        addPlayer(db, 3, 'E', 'M');
        addPlayer(db, 4, 'E', 'F');
        addPlayer(db, 5, 'A', 'M');
        addPlayer(db, 6, 'A', 'F');
        addPlayer(db, 7, 'E', 'M');
        addPlayer(db, 8, 'E', 'F');
        addCompat(db, 'A', 'E', false); // A and E can never be matched, partner or opponent
        addCompat(db, 'A', 'A', true);
        addCompat(db, 'E', 'E', true);
        const plan = generateRound(db, SESSION_ID, 1);
        assert.strictEqual(plan.length, 2);
        for (const g of plan) {
            assert.strictEqual(g.players.length, 4, 'every generated court must be a complete, valid 4-player doubles game');
            const ids = g.players.map((p) => p.player_id);
            assert.strictEqual(new Set(ids).size, 4, 'no duplicate player across a court');
        }
    });

    await test('gender_aware_pairing = 0 disables the swap - matches pure skill-based bucketing', async (db) => {
        addCourt(db, 1, 1);
        addCourt(db, 2, 2);
        db.run('INSERT INTO club_settings (id, gender_aware_pairing) VALUES (1, 0)');
        addPlayer(db, 1, 'C', 'M');
        addPlayer(db, 2, 'C', 'M');
        addPlayer(db, 3, 'C', 'M');
        addPlayer(db, 4, 'C', 'F');
        addPlayer(db, 5, 'C', 'M');
        addPlayer(db, 6, 'C', 'F');
        addPlayer(db, 7, 'C', 'F');
        addPlayer(db, 8, 'C', 'F');

        // All 8 are the same skill, so bucketing is purely the per-round
        // shuffled tiebreak order (see the "court mixing" follow-on -
        // the tiebreak used to be raw player_id, now it's a seeded per-round
        // shuffle) - predict it the same way generateRound() computes it
        // rather than assuming a fixed id-ascending order.
        const roundSeed = SESSION_ID * 1000 + 1;
        const tiebreakOrder = seededShuffle([1, 2, 3, 4, 5, 6, 7, 8], roundSeed);
        const predictedBuckets = [new Set(tiebreakOrder.slice(0, 4)), new Set(tiebreakOrder.slice(4, 8))];
        const predictedBucketWithPlayer4 = predictedBuckets.find((b) => b.has(4));

        const plan = generateRound(db, SESSION_ID, 1);
        const gameWithPlayer4 = plan.find((g) => playersInPlan([g]).includes(4));
        const actualBucketWithPlayer4 = new Set(playersInPlan([gameWithPlayer4]));

        assert.deepStrictEqual(
            [...actualBucketWithPlayer4].sort((a, b) => a - b),
            [...predictedBucketWithPlayer4].sort((a, b) => a - b),
            'with the setting off, player 4 should stay in whatever bucket the skill/tiebreak sort naturally placed them in - no cross-bucket gender swap should happen'
        );
    });

    await test('gender_aware_pairing = 1 (explicit) performs the same swap as the default-on behaviour', async (db) => {
        addCourt(db, 1, 1);
        addCourt(db, 2, 2);
        db.run('INSERT INTO club_settings (id, gender_aware_pairing) VALUES (1, 1)');
        addPlayer(db, 1, 'C', 'M');
        addPlayer(db, 2, 'C', 'M');
        addPlayer(db, 3, 'C', 'M');
        addPlayer(db, 4, 'C', 'F');
        addPlayer(db, 5, 'C', 'M');
        addPlayer(db, 6, 'C', 'F');
        addPlayer(db, 7, 'C', 'F');
        addPlayer(db, 8, 'C', 'F');
        const plan = generateRound(db, SESSION_ID, 1);
        const genderById = { 1: 'M', 2: 'M', 3: 'M', 4: 'F', 5: 'M', 6: 'F', 7: 'F', 8: 'F' };
        for (const game of plan) {
            assert.strictEqual(courtGenderTier(game, genderById), 1, 'the fixable 3-1/1-3 split should be repaired into two tier 1 courts when the setting is on');
        }
    });

    console.log('\n=== Round-to-round variety (court + pairing mixing) ===');

    await test('court assignment varies round to round for an unchanged pool', async (db) => {
        for (let c = 1; c <= 4; c++) addCourt(db, c, c);
        for (let p = 1; p <= 16; p++) addPlayer(db, p, 'C');
        const plan1 = generateRound(db, SESSION_ID, 1);
        const plan2 = generateRound(db, SESSION_ID, 2);
        const courtOf = (plan, playerId) => plan.find((g) => playersInPlan([g]).includes(playerId))?.court_id;
        const samePlayers = Array.from({ length: 16 }, (_, i) => i + 1);
        const sameCourtCount = samePlayers.filter((id) => courtOf(plan1, id) === courtOf(plan2, id)).length;
        assert.ok(sameCourtCount < 16, 'at least some players should land on a different court between rounds for an identical pool - court assignment should not be pinned to skill rank every round');
    });

    await test('who plays with whom varies round to round for an unchanged pool', async (db) => {
        for (let c = 1; c <= 4; c++) addCourt(db, c, c);
        for (let p = 1; p <= 16; p++) addPlayer(db, p, 'C');
        // No round 1 result is actually persisted here, so rule 4 (recent
        // pairing avoidance) has nothing recorded to work from - any
        // difference between these two plans comes from the round-seeded
        // bucketing shuffle alone, isolating exactly what this test covers.
        const plan1 = generateRound(db, SESSION_ID, 1);
        const plan2 = generateRound(db, SESSION_ID, 2);
        const courtMatesOf = (plan, playerId) => new Set(playersInPlan(plan.filter((g) => playersInPlan([g]).includes(playerId))));
        const group1 = [...courtMatesOf(plan1, 1)].sort((a, b) => a - b);
        const group2 = [...courtMatesOf(plan2, 1)].sort((a, b) => a - b);
        assert.notDeepStrictEqual(group1, group2, 'player 1 should not be grouped with the exact same court-mates in consecutive rounds for a pool this size - bucketing should mix across the pool, not always form the same pods');
    });

    // The two tests above use all-male fixtures (addPlayer's gender default),
    // which never exercises formBuckets' gender-aware branch at all (an
    // all-one-gender pool has women.length===0, so it falls straight through
    // to the plain skill-order chunking path) - even though gender-aware
    // pairing is club_settings' real default. A stable, gender-mixed roster
    // spanning more than one skill tier is exactly the scenario that shipped
    // broken: skill-sort alone always pulled the same lowest-skill subset of
    // women into the first bucket every round, no matter how many rounds
    // passed, since nothing about *selection* ever changed for an unchanging
    // pool - only pairing *within* that fixed group ever varied.
    console.log('\n=== Round-to-round variety: gender-aware bucket composition (mixed skill) ===');

    await test('bucket MEMBERSHIP (not just partner pairing) rotates round to round when women span multiple skill tiers', async (db) => {
        addCourt(db, 1, 1);
        addCourt(db, 2, 2);
        // 8 women across 4 skill tiers, 2 per tier - skill-sort alone always
        // puts the same 2 tiers (A,A,B,B) in the first bucket every round;
        // only a bucket-membership rotation can vary this for a pool this
        // stable, since every player is selected every round (no cut).
        addPlayer(db, 1, 'A', 'F');
        addPlayer(db, 2, 'A', 'F');
        addPlayer(db, 3, 'B', 'F');
        addPlayer(db, 4, 'B', 'F');
        addPlayer(db, 5, 'C', 'F');
        addPlayer(db, 6, 'C', 'F');
        addPlayer(db, 7, 'D', 'F');
        addPlayer(db, 8, 'D', 'F');

        const bucketSetsForPlayer1 = [];
        for (let round = 1; round <= 8; round++) {
            const plan = generateRound(db, SESSION_ID, round);
            const game = plan.find((g) => playersInPlan([g]).includes(1));
            bucketSetsForPlayer1.push(playersInPlan([game]).sort((a, b) => a - b).join(','));
        }
        const distinctBucketSets = new Set(bucketSetsForPlayer1);
        assert.ok(
            distinctBucketSets.size > 1,
            `player 1's bucket-mates should vary across rounds for a pool spanning multiple skill tiers, but every round produced the same group: ${bucketSetsForPlayer1[0]}`
        );
    });

    await test('bucket composition rotation still produces valid gender tiers and skill-adjacent groupings', async (db) => {
        addCourt(db, 1, 1);
        addCourt(db, 2, 2);
        addPlayer(db, 1, 'A', 'F');
        addPlayer(db, 2, 'A', 'F');
        addPlayer(db, 3, 'B', 'F');
        addPlayer(db, 4, 'B', 'F');
        addPlayer(db, 5, 'C', 'F');
        addPlayer(db, 6, 'C', 'F');
        addPlayer(db, 7, 'D', 'F');
        addPlayer(db, 8, 'D', 'F');
        const genderById = { 1: 'F', 2: 'F', 3: 'F', 4: 'F', 5: 'F', 6: 'F', 7: 'F', 8: 'F' };
        for (let round = 1; round <= 8; round++) {
            const plan = generateRound(db, SESSION_ID, round);
            assert.strictEqual(plan.length, 2, `round ${round} should stage both courts`);
            for (const game of plan) {
                assert.strictEqual(courtGenderTier(game, genderById), 1, `round ${round}: an all-women bucket should still read as tier 1 (same-gender court)`);
            }
        }
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
