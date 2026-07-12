// Singleton in-memory sql.js connection for the running server process.
// Every mutating call persists to disk immediately (persist()) - this is a
// single-writer local app, not a high-throughput server, so simplicity and
// durability win over batching writes.
const { openDb, applySchema, saveDb, all, get } = require('./index');

let db = null;

async function init() {
    db = await openDb();
    applySchema(db); // safety net if db:init was never run
    return db;
}

function run(sql, params = []) {
    db.run(sql, params);
}

function insert(sql, params = []) {
    db.run(sql, params);
    return get(db, 'SELECT last_insert_rowid() AS id').id;
}

function query(sql, params = []) {
    return all(db, sql, params);
}

function queryOne(sql, params = []) {
    return get(db, sql, params);
}

function persist() {
    saveDb(db);
}

// Exposes the raw sql.js connection for modules that need to reuse the
// shared all()/get() query helpers directly (e.g. lib/autoGenerate.js, which
// is designed to run against any db handle so it can be unit-tested against
// a throwaway in-memory database instead of the real one).
function getDb() {
    return db;
}

module.exports = { init, run, insert, query, queryOne, persist, getDb };
