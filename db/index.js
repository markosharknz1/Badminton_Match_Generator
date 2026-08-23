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
    ensureBaselineDefaults, ensureColumns, backupToDocuments, listBackups,
};
