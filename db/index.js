const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const DB_PATH = path.join(__dirname, '..', 'game_scheduler.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

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

module.exports = { DB_PATH, SCHEMA_PATH, openDb, applySchema, saveDb, all, get, ensureBaselineDefaults };
