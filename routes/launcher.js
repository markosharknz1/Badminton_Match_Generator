const express = require('express');
const { findBrowser, openAppWindow } = require('../lib/appWindow');

const router = express.Router();

// Only set by launcher.js when it started this server for its own app
// window - a plain `node server.js` or a remote device never sees it.
const APP_WINDOW = process.env.GAME_SCHEDULER_APP_WINDOW === '1';
const PORT = process.env.PORT || 4000;

function isLocalRequest(req) {
    const addr = req.socket.remoteAddress || '';
    return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

router.get('/', (req, res) => {
    res.json({ app_window: APP_WINDOW });
});

// The External Display link, inside the app window, opens a second app
// window (no address bar - it's going on a TV) via the same browser
// profile. Restricted to the app's own machine: a device on the club wifi
// must not be able to pop windows on the desk computer.
router.post('/open-display', (req, res) => {
    if (!APP_WINDOW) return res.status(404).json({ error: 'Not running in an app window' });
    if (!isLocalRequest(req)) return res.status(403).json({ error: 'Only the app window can do this' });
    const browser = findBrowser();
    if (!browser) return res.status(500).json({ error: 'No Edge/Chrome found' });
    openAppWindow(browser, `http://localhost:${PORT}/display.html`, { width: 1280, height: 800 });
    res.json({ ok: true });
});

module.exports = router;
