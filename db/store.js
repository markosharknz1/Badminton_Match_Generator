// Singleton in-memory sql.js connection for the running server process.
// Every mutating call persists to disk immediately (persist()) - this is a
// single-writer local app, not a high-throughput server, so simplicity and
// durability win over batching writes.
const { openDb, applySchema, saveDb, ensureBaselineDefaults, ensureColumns, markLegacyAdhocCategoriesSystem, backfillSportsVoucherMethod, closeStaleOpenSessions, backupToDocuments, all, get } = require('./index');

let db = null;

async function init() {
    db = await openDb();
    applySchema(db); // safety net if db:init was never run
    ensureBaselineDefaults(db); // self-heals a schema-only DB (e.g. demo data declined at install)
    ensureColumns(db); // retrofits columns added after this DB was first created
    markLegacyAdhocCategoriesSystem(db); // hide the old Cash/Card/Voucher categories from Settings, keep history intact
    backfillSportsVoucherMethod(db); // any Sports Voucher payment saved before this was tracked
    closeStaleOpenSessions(db); // yesterday's session left open overnight doesn't block tonight's
    saveDb(db);
    backupToDocuments(); // one safety-net copy per launch to Documents\GameScheduler\backups
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
