const express = require('express');
const store = require('../db/store');
const { broadcast } = require('../lib/eventBus');
const { getNextRoundNumber } = require('../lib/roundLifecycle');

const router = express.Router();

const FORMAT_SIZES = { singles: 2, doubles: 4 };

function gameWithPlayers(gameId) {
    const game = store.queryOne('SELECT * FROM games WHERE id = ?', [gameId]);
    if (!game) return null;
    const players = store.query(
        `SELECT gp.player_id, gp.side, gp.skill_level_at_time, p.first_name, p.last_name, p.gender
         FROM game_players gp JOIN players p ON p.id = gp.player_id
         WHERE gp.game_id = ? ORDER BY gp.side, p.last_name`,
        [gameId]
    );
    return { ...game, players };
}

// Validates a proposed lineup against the schema rules and current session
// state. excludeGameId lets an edit (PUT) validate against everyone else
// without tripping over its own existing rows.
function validateLineup({ sessionId, courtId, roundNumber, format, players, excludeGameId }) {
    const errors = [];

    if (!FORMAT_SIZES[format]) {
        errors.push(`format must be one of ${Object.keys(FORMAT_SIZES).join(', ')}`);
        return errors;
    }
    const expectedSize = FORMAT_SIZES[format];
    if (!Array.isArray(players) || players.length !== expectedSize) {
        errors.push(`${format} requires exactly ${expectedSize} players`);
        return errors;
    }
    const perSide = expectedSize / 2;
    const side1 = players.filter((p) => p.side === 1);
    const side2 = players.filter((p) => p.side === 2);
    if (side1.length !== perSide || side2.length !== perSide) {
        errors.push(`each side must have exactly ${perSide} player${perSide > 1 ? 's' : ''}`);
    }
    const playerIds = players.map((p) => p.player_id);
    if (new Set(playerIds).size !== playerIds.length) {
        errors.push('a player cannot appear twice in the same game');
    }

    const nextRound = getNextRoundNumber(sessionId);
    if (!Number.isInteger(roundNumber) || roundNumber < nextRound) {
        errors.push(`round_number must be ${nextRound} or later (round ${nextRound} is the next unplayed round)`);
    }

    const courtInSession = store.queryOne(
        `SELECT * FROM session_courts WHERE session_id = ? AND court_id = ? AND in_use = 1`,
        [sessionId, courtId]
    );
    if (!courtInSession) errors.push('court_id is not an in-use court for this session');

    const courtTaken = store.queryOne(
        `SELECT id FROM games WHERE session_id = ? AND court_id = ? AND round_number = ? AND status IN ('staged','active') ${excludeGameId ? 'AND id != ?' : ''}`,
        excludeGameId ? [sessionId, courtId, roundNumber, excludeGameId] : [sessionId, courtId, roundNumber]
    );
    if (courtTaken) errors.push('a game is already staged/active on this court for this round');

    for (const playerId of playerIds) {
        const attendance = store.queryOne(
            `SELECT * FROM attendance WHERE session_id = ? AND player_id = ? AND state != 'left' ORDER BY id DESC LIMIT 1`,
            [sessionId, playerId]
        );
        if (!attendance) {
            errors.push(`player ${playerId} is not present in this session`);
            continue;
        }
        const doubleBooked = store.queryOne(
            `SELECT g.id FROM games g JOIN game_players gp ON gp.game_id = g.id
             WHERE g.session_id = ? AND g.round_number = ? AND g.status IN ('staged','active') AND gp.player_id = ?
             ${excludeGameId ? 'AND g.id != ?' : ''}`,
            excludeGameId ? [sessionId, roundNumber, playerId, excludeGameId] : [sessionId, roundNumber, playerId]
        );
        if (doubleBooked) errors.push(`player ${playerId} is already assigned to another game in round ${roundNumber}`);
    }

    return errors;
}

