// Auto-generate algorithm: builds one round's worth of doubles games from the
// here_today pool, following the spec's priority order:
//   1. avoid pairing rules       - hard, never violated (partner-level)
//   2. sat-out-last-round        - hard priority for who gets selected to play
//   3. prefer pairing rules      - soft, applied where possible
//   4. recent pairing avoidance  - soft, partner AND opponent history
//   5. skill_compatibility       - soft-but-weighted matrix check
//   6. skill/gender balance      - minimize spread, lowest priority
//
// Pure and read-only: takes a db handle + session/round, returns a proposed
// list of court assignments. Never writes to the database itself - callers
// (lib/roundLifecycle.js) decide whether/how to persist the plan. This split
// is what makes it possible to unit-test against a throwaway in-memory db
// (see autoGenerate.test.js) instead of the real one.
const { all } = require('../db/index');

const DEFAULT_LOOKBACK_ROUNDS = 4; // "recent" pairing window; not yet club-editable (open spec question)
const SKILL_RANK = { A: 0, B: 1, C: 2, D: 3, E: 4 };

function pairKey(a, b) {
    return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function loadPairRuleSet(db, ruleType) {
    // pairing_rules has no session_id column in the current schema, so
    // session_only-scoped rules can't be filtered to a specific session -
    // every row of the requested rule_type is treated as active. Flagged as
    // a known gap alongside the spec's other open pairing-rule questions.
    const rows = all(db, 'SELECT player_a_id, player_b_id FROM pairing_rules WHERE rule_type = ?', [ruleType]);
    return new Set(rows.map((r) => pairKey(r.player_a_id, r.player_b_id)));
}

function loadCompatibility(db) {
    const rows = all(db, 'SELECT skill_a, skill_b, allowed FROM skill_compatibility');
    const map = new Map();
    for (const r of rows) map.set(`${r.skill_a}-${r.skill_b}`, !!r.allowed);
    return (a, b) => {
        if (map.has(`${a}-${b}`)) return map.get(`${a}-${b}`);
        if (map.has(`${b}-${a}`)) return map.get(`${b}-${a}`);
        return true; // no explicit rule -> permissive default
    };
}

function loadSatOutLastRound(db, sessionId, roundNumber, poolIds) {
    if (roundNumber <= 1) return new Set(); // no "last round" to compare against
    const playedLast = all(
        db,
        `SELECT DISTINCT gp.player_id FROM games g JOIN game_players gp ON gp.game_id = g.id
         WHERE g.session_id = ? AND g.round_number = ?`,
        [sessionId, roundNumber - 1]
    ).map((r) => r.player_id);
    const playedSet = new Set(playedLast);
    return new Set(poolIds.filter((id) => !playedSet.has(id)));
}

function loadRecentPairs(db, sessionId, roundNumber, lookback) {
    const fromRound = Math.max(1, roundNumber - lookback);
    const rows = all(
        db,
        `SELECT g.id AS game_id, gp.player_id FROM games g JOIN game_players gp ON gp.game_id = g.id
         WHERE g.session_id = ? AND g.round_number >= ? AND g.round_number < ?`,
        [sessionId, fromRound, roundNumber]
    );
    const byGame = new Map();
    for (const r of rows) {
        if (!byGame.has(r.game_id)) byGame.set(r.game_id, []);
        byGame.get(r.game_id).push(r.player_id);
    }
    const recent = new Set();
    for (const players of byGame.values()) {
        for (let i = 0; i < players.length; i++) {
            for (let j = i + 1; j < players.length; j++) {
                recent.add(pairKey(players[i], players[j]));
            }
        }
    }
    return recent;
}

// Scores one way of splitting a 4-player bucket into two teams of 2.
// Lower is better. hardViolation flags an avoid-pair placed as partners.
function scoreSplit(team1, team2, avoidSet, preferSet, recentSet, isCompatible) {
    let score = 0;
    let hardViolation = false;

    for (const [x, y] of [team1, team2]) {
        const key = pairKey(x.player_id, y.player_id);
        if (avoidSet.has(key)) {
            hardViolation = true;
            score += 100000;
        }
        if (preferSet.has(key)) score -= 50;
        if (recentSet.has(key)) score += 20; // recent partners
        if (!isCompatible(x.skill_level, y.skill_level)) score += 5000;
    }
    for (const x of team1) {
        for (const y of team2) {
            const key = pairKey(x.player_id, y.player_id);
            if (recentSet.has(key)) score += 10; // recent opponents
            if (!isCompatible(x.skill_level, y.skill_level)) score += 2000;
        }
    }
    const avg = (team) => (SKILL_RANK[team[0].skill_level] + SKILL_RANK[team[1].skill_level]) / 2;
    score += Math.abs(avg(team1) - avg(team2)) * 5;
    return { score, hardViolation };
}

// The 3 ways to split 4 players [a,b,c,d] into two unordered teams of 2.
function splitOptions([a, b, c, d]) {
    return [
        { team1: [a, b], team2: [c, d] },
        { team1: [a, c], team2: [b, d] },
        { team1: [a, d], team2: [b, c] },
    ];
}

function bestSplit(bucket, avoidSet, preferSet, recentSet, isCompatible) {
    let best = null;
    for (const opt of splitOptions(bucket)) {
        const { score, hardViolation } = scoreSplit(opt.team1, opt.team2, avoidSet, preferSet, recentSet, isCompatible);
        if (!best || (best.hardViolation && !hardViolation) || (best.hardViolation === hardViolation && score < best.score)) {
            best = { ...opt, score, hardViolation };
        }
    }
    return best;
}

// If every split of a bucket still has a hard avoid-violation (only possible
// with 3+ mutually-avoiding players in one bucket of 4 - rare), try a single
// swap with another bucket to break up the conflict.
function repairHardViolations(buckets, avoidSet, preferSet, recentSet, isCompatible) {
    const results = buckets.map((b) => bestSplit(b, avoidSet, preferSet, recentSet, isCompatible));
    for (let i = 0; i < buckets.length; i++) {
        if (!results[i].hardViolation) continue;
        let fixed = false;
        for (let j = 0; j < buckets.length && !fixed; j++) {
            if (i === j) continue;
            for (let bi = 0; bi < buckets[i].length && !fixed; bi++) {
                for (let bj = 0; bj < buckets[j].length && !fixed; bj++) {
                    const newI = buckets[i].slice();
                    const newJ = buckets[j].slice();
                    [newI[bi], newJ[bj]] = [newJ[bj], newI[bi]];
                    const splitI = bestSplit(newI, avoidSet, preferSet, recentSet, isCompatible);
                    const splitJ = bestSplit(newJ, avoidSet, preferSet, recentSet, isCompatible);
                    if (!splitI.hardViolation && !splitJ.hardViolation) {
                        buckets[i] = newI;
                        buckets[j] = newJ;
                        results[i] = splitI;
                        results[j] = splitJ;
                        fixed = true;
                    }
                }
            }
        }
        if (!fixed) {
            console.warn(`[autoGenerate] could not resolve an avoid-pair conflict in a group of 4 - leaving as best-effort`);
        }
    }
    return results;
}

// Returns [{ court_id, format: 'doubles', players: [{player_id, side}, ...] }, ...]
// or [] if there aren't enough present players (or free courts) for even one
// full doubles court - callers must treat [] as "could not generate", not as
// "generated zero games on purpose".
function generateRound(db, sessionId, roundNumber, options = {}) {
    const lookback = options.lookbackRounds ?? DEFAULT_LOOKBACK_ROUNDS;

    // Excludes players already assigned to a staged/active game in this round -
    // staging doesn't change attendance.state (by design, so staff can stage
    // ahead without pulling anyone out of the pool early), so a player can be
    // 'here_today' and still be spoken for by a court staged moments ago
    // (e.g. by "fill remaining courts" running after a partial manual build).
    const pool = all(
        db,
        `SELECT p.id AS player_id, p.skill_level, p.gender
         FROM attendance a JOIN players p ON p.id = a.player_id
         WHERE a.session_id = ? AND a.state = 'here_today'
           AND a.player_id NOT IN (
               SELECT gp.player_id FROM game_players gp JOIN games g ON g.id = gp.game_id
               WHERE g.session_id = ? AND g.round_number = ? AND g.status IN ('staged', 'active')
           )`,
        [sessionId, sessionId, roundNumber]
    );

    const allCourts = all(db, `SELECT court_id FROM session_courts WHERE session_id = ? AND in_use = 1`, [sessionId]).map((r) => r.court_id);
    const usedCourts = new Set(all(db, `SELECT court_id FROM games WHERE session_id = ? AND round_number = ?`, [sessionId, roundNumber]).map((r) => r.court_id));
    const freeCourts = allCourts.filter((id) => !usedCourts.has(id)).sort((a, b) => a - b);

    const courtsToFill = Math.min(Math.floor(pool.length / 4), freeCourts.length);
    if (courtsToFill === 0) return [];

    const satOut = loadSatOutLastRound(db, sessionId, roundNumber, pool.map((p) => p.player_id));
    const avoidSet = loadPairRuleSet(db, 'avoid');
    const preferSet = loadPairRuleSet(db, 'prefer');
    const recentSet = loadRecentPairs(db, sessionId, roundNumber, lookback);
    const isCompatible = loadCompatibility(db);

    // Rule 2: sat-out players get hard priority for the limited slots.
    const satOutPlayers = pool.filter((p) => satOut.has(p.player_id));
    const restPlayers = pool.filter((p) => !satOut.has(p.player_id));
    // Stable, deterministic tiebreak within each priority tier (spec doesn't
    // specify one) - sort by skill so buckets come out skill-sorted for free.
    const bySkill = (arr) => arr.slice().sort((x, y) => SKILL_RANK[x.skill_level] - SKILL_RANK[y.skill_level] || x.player_id - y.player_id);

    const neededPlayers = courtsToFill * 4;
    const selected = [...bySkill(satOutPlayers), ...bySkill(restPlayers)].slice(0, neededPlayers);
    // Re-sort the selected group purely by skill so buckets-of-4 are close in
    // grade (serves rules 5/6) - selection priority already happened above.
    const skillSorted = bySkill(selected);

    const buckets = [];
    for (let i = 0; i < skillSorted.length; i += 4) buckets.push(skillSorted.slice(i, i + 4));

    const splits = repairHardViolations(buckets, avoidSet, preferSet, recentSet, isCompatible);

    return freeCourts.slice(0, courtsToFill).map((courtId, i) => {
        const { team1, team2 } = splits[i];
        return {
            court_id: courtId,
            format: 'doubles',
            players: [
                { player_id: team1[0].player_id, side: 1 },
                { player_id: team1[1].player_id, side: 1 },
                { player_id: team2[0].player_id, side: 2 },
                { player_id: team2[1].player_id, side: 2 },
            ],
        };
    });
}

module.exports = { generateRound, pairKey, DEFAULT_LOOKBACK_ROUNDS };
