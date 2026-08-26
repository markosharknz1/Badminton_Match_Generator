const fs = require('fs');
const os = require('os');
const path = require('path');
const initSqlJs = require('sql.js');

const DB_PATH = path.join(__dirname, '..', 'game_scheduler.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');
const BACKUP_DIR = path.join(os.homedir(), 'Documents', 'GameScheduler', 'backups');
const BACKUPS_TO_KEEP = 30; // roughly a month of daily backups before old ones are pruned

let SQL = null;

async function openDb() {
    if (!SQL) {
        SQL = await initSqlJs();
    }
    if (fs.existsSync(DB_PATH)) {
        const fileBuffer = fs.readFileSync(DB_PATH);
        return new SQL.Database(fileBuffer);
    }
    return new SQL.Database();
}

function applySchema(db) {
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
    db.run(schema);
}

function saveDb(db) {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// Inserts the rows the app hard-requires to function (club settings row,
// courts list, payment category list, skill compatibility grid) if - and
// only if - each table is currently empty. This is distinct from
// db/seed.js's fake demo data (players/sessions/templates): those are
// optional and destructive (wipe-then-insert), these are required and
// additive-only, so it's always safe to call this on every server boot as
// well as from db/init.js. Without it, a schema-only DB (the normal result
// of running db:init and declining the demo-data prompt) leaves the Club
// page unable to load - club_settings has no row 1, so every page load
// fails with "Cannot read properties of null (reading 'club_name')".
function ensureBaselineDefaults(db) {
    const count = (table) => all(db, `SELECT COUNT(*) AS n FROM ${table}`)[0].n;

    if (count('club_settings') === 0) {
        db.run(`INSERT INTO club_settings (id) VALUES (1)`); // schema DEFAULTs fill the rest
    }

    if (count('courts') === 0) {
        for (let n = 1; n <= 7; n++) {
            db.run(`INSERT INTO courts (court_number, label, is_active) VALUES (?, NULL, 1)`, [n]);
        }
    }

    if (count('payment_categories') === 0) {
        const names = ['Member', 'Non-Member', 'Member Concession', 'Non-member Concession', 'Sports Voucher', 'Other'];
        names.forEach((name, i) => db.run(`INSERT INTO payment_categories (name, sort_order) VALUES (?, ?)`, [name, i]));
    }

    if (count('skill_compatibility') === 0) {
        const grades = ['A', 'B', 'C', 'D', 'E'];
        const rank = Object.fromEntries(grades.map((g, i) => [g, i]));
        for (const a of grades) {
            for (const b of grades) {
                const allowed = Math.abs(rank[a] - rank[b]) <= 1 ? 1 : 0;
                db.run(`INSERT INTO skill_compatibility (skill_a, skill_b, allowed) VALUES (?, ?, ?)`, [a, b, allowed]);
            }
        }
    }
}

// The club's own payment_categories are membership tiers (Member,
// Non-Member, Concession, etc.) - the right fit for a recurring session
// started from a template, but jarring for a genuine one-off/walk-in event
// where nobody has a membership tier to pick from. Ad-hoc sessions use these
// generic payment-method categories instead (see routes/sessions.js's ad-hoc
// POST /sessions). Idempotent by name, so re-running never duplicates them
// and a club is free to rename/deactivate them afterward like any other
// category.
const ADHOC_PAYMENT_CATEGORY_NAMES = ['Cash', 'Card', 'Voucher', 'Other'];

function ensureAdhocPaymentCategories(db) {
    const existingNames = new Set(all(db, 'SELECT name FROM payment_categories').map((r) => r.name));
    const maxSortOrder = all(db, 'SELECT MAX(sort_order) AS m FROM payment_categories')[0].m ?? -1;
    let nextSortOrder = maxSortOrder + 1;
    for (const name of ADHOC_PAYMENT_CATEGORY_NAMES) {
        if (!existingNames.has(name)) {
            db.run('INSERT INTO payment_categories (name, sort_order) VALUES (?, ?)', [name, nextSortOrder]);
            nextSortOrder++;
        }
    }
}

// A session left 'open' overnight (staff forgot "Finish session", or the
// computer was just switched off without it) would otherwise block every
// future session forever - only one 'open' session is ever allowed at a
// time (see routes/sessions.js), so the next club night's "Start session"
// hits a 409 until someone manually finishes yesterday's. The app has no
// way to run code exactly at midnight while the computer is off, so instead
// this runs on every boot (same idiom as ensureBaselineDefaults) and closes
// any 'open' session whose date isn't today's UTC date - by the time the
// app is opened again, "today" has moved on regardless of exactly when
// the computer was shut down. Mirrors exactly what the manual "Finish
// session" button does (status -> 'closed', nothing else) - a session
// closed this way still shows in History with whatever games/attendance it
// had at closing time. The live scheduler (lib/scheduler.js) does the same
// check on a timer for the rarer case where the computer is left on
// through midnight instead of shut down.
function closeStaleOpenSessions(db) {
    const today = new Date().toISOString().slice(0, 10);
    const stale = all(db, `SELECT id FROM sessions WHERE status = 'open' AND date < ?`, [today]);
    for (const { id } of stale) {
        db.run(`UPDATE sessions SET status = 'closed' WHERE id = ?`, [id]);
    }
    return stale.length;
}

// Adds columns introduced after a database was first created, since
// `CREATE TABLE IF NOT EXISTS` in schema.sql only affects brand-new tables -
// it never retrofits an existing one. Additive-only and idempotent (checks
// PRAGMA table_info first), so it's always safe to call on every server boot
// alongside ensureBaselineDefaults, and never touches existing data.
function ensureColumns(db) {
    const attendanceCols = all(db, `PRAGMA table_info(attendance)`).map((c) => c.name);
    if (!attendanceCols.includes('new_member')) {
        db.run(`ALTER TABLE attendance ADD COLUMN new_member INTEGER NOT NULL DEFAULT 0 CHECK (new_member IN (0,1))`);
    }

    const clubSettingsCols = all(db, `PRAGMA table_info(club_settings)`).map((c) => c.name);
    const newClubSettingsCols = [
        'smtp2go_api_key', 'smtp2go_sender_email', 'smtp2go_sender_name',
        'square_access_token', 'square_location_id',
    ];
    for (const col of newClubSettingsCols) {
        if (!clubSettingsCols.includes(col)) {
            db.run(`ALTER TABLE club_settings ADD COLUMN ${col} TEXT`);
        }
    }
    if (!clubSettingsCols.includes('gender_aware_pairing')) {
        // On by default - auto-generate prefers mixed pairs / same-gender
        // courts over 3-1 or segregated-sides splits (see lib/autoGenerate.js).
        db.run(`ALTER TABLE club_settings ADD COLUMN gender_aware_pairing INTEGER NOT NULL DEFAULT 1 CHECK (gender_aware_pairing IN (0,1))`);
    }
    if (!clubSettingsCols.includes('club_icon_ver')) {
        // Bumped by routes/branding.js on every icon upload - lets every page
        // cache-bust the favicon/logo without needing a live push.
        db.run(`ALTER TABLE club_settings ADD COLUMN club_icon_ver INTEGER NOT NULL DEFAULT 0`);
    }

    const templateCols = all(db, `PRAGMA table_info(session_templates)`).map((c) => c.name);
    for (const col of ['default_game_minutes', 'default_break_minutes']) {
        if (!templateCols.includes(col)) {
            db.run(`ALTER TABLE session_templates ADD COLUMN ${col} INTEGER`);
        }
    }
}

// Copies the live database to Documents\GameScheduler\backups, timestamped,
// so real club data isn't only ever stored in one place. Runs once per
// server boot (see db/store.js) - club nights happen periodically, not
// continuously, so "one backup per launch" gives a natural daily-ish
// cadence without spamming a backup on every single write. Prunes down to
// the newest BACKUPS_TO_KEEP afterward so the folder doesn't grow forever.
// Never throws - a failed backup (e.g. no Documents folder, disk full)
// should never stop the app from starting.
function backupToDocuments() {
    try {
        if (!fs.existsSync(DB_PATH)) return null;
        fs.mkdirSync(BACKUP_DIR, { recursive: true });

        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = path.join(BACKUP_DIR, `game_scheduler_${stamp}.db`);
        fs.copyFileSync(DB_PATH, backupPath);

        const files = fs.readdirSync(BACKUP_DIR)
            .filter((f) => f.startsWith('game_scheduler_') && f.endsWith('.db'))
            .sort(); // ISO timestamps in the filename sort chronologically
        const toDelete = files.slice(0, Math.max(0, files.length - BACKUPS_TO_KEEP));
        for (const f of toDelete) fs.unlinkSync(path.join(BACKUP_DIR, f));

        return backupPath;
    } catch (err) {
        console.error('Backup to Documents failed (non-fatal):', err.message);
        return null;
    }
}

function listBackups() {
    if (!fs.existsSync(BACKUP_DIR)) return [];
    return fs.readdirSync(BACKUP_DIR)
        .filter((f) => f.startsWith('game_scheduler_') && f.endsWith('.db'))
        .map((f) => {
            const stat = fs.statSync(path.join(BACKUP_DIR, f));
            return { name: f, size_bytes: stat.size, created_at: stat.mtime.toISOString() };
        })
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

// Runs a SELECT and returns an array of plain row objects.
function all(db, sql, params = []) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
        rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
}

function get(db, sql, params = []) {
    const rows = all(db, sql, params);
    return rows[0] || null;
}

module.exports = {
    DB_PATH, SCHEMA_PATH, BACKUP_DIR, openDb, applySchema, saveDb, all, get,
    ensureBaselineDefaults, ensureColumns, ensureAdhocPaymentCategories, closeStaleOpenSessions, backupToDocuments, listBackups,
    ADHOC_PAYMENT_CATEGORY_NAMES,
};
