const express = require('express');
const os = require('os');
const path = require('path');
const store = require('./db/store');

const playersRouter = require('./routes/players');
const sessionsRouter = require('./routes/sessions');
const attendanceRouter = require('./routes/attendance');
const courtsRouter = require('./routes/courts');
const clubSettingsRouter = require('./routes/clubSettings');
const sessionTemplatesRouter = require('./routes/sessionTemplates');
const eventsRouter = require('./routes/events');
const gamesRouter = require('./routes/games');
const roundsRouter = require('./routes/rounds');
const displayRouter = require('./routes/display');
const skillCompatibilityRouter = require('./routes/skillCompatibility');
const historyRouter = require('./routes/history');
const exportRouter = require('./routes/export');
const paymentCategoriesRouter = require('./routes/paymentCategories');
const scheduler = require('./lib/scheduler');

const PORT = process.env.PORT || 4000;

function localNetworkAddresses() {
    const nets = os.networkInterfaces();
    const addrs = [];
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) addrs.push(net.address);
        }
    }
    return addrs;
}

async function main() {
    await store.init();

    const app = express();
    app.use(express.json());

    app.get('/api/health', (req, res) => res.json({ ok: true }));

    app.use('/api/players', playersRouter);
    app.use('/api/sessions', sessionsRouter);
    app.use('/api', attendanceRouter);
    app.use('/api/courts', courtsRouter);
    app.use('/api/club-settings', clubSettingsRouter);
    app.use('/api/session-templates', sessionTemplatesRouter);
    app.use('/api/events', eventsRouter);
    app.use('/api', gamesRouter);
    app.use('/api', roundsRouter);
    app.use('/api', displayRouter);
    app.use('/api/skill-compatibility', skillCompatibilityRouter);
    app.use('/api/history', historyRouter);
    app.use('/api/export', exportRouter);
    app.use('/api/payment-categories', paymentCategoriesRouter);

    app.use(express.static(path.join(__dirname, 'public')));
    app.get('/', (req, res) => res.redirect('/checkin.html'));

    app.use((err, req, res, next) => {
        console.error(err);
        res.status(400).json({ error: err.message });
    });

    // Bind to 0.0.0.0, not localhost, so the display screen can be reached
    // from a TV/other device on the club's wifi from day one.
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Game Scheduler API listening on port ${PORT}`);
        console.log(`  Local:   http://localhost:${PORT}`);
        for (const addr of localNetworkAddresses()) {
            console.log(`  Network: http://${addr}:${PORT}`);
        }
    });

    scheduler.start();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
