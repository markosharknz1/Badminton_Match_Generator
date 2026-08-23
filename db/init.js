const { openDb, applySchema, saveDb, ensureBaselineDefaults, ensureColumns, DB_PATH } = require('./index');

async function main() {
    const db = await openDb();
    applySchema(db);
    ensureBaselineDefaults(db);
    ensureColumns(db);
    saveDb(db);
    db.close();
    console.log(`Schema applied to ${DB_PATH}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
