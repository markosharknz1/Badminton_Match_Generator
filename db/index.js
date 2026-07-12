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

module.exports = { DB_PATH, SCHEMA_PATH, openDb, applySchema, saveDb, all, get };
