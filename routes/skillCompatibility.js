const express = require('express');
const store = require('../db/store');
const { broadcast } = require('../lib/eventBus');

const router = express.Router();

const GRADES = ['A', 'B', 'C', 'D', 'E'];

router.get('/', (req, res) => {
    res.json(store.query('SELECT skill_a, skill_b, allowed FROM skill_compatibility ORDER BY skill_a, skill_b'));
});

// Bulk update. Symmetric by design (per spec's current assumption): each pair
// is written in both directions so the grid can never drift asymmetric.
router.put('/', (req, res) => {
    const pairs = req.body.pairs;
    if (!Array.isArray(pairs)) return res.status(400).json({ error: 'pairs must be an array' });
    for (const p of pairs) {
        if (!GRADES.includes(p.skill_a) || !GRADES.includes(p.skill_b)) {
            return res.status(400).json({ error: `skill_a/skill_b must be one of ${GRADES.join(', ')}` });
        }
    }
    try {
        for (const p of pairs) {
            const allowed = p.allowed ? 1 : 0;
            store.run('INSERT OR REPLACE INTO skill_compatibility (skill_a, skill_b, allowed) VALUES (?, ?, ?)', [p.skill_a, p.skill_b, allowed]);
            store.run('INSERT OR REPLACE INTO skill_compatibility (skill_a, skill_b, allowed) VALUES (?, ?, ?)', [p.skill_b, p.skill_a, allowed]);
        }
        store.persist();
        broadcast('skill_compatibility', {});
        res.json(store.query('SELECT skill_a, skill_b, allowed FROM skill_compatibility ORDER BY skill_a, skill_b'));
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

module.exports = router;
