// Exercises parseCsv + planImport against the real seeded players (db/seed.js),
// so the dedup logic is checked against realistic data before any UI exists.
// Run with: node lib/csvImport.sample.js
const { openDb, all } = require('../db/index');
const { parseCsv, planImport } = require('./csvImport');

async function main() {
    const db = await openDb();
    const existingPlayers = all(db, 'SELECT * FROM players');
    db.close();

    if (existingPlayers.length === 0) {
        console.error('No players found - run `npm run db:seed` first.');
        process.exit(1);
    }

    const emailMatchTarget = existingPlayers[0]; // e.g. Alex Nguyen
    const nameDobMatchTarget = existingPlayers[1]; // matched via name+dob, email left blank in the CSV
    const reviewTarget = existingPlayers[2]; // same name, different email + dob -> review

    const csv = [
        'first_name,last_name,email,phone,dob,skill_level,gender,membership_status,notes',
        `${emailMatchTarget.first_name},${emailMatchTarget.last_name},${emailMatchTarget.email.toUpperCase()},,,C,,active,"Already a member, should skip"`,
        `${nameDobMatchTarget.first_name},${nameDobMatchTarget.last_name},,,${nameDobMatchTarget.dob},C,,active,"No email on file for this row, should still match on name+dob"`,
        `${reviewTarget.first_name},${reviewTarget.last_name},not.on.file@example.com,,1970-01-01,C,,active,"Same name, different email/DOB - possible duplicate"`,
        'Morgan,Freeman,morgan.freeman@example.com,0210000000,1980-06-01,B,M,active,"Brand new player"',
        'Skylar,Reed,skylar.reed@example.com,0210000001,1999-11-11,D,F,active,"Also brand new"',
    ].join('\n');

    const rows = parseCsv(csv);
    const plan = planImport(rows, existingPlayers, 'active');

    console.log(`Parsed ${rows.length} CSV rows.\n`);

    console.log(`toSkip (${plan.toSkip.length}):`);
    for (const item of plan.toSkip) {
        console.log(`  - ${item.row.first_name} ${item.row.last_name}: ${item.reason} -> existing #${item.matchedPlayer.id} (${item.matchedPlayer.first_name} ${item.matchedPlayer.last_name})`);
    }

    console.log(`\ntoReview (${plan.toReview.length}):`);
    for (const item of plan.toReview) {
        console.log(`  - ${item.row.first_name} ${item.row.last_name} (${item.row.email}, ${item.row.dob}): ${item.reason}, candidates: #${item.candidates.map((c) => c.id).join(', #')}`);
    }

    console.log(`\ntoCreate (${plan.toCreate.length}):`);
    for (const item of plan.toCreate) {
        console.log(`  - ${item.player.first_name} ${item.player.last_name} <${item.player.email}> membership_status=${item.player.membership_status}`);
    }

    const expected = { toSkip: 2, toReview: 1, toCreate: 2 };
    const actual = { toSkip: plan.toSkip.length, toReview: plan.toReview.length, toCreate: plan.toCreate.length };
    const ok = JSON.stringify(expected) === JSON.stringify(actual);
    console.log(`\n${ok ? 'OK' : 'MISMATCH'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    if (!ok) process.exit(1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
