const express = require('express');
const store = require('../db/store');
const { broadcast } = require('../lib/eventBus');

const router = express.Router();

router.get('/', (req, res) => {
    res.json(store.query('SELECT * FROM courts ORDER BY court_number'));
});

router.post('/', (req, res) => {
    const { court_number, label, is_active } = req.body;
    if (!court_number || court_number < 1 || court_number > 32) {
        return res.status(400).json({ error: 'court_number must be between 1 and 32' });
    }
    try {
        const id = store.insert(
            'INSERT INTO courts (court_number, label, is_active) VALUES (?, ?, ?)',
            [court_number, label ?? null, is_active === undefined ? 1 : (is_active ? 1 : 0)]
        );
        store.persist();
        broadcast('courts', {});
        res.status(201).json(store.queryOne('SELECT * FROM courts WHERE id = ?', [id]));
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

router.put('/:id', (req, res) => {
    const existing = store.queryOne('SELECT * FROM courts WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Court not found' });
    const merged = { ...existing, ...req.body };
    try {
        store.run(
            'UPDATE courts SET court_number=?, label=?, is_active=? WHERE id=?',
            [merged.court_number, merged.label, merged.is_active ? 1 : 0, req.params.id]
        );
        store.persist();
        broadcast('courts', {});
        res.json(store.queryOne('SELECT * FROM courts WHERE id = ?', [req.params.id]));
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

router.delete('/:id', (req, res) => {
    const existing = store.queryOne('SELECT * FROM courts WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Court not found' });
    const inUse = store.queryOne('SELECT session_id FROM session_courts WHERE court_id = ? LIMIT 1', [req.params.id]);
    if (inUse) {
        return res.status(409).json({ error: 'Court has session history and cannot be deleted. Set is_active to false instead.' });
    }
    store.run('DELETE FROM courts WHERE id = ?', [req.params.id]);
    store.persist();
    broadcast('courts', {});
    res.status(204).end();
});

module.exports = router;
