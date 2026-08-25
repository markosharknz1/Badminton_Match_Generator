const express = require('express');
const fs = require('fs');
const path = require('path');
const store = require('../db/store');

const router = express.Router();

const ICON_DIR = path.join(__dirname, '..', 'public', 'icons');
const CUSTOM_PNG_PATH = path.join(ICON_DIR, 'club-icon.png');
const CUSTOM_ICO_PATH = path.join(ICON_DIR, 'club-icon.ico');
const DEFAULT_PNG_PATH = path.join(ICON_DIR, 'icon-192.png');
const MAX_BYTES = 2 * 1024 * 1024;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Wraps a PNG buffer in a minimal single-image .ico container ("PNG-compressed
// icon" format, supported since Windows Vista for any size, including 256x256 -
// no image-processing library needed since the PNG bytes are embedded as-is).
// Used so launcher.py's desktop shortcut can point its icon at the same
// upload the web pages use as their favicon/header logo.
function pngToIco(pngBuffer) {
    const header = Buffer.alloc(6);
    header.writeUInt16LE(1, 2); // type: icon
    header.writeUInt16LE(1, 4); // image count

    const entry = Buffer.alloc(16);
    // width/height byte 0 means "256" per the ICO spec
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(pngBuffer.length, 8); // image data size
    entry.writeUInt32LE(22, 12); // image data offset (6-byte header + 16-byte entry)

    return Buffer.concat([header, entry, pngBuffer]);
}

// Client-side (club.js) already resizes to 256x256 before uploading; this is
// the server-side re-validation, independent of whatever the browser sent -
// same "never trust the client" pattern as the CSV/Excel importer.
// The raw-body limit is deliberately looser than MAX_BYTES so an oversized
// (but not absurd) upload reaches the handler below and gets the friendly
// "must be 2MB or smaller" message, rather than body-parser's generic
// "request entity too large" for anything past the real 2MB rule.
router.post('/icon', express.raw({ type: () => true, limit: '10mb' }), (req, res) => {
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length === 0) {
        return res.status(400).json({ error: 'No file received.' });
    }
    if (buf.length > MAX_BYTES) {
        return res.status(400).json({ error: 'Icon must be 2MB or smaller.' });
    }
    if (!buf.subarray(0, 8).equals(PNG_MAGIC)) {
        return res.status(400).json({ error: 'Icon must be a PNG file.' });
    }

    try {
        fs.mkdirSync(ICON_DIR, { recursive: true });
        fs.writeFileSync(CUSTOM_PNG_PATH, buf);
        fs.writeFileSync(CUSTOM_ICO_PATH, pngToIco(buf));

        const existing = store.queryOne('SELECT club_icon_ver FROM club_settings WHERE id = 1');
        const nextVer = (existing?.club_icon_ver || 0) + 1;
        store.run('UPDATE club_settings SET club_icon_ver = ? WHERE id = 1', [nextVer]);
        store.persist();

        res.json({ ok: true, version: nextVer });
    } catch (err) {
        res.status(500).json({ error: `Could not save the icon: ${err.message}` });
    }
});

router.get('/icon', (req, res) => {
    const filePath = fs.existsSync(CUSTOM_PNG_PATH) ? CUSTOM_PNG_PATH : DEFAULT_PNG_PATH;
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.type('png').sendFile(filePath);
});

module.exports = router;