function insertGame({ sessionId, courtId, roundNumber, format, players }) {
    const gameId = store.insert(
        `INSERT INTO games (session_id, court_id, round_number, format, mode, status) VALUES (?, ?, ?, ?, 'manual', 'staged')`,
        [sessionId, courtId, roundNumber, format]
    );
    for (const p of players) {
        const player = store.queryOne('SELECT skill_level FROM players WHERE id = ?', [p.player_id]);
        store.run(
            'INSERT INTO game_players (game_id, player_id, side, skill_level_at_time) VALUES (?, ?, ?, ?)',
            [gameId, p.player_id, p.side, player.skill_level]
        );
    }
    return gameId;
}

router.get('/sessions/:sessionId/games', (req, res) => {
    const { round_number, status } = req.query;
    let sql = 'SELECT id FROM games WHERE session_id = ?';
    const params = [req.params.sessionId];
    if (round_number) {
        sql += ' AND round_number = ?';
        params.push(round_number);
    }
    if (status) {
        sql += ' AND status = ?';
        params.push(status);
    }
    sql += ' ORDER BY round_number, court_id';
    const ids = store.query(sql, params).map((r) => r.id);
    res.json(ids.map(gameWithPlayers));
});

router.get('/games/:id', (req, res) => {
    const game = gameWithPlayers(req.params.id);
    if (!game) return res.status(404).json({ error: 'Game not found' });
    res.json(game);
});

router.post('/sessions/:sessionId/games', (req, res) => {
    const sessionId = Number(req.params.sessionId);
    const session = store.queryOne('SELECT * FROM sessions WHERE id = ?', [sessionId]);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const { court_id, round_number, format, players } = req.body;
    const errors = validateLineup({ sessionId, courtId: court_id, roundNumber: round_number, format, players: players || [] });
    if (errors.length) return res.status(400).json({ errors });

    try {
        const gameId = insertGame({ sessionId, courtId: court_id, roundNumber: round_number, format, players });
        store.persist();
        broadcast('game', { session_id: sessionId });
        res.status(201).json(gameWithPlayers(gameId));
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

router.put('/games/:id', (req, res) => {
    const existing = store.queryOne('SELECT * FROM games WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Game not found' });
    if (existing.status !== 'staged') return res.status(409).json({ error: 'Only staged games can be edited' });

    const court_id = req.body.court_id ?? existing.court_id;
    const round_number = req.body.round_number ?? existing.round_number;
    const format = req.body.format ?? existing.format;
    const players = req.body.players;
    if (!Array.isArray(players)) return res.status(400).json({ error: 'players is required' });

    const errors = validateLineup({
        sessionId: existing.session_id,
        courtId: court_id,
        roundNumber: round_number,
        format,
        players,
        excludeGameId: existing.id,
    });
    if (errors.length) return res.status(400).json({ errors });

    try {
        store.run('UPDATE games SET court_id=?, round_number=?, format=? WHERE id=?', [court_id, round_number, format, existing.id]);
        store.run('DELETE FROM game_players WHERE game_id = ?', [existing.id]);
        for (const p of players) {
            const player = store.queryOne('SELECT skill_level FROM players WHERE id = ?', [p.player_id]);
            store.run(
                'INSERT INTO game_players (game_id, player_id, side, skill_level_at_time) VALUES (?, ?, ?, ?)',
                [existing.id, p.player_id, p.side, player.skill_level]
            );
        }
        store.persist();
        broadcast('game', { session_id: existing.session_id });
        res.json(gameWithPlayers(existing.id));
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

router.delete('/games/:id', (req, res) => {
    const existing = store.queryOne('SELECT * FROM games WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Game not found' });
    if (existing.status !== 'staged') return res.status(409).json({ error: 'Only staged games can be unstaged' });
    store.run('DELETE FROM game_players WHERE game_id = ?', [existing.id]);
    store.run('DELETE FROM games WHERE id = ?', [existing.id]);
    store.persist();
    broadcast('game', { session_id: existing.session_id });
    res.status(204).end();
});

module.exports = router;
