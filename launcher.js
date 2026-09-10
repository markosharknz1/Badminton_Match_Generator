// Game Scheduler launcher - started by "Game Scheduler.cmd".
//
// Starts the server (server.js, unchanged), opens the app in a chromeless
// Edge/Chrome app window, and stops the server when that window closes.
// There is deliberately no packaged executable: the previous PyInstaller
// launcher was flagged as a trojan by Windows Defender's heuristics purely
// for being a self-extracting bundle. This is plain Node.js and the
// browser already on the machine.
//
// Runs itself twice: the .cmd starts it with a console window, and this
// immediately re-launches itself detached with no window and exits, so
// the console closes while the app keeps running.
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { findBrowser, openAppWindow } = require('./lib/appWindow');

const BASE_DIR = __dirname;
const LOG_DIR = path.join(BASE_DIR, 'logs');
const PID_FILE = path.join(LOG_DIR, 'server.pid');
const PORT = 4000;
const APP_URL = `http://localhost:${PORT}/checkin.html`;

function timestamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function log(message) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(path.join(LOG_DIR, 'run.log'), `${timestamp()}  ${message}\n`);
}

// No console to print to, so the one visible failure surface is a real
// dialog - otherwise a failure just looks like nothing happened.
function dialog(title, message, icon = 'Error') {
    const script = `Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show(${JSON.stringify(message)}, ${JSON.stringify(title)}, 'OK', '${icon}') | Out-Null`;
    spawnSync('powershell', ['-NoProfile', '-Command', script], { windowsHide: true });
}

function fatal(message) {
    log(`FATAL: ${message}`);
    dialog('Game Scheduler failed to start', message);
    process.exit(1);
}

function portOpen(port) {
    return new Promise((resolve) => {
        const socket = net.createConnection({ host: '127.0.0.1', port });
        socket.once('connect', () => { socket.destroy(); resolve(true); });
        socket.once('error', () => resolve(false));
        socket.setTimeout(300, () => { socket.destroy(); resolve(false); });
    });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ensureAppFiles() {
    const missing = ['server.js', 'db', 'public', 'node_modules'].filter((name) => !fs.existsSync(path.join(BASE_DIR, name)));
    if (missing.length) {
        fatal(`Game Scheduler must be run from inside its own folder - it looks like only part of it is here:\n\n${BASE_DIR}\n\nMissing: ${missing.join(', ')}\n\nDownload the full GameScheduler ZIP from the Releases page, extract it anywhere, and run "Game Scheduler.cmd" from inside that folder.`);
    }
}

function ensureDatabase() {
    // db/init.js is idempotent and additive-only - always safe to run.
    const result = spawnSync(process.execPath, [path.join('db', 'init.js')], { cwd: BASE_DIR, encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) {
        log(`db init failed: ${result.stdout}\n${result.stderr}`);
        fatal(`Could not set up the database:\n\n${(result.stderr || '').slice(0, 500)}`);
    }
}

// First-run convenience: a desktop shortcut to the .cmd, with the app icon.
// Best-effort - never stops the app from launching. Idempotent: never
// overwrites one the user moved, renamed, or kept.
function ensureDesktopShortcut() {
    try {
        const script = `
            $shell = New-Object -ComObject WScript.Shell
            $desktop = $shell.SpecialFolders('Desktop')
            $lnk = Join-Path $desktop 'Game Scheduler.lnk'
            if (Test-Path $lnk) { exit 0 }
            $s = $shell.CreateShortcut($lnk)
            $s.TargetPath = ${JSON.stringify(path.join(BASE_DIR, 'Game Scheduler.cmd'))}
            $s.WorkingDirectory = ${JSON.stringify(BASE_DIR)}
            $s.IconLocation = ${JSON.stringify(path.join(BASE_DIR, 'app_icon.ico'))}
            $s.Description = 'Game Scheduler'
            $s.WindowStyle = 7
            $s.Save()
            Write-Output 'created'`;
        const result = spawnSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8', windowsHide: true });
        if ((result.stdout || '').includes('created')) log('Created desktop shortcut.');
    } catch (err) {
        log(`Could not create a desktop shortcut (non-fatal): ${err.message}`);
    }
}

async function startServer() {
    if (await portOpen(PORT)) {
        log(`Server already running on port ${PORT} - reusing it.`);
        return null;
    }
    log('Starting server...');
    const out = fs.openSync(path.join(LOG_DIR, 'server.out.log'), 'w');
    const err = fs.openSync(path.join(LOG_DIR, 'server.err.log'), 'w');
    const server = spawn(process.execPath, ['server.js'], {
        cwd: BASE_DIR,
        stdio: ['ignore', out, err],
        windowsHide: true,
        env: { ...process.env, GAME_SCHEDULER_APP_WINDOW: '1' },
    });
    fs.writeFileSync(PID_FILE, String(server.pid));
    for (let i = 0; i < 50; i++) {
        if (await portOpen(PORT)) {
            log(`Server ready on port ${PORT} (pid ${server.pid}).`);
            return server;
        }
        await sleep(300);
    }
    server.kill();
    try { fs.unlinkSync(PID_FILE); } catch (e) { /* already gone */ }
    fatal('The server did not start in time.\n\nSee logs\\server.err.log for details.');
    return null;
}

function stopServer(server) {
    if (!server) {
        log('Server was reused from another window - leaving it running.');
        return;
    }
    if (server.exitCode !== null) {
        log('Server already stopped (e.g. via Stop.bat) - nothing to do.');
        return;
    }
    log(`Stopping server (pid ${server.pid})...`);
    server.kill();
    try { fs.unlinkSync(PID_FILE); } catch (e) { /* already gone */ }
    log('Server stopped.');
}

async function main() {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    log('--- Game Scheduler launched ---');
    ensureAppFiles();
    ensureDatabase();
    ensureDesktopShortcut();

    const server = await startServer();

    const browser = findBrowser();
    if (!browser) {
        // No Edge or Chrome - fall back to whatever the default browser is.
        // We can't tell when that window closes, so the server stays up
        // until Stop.bat; say so.
        log('No Edge/Chrome found - opening in the default browser.');
        spawn('cmd', ['/c', 'start', '', APP_URL], { windowsHide: true, stdio: 'ignore' }).unref();
        dialog('Game Scheduler', 'Opened in your default browser (Microsoft Edge or Google Chrome wasn\'t found, so the app can\'t open in its own window).\n\nWhen you\'re finished for the night, run Stop.bat to stop the server.', 'Information');
        return;
    }

    log(`Opening app window with ${browser}`);
    const win = openAppWindow(browser, APP_URL, { width: 1280, height: 800 });
    win.on('exit', () => {
        log('App window closed.');
        stopServer(server);
        process.exit(0);
    });
}

if (process.argv.includes('--background')) {
    main().catch((err) => fatal(`Unexpected error: ${err.message}`));
} else {
    const child = spawn(process.execPath, [__filename, '--background'], {
        cwd: BASE_DIR,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
    });
    child.unref();
}
