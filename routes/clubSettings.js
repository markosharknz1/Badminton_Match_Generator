const express = require('express');
const store = require('../db/store');
const { broadcast } = require('../lib/eventBus');

const router = express.Router();

const DATE_FORMATS = ['DMY', 'MDY', 'YMD'];

router.get('/', (req, res) => {
    res.json(store.queryOne('SELECT * FROM club_settings WHERE id = 1'));
});

router.put('/', (req, res) => {
    const existing = store.queryOne('SELECT * FROM club_settings WHERE id = 1');
    const merged = { ...existing, ...req.body };
    if (!DATE_FORMATS.includes(merged.date_format)) {
        return res.status(400).json({ error: `date_format must be one of ${DATE_FORMATS.join(', ')}` });
    }
    try {
        store.run(
            `UPDATE club_settings SET club_name=?, default_game_minutes=?, default_break_minutes=?, max_capacity=?, square_enabled=?,
             smtp2go_api_key=?, smtp2go_sender_email=?, smtp2go_sender_name=?, square_access_token=?, square_location_id=?,
             gender_aware_pairing=?, date_format=?, updated_at=datetime('now')
             WHERE id=1`,
            [merged.club_name, merged.default_game_minutes, merged.default_break_minutes, merged.max_capacity,
                merged.square_enabled ? 1 : 0,
                merged.smtp2go_api_key || null, merged.smtp2go_sender_email || null, merged.smtp2go_sender_name || null,
                merged.square_access_token || null, merged.square_location_id || null,
                merged.gender_aware_pairing ? 1 : 0, merged.date_format]
        );
        store.persist();
        broadcast('club_settings', {});
        res.json(store.queryOne('SELECT * FROM club_settings WHERE id = 1'));
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

module.exports = router;
