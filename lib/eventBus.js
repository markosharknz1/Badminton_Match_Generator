// Minimal server-side pub/sub for pushing state changes to connected SSE
// clients (display screen, management screen, any duplicate tab). One-way,
// server -> browser only - simplest fit for Express, per the spec's choice
// of SSE over WebSockets.

const clients = new Set();

function addClient(res) {
    clients.add(res);
}

function removeClient(res) {
    clients.delete(res);
}

// type: short string like 'session', 'attendance', 'players', 'courts',
// 'club_settings', 'session_templates', 'game'. data: small JSON-serializable
// payload (typically just enough id info for a listener to decide whether to
// refetch, e.g. { session_id }) - clients refetch the real data over the
// normal REST API rather than trusting the push payload as a full state sync.
function broadcast(type, data = {}) {
    const payload = JSON.stringify({ type, ...data, ts: Date.now() });
    for (const res of clients) {
        res.write(`data: ${payload}\n\n`);
    }
}

function clientCount() {
    return clients.size;
}

module.exports = { addClient, removeClient, broadcast, clientCount };
