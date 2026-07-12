const express = require('express');
const store = require('../db/store');
const { broadcast } = require('../lib/eventBus');

const router = express.Router();

// ?all=true includes inactive categories (for the Club settings management
// list); omitted/false returns only active ones (for check-in payment pickers).
router.get('/', (req, res) => {
    const sql = req.query.all === 'true'
        ? 'SELECT * FROM payment_categories ORDER BY sort_order, name'
        : 'SELECT * FROM payment_categories WHERE is_active = 1 ORDER BY sort_order, name';
    res.json(store.query(sql));
});

router.post('/', (req, res) => {
    const { name, sort_order } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
    try {
        const id = store.insert(
            'INSERT INTO payment_categories (name, sort_order, is_active) VALUES (?, ?, 1)',
            [name.trim(), sort_order ?? 0]
        );
        store.persist();
        broadcast('payment_categories', {});
        res.status(201).json(store.queryOne('SELECT * FROM payment_categories WHERE id = ?', [id]));
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

router.put('/:id', (req, res) => {
    const existing = store.queryOne('SELECT * FROM payment_categories WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Payment category not found' });
    const merged = { ...existing, ...req.body };
    if (!merged.name || !merged.name.trim()) return res.status(400).json({ error: 'name is required' });
    try {
        store.run(
            'UPDATE payment_categories SET name=?, sort_order=?, is_active=? WHERE id=?',
            [merged.name.trim(), merged.sort_order, merged.is_active ? 1 : 0, req.params.id]
        );
        store.persist();
        broadcast('payment_categories', {});
        res.json(store.queryOne('SELECT * FROM payment_categories WHERE id = ?', [req.params.id]));
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

router.delete('/:id', (req, res) => {
    const existing = store.queryOne('SELECT * FROM payment_categories WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Payment category not found' });
    const inUse = store.queryOne(
        `SELECT 1 AS x FROM session_template_payment_rates WHERE payment_category_id = ?
         UNION SELECT 1 FROM session_payment_rates WHERE payment_category_id = ?
         UNION SELECT 1 FROM attendance WHERE payment_category_id = ? LIMIT 1`,
        [req.params.id, req.params.id, req.params.id]
    );
    if (inUse) {
        return res.status(409).json({ error: 'Category is in use by a template, session, or attendance record. Set it to inactive instead.' });
    }
    store.run('DELETE FROM payment_categories WHERE id = ?', [req.params.id]);
    store.persist();
    broadcast('payment_categories', {});
    res.status(204).end();
});

module.exports = router;
