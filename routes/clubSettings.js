const express = require('express');
const store = require('../db/store');
const { broadcast } = require('../lib/eventBus');

const router = express.Router();

router.get('/', (req, res) => {
    res.json(store.queryOne('SELECT * FROM club_settings WHERE id = 1'));
});

router.put('/', (req, res) => {
    const existing = store.queryOne('SELECT * FROM club_settings WHERE id = 1');
    const merged = { ...existing, ...req.body };
    try {
        store.run(
            `UPDATE club_settings SET club_name=?, default_game_minutes=?, default_break_minutes=?, max_capacity=?, square_enabled=?, updated_at=datetime('now')
             WHERE id=1`,
            [merged.club_name, merged.default_game_minutes, merged.default_break_minutes, merged.max_capacity,
                merged.square_enabled ? 1 : 0]
        );
        store.persist();
        broadcast('club_settings', {});
        res.json(store.queryOne('SELECT * FROM club_settings WHERE id = 1'));
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

module.exports = router;
