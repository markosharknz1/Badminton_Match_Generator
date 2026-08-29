const express = require('express');
const store = require('../db/store');
const { broadcast } = require('../lib/eventBus');

const router = express.Router();

const STATES = ['checked_in', 'here_today', 'playing', 'left'];
const LEFT_REASONS = ['no-show', 'departed', 'injured', 'session_ended', 'removed'];
// How someone paid - a fixed, non-editable field (not a club-configurable
// category like payment_category_id, which is what TYPE of player they are).
const PAYMENT_METHODS = ['Cash', 'Card', 'Voucher'];

router.get('/sessions/:sessionId/attendance', (req, res) => {
    const { state } = req.query;
    let sql = `SELECT a.*, p.first_name, p.last_name, p.skill_level, p.gender, pc.name AS payment_category_name
               FROM attendance a
               JOIN players p ON p.id = a.player_id
               LEFT JOIN payment_categories pc ON pc.id = a.payment_category_id
               WHERE a.session_id = ?`;
    const params = [req.params.sessionId];
    if (state) {
        sql += ' AND a.state = ?';
        params.push(state);
    }
    sql += ' ORDER BY a.checked_in_at';
    res.json(store.query(sql, params));
});

router.post('/sessions/:sessionId/attendance', (req, res) => {
    const sessionId = req.params.sessionId;
    const session = store.queryOne('SELECT * FROM sessions WHERE id = ?', [sessionId]);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    const { player_id, state } = req.body;
    if (!player_id) return res.status(400).json({ error: 'player_id is required' });
    const player = store.queryOne('SELECT * FROM players WHERE id = ?', [player_id]);
    if (!player) return res.status(404).json({ error: 'Player not found' });
    const already = store.queryOne(
        `SELECT * FROM attendance WHERE session_id = ? AND player_id = ? AND state != 'left'`,
        [sessionId, player_id]
    );
    if (already) return res.status(409).json({ error: 'Player is already checked in to this session', attendance: already });
    const s = state && STATES.includes(state) ? state : 'here_today';
    try {
        const id = store.insert(
            'INSERT INTO attendance (session_id, player_id, state) VALUES (?, ?, ?)',
            [sessionId, player_id, s]
        );
        store.persist();
        broadcast('attendance', { session_id: Number(sessionId) });
        res.status(201).json(store.queryOne('SELECT * FROM attendance WHERE id = ?', [id]));
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

router.put('/attendance/:id', (req, res) => {
    const existing = store.queryOne('SELECT * FROM attendance WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Attendance record not found' });
    const merged = { ...existing, ...req.body };
    if (!STATES.includes(merged.state)) return res.status(400).json({ error: `state must be one of ${STATES.join(', ')}` });
    if (merged.state === 'left' && !merged.left_reason) {
        return res.status(400).json({ error: 'left_reason is required when state is left' });
    }
    if (merged.left_reason && !LEFT_REASONS.includes(merged.left_reason)) {
        return res.status(400).json({ error: `left_reason must be one of ${LEFT_REASONS.join(', ')}` });
    }
    if (merged.payment_category_id !== null && merged.payment_category_id !== undefined) {
        const category = store.queryOne('SELECT id FROM payment_categories WHERE id = ?', [merged.payment_category_id]);
        if (!category) return res.status(400).json({ error: 'payment_category_id does not exist' });
    }
    if (merged.payment_amount_cents !== null && merged.payment_amount_cents !== undefined) {
        if (!Number.isFinite(merged.payment_amount_cents) || merged.payment_amount_cents < 0) {
            return res.status(400).json({ error: 'payment_amount_cents must be a non-negative number' });
        }
    }
    if (merged.payment_method !== null && merged.payment_method !== undefined && !PAYMENT_METHODS.includes(merged.payment_method)) {
        return res.status(400).json({ error: `payment_method must be one of ${PAYMENT_METHODS.join(', ')}` });
    }
    // A voucher was already paid for when it was bought/allocated - checking
    // someone in against one still counts them and their category, but is
    // never new money taken that night. Enforced here (not just the check-in
    // UI resetting the field) so it holds regardless of caller.
    if (merged.payment_method === 'Voucher') {
        merged.payment_amount_cents = 0;
    }
    try {
        store.run(
            `UPDATE attendance SET state=?, left_reason=?, payment_category_id=?, payment_amount_cents=?, payment_method=?, payment_note=?, first_time=?, new_member=?
             WHERE id=?`,
            [
                merged.state,
                merged.state === 'left' ? merged.left_reason : null,
                merged.payment_category_id ?? null,
                merged.payment_amount_cents ?? null,
                merged.payment_method ?? null,
                merged.payment_note ?? null,
                merged.first_time ? 1 : 0,
                merged.new_member ? 1 : 0,
                req.params.id,
            ]
        );

        // A player leaving mid-session is cleanly detached from anything
        // staged for a future round - active/completed games (already
        // played) are never touched, preserving the audit trail.
        let affectedStagedGames = 0;
        if (merged.state === 'left') {
            const staged = store.query(
                `SELECT gp.game_id FROM game_players gp JOIN games g ON g.id = gp.game_id
                 WHERE gp.player_id = ? AND g.session_id = ? AND g.status = 'staged'`,
                [existing.player_id, existing.session_id]
            );
            for (const row of staged) {
                store.run('DELETE FROM game_players WHERE game_id = ? AND player_id = ?', [row.game_id, existing.player_id]);
            }
            affectedStagedGames = staged.length;
        }

        store.persist();
        broadcast('attendance', { session_id: existing.session_id });
        if (affectedStagedGames > 0) broadcast('game', { session_id: existing.session_id });
        res.json(store.queryOne('SELECT * FROM attendance WHERE id = ?', [req.params.id]));
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

module.exports = router;
