const express = require('express');
const { DB_PATH, BACKUP_DIR, backupToDocuments, listBackups } = require('../db/index');
const store = require('../db/store');

const router = express.Router();

// Info for the Members page's "database management" panel - where automatic
// backups land and what's there, without needing to dig through Explorer.
router.get('/status', (req, res) => {
    res.json({ backup_dir: BACKUP_DIR, backups: listBackups() });
});

// Downloads the live database right now (persisted first, so it reflects
// everything up to this exact moment, not just the last automatic backup).
router.get('/download', (req, res) => {
    store.persist();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    res.download(DB_PATH, `game_scheduler_${stamp}.db`);
});

// Also copies straight into the Documents backup folder (same as the
// automatic per-launch backup), for "back it up right now" without a
// separate download+move step.
router.post('/now', (req, res) => {
    store.persist();
    const backupPath = backupToDocuments();
    if (!backupPath) return res.status(500).json({ error: 'Backup failed - see server logs for details.' });
    res.json({ backup_dir: BACKUP_DIR, backups: listBackups() });
});

module.exports = router;
