const express = require('express');
const { addClient, removeClient } = require('../lib/eventBus');

const router = express.Router();

router.get('/', (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
    });
    res.write('\n');
    addClient(res);

    // Keeps the connection alive through idle periods (e.g. no attendance
    // activity for a while) so it isn't silently dropped by the browser or OS.
    const heartbeat = setInterval(() => {
        res.write(': heartbeat\n\n');
    }, 25000);

    req.on('close', () => {
        clearInterval(heartbeat);
        removeClient(res);
    });
});

module.exports = router;
