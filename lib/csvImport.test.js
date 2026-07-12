// Isolated test harness for CSV import dedup logic - no DB, no server.
// Run with: node lib/csvImport.test.js
const assert = require('assert');
const { parseCsv, matchPlayer, planImport } = require('./csvImport');

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        passed++;
        console.log(`  PASS  ${name}`);
    } catch (err) {
        failed++;
        console.log(`  FAIL  ${name}`);
        console.log(`        ${err.message}`);
    }
}

// ---------------------------------------------------------------------------
console.log('\n=== parseCsv ===');

test('parses a simple header + rows', () => {
    const csv = 'first_name,last_name,email\nAlex,Nguyen,alex@example.com\nBailey,Smith,bailey@example.com\n';
    const rows = parseCsv(csv);
    assert.strictEqual(rows.length, 2);
    assert.deepStrictEqual(rows[0], { first_name: 'Alex', last_name: 'Nguyen', email: 'alex@example.com' });
    assert.strictEqual(rows[1].first_name, 'Bailey');
});

test('handles quoted fields containing commas', () => {
    const csv = 'first_name,last_name,notes\nAlex,Nguyen,"Prefers courts 1, 2, or 3"\n';
    const rows = parseCsv(csv);
    assert.strictEqual(rows[0].notes, 'Prefers courts 1, 2, or 3');
});

test('handles escaped double quotes inside quoted fields', () => {
    const csv = 'first_name,last_name,notes\nAlex,Nguyen,"Goes by ""Al"""\n';
    const rows = parseCsv(csv);
    assert.strictEqual(rows[0].notes, 'Goes by "Al"');
});

test('handles CRLF line endings', () => {
    const csv = 'first_name,last_name\r\nAlex,Nguyen\r\nBailey,Smith\r\n';
    const rows = parseCsv(csv);
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[1].last_name, 'Smith');
});

test('trims whitespace around unquoted values', () => {
    const csv = 'first_name, last_name \n Alex , Nguyen \n';
    const rows = parseCsv(csv);
    assert.strictEqual(rows[0].first_name, 'Alex');
    assert.strictEqual(rows[0].last_name, 'Nguyen');
});

test('missing trailing columns become empty strings', () => {
    const csv = 'first_name,last_name,email\nAlex,Nguyen\n';
    const rows = parseCsv(csv);
    assert.strictEqual(rows[0].email, '');
});

test('empty input returns no rows', () => {
    assert.deepStrictEqual(parseCsv(''), []);
});

test('header-only input returns no rows', () => {
    assert.deepStrictEqual(parseCsv('first_name,last_name\n'), []);
});

// ---------------------------------------------------------------------------
console.log('\n=== matchPlayer (rule-by-rule) ===');

const existing = [
    { id: 1, first_name: 'Alex', last_name: 'Nguyen', email: 'alex.nguyen@example.com', dob: '1990-01-10' },
    { id: 2, first_name: 'Bailey', last_name: 'Smith', email: 'bailey.smith@example.com', dob: '1988-05-02' },
    { id: 3, first_name: 'Casey', last_name: 'Patel', email: null, dob: '1995-03-20' },
];

test('rule 1: exact email match (case-insensitive) -> skip, even if name differs', () => {
    const row = { first_name: 'Alexandra', last_name: 'N', email: 'ALEX.NGUYEN@EXAMPLE.COM', dob: '2000-01-01' };
    const result = matchPlayer(row, existing);
    assert.strictEqual(result.action, 'skip');
    assert.strictEqual(result.reason, 'email match');
    assert.strictEqual(result.matchedPlayer.id, 1);
});

test('rule 2: no email match, falls back to name+DOB exact match -> skip', () => {
    const row = { first_name: 'Casey', last_name: 'Patel', email: '', dob: '1995-03-20' };
    const result = matchPlayer(row, existing);
    assert.strictEqual(result.action, 'skip');
    assert.strictEqual(result.reason, 'name+dob match');
    assert.strictEqual(result.matchedPlayer.id, 3);
});

test('rule 2: name+DOB match is case-insensitive on name', () => {
    const row = { first_name: 'casey', last_name: 'PATEL', email: '', dob: '1995-03-20' };
    const result = matchPlayer(row, existing);
    assert.strictEqual(result.action, 'skip');
});

test('rule 3: same name, different email AND different DOB -> review, not skip or create', () => {
    const row = { first_name: 'Alex', last_name: 'Nguyen', email: 'a.nguyen.new@example.com', dob: '1985-06-06' };
    const result = matchPlayer(row, existing);
    assert.strictEqual(result.action, 'review');
    assert.strictEqual(result.candidates.length, 1);
    assert.strictEqual(result.candidates[0].id, 1);
});

test('rule 3: same name, same-ish email missing but DOB differs -> review', () => {
    const row = { first_name: 'Bailey', last_name: 'Smith', email: '', dob: '1999-09-09' };
    const result = matchPlayer(row, existing);
    assert.strictEqual(result.action, 'review');
});

test('rule 4: no email or name match -> create', () => {
    const row = { first_name: 'Drew', last_name: 'Kim', email: 'drew.kim@example.com', dob: '1992-02-02' };
    const result = matchPlayer(row, existing);
    assert.strictEqual(result.action, 'create');
});

test('never overwrites: a skip result carries the existing record, not new field values', () => {
    const row = { first_name: 'Totally Different', last_name: 'Name', email: 'alex.nguyen@example.com', dob: '2020-01-01' };
    const result = matchPlayer(row, existing);
    assert.strictEqual(result.action, 'skip');
    assert.strictEqual(result.matchedPlayer.first_name, 'Alex'); // untouched
});

// ---------------------------------------------------------------------------
console.log('\n=== planImport (batch behaviour) ===');

test('membership_status comes from the batch parameter, not the CSV row', () => {
    const rows = [{ first_name: 'Drew', last_name: 'Kim', email: 'drew.kim@example.com', dob: '1992-02-02', membership_status: 'active' }];
    const plan = planImport(rows, [], 'guest');
    assert.strictEqual(plan.toCreate.length, 1);
    assert.strictEqual(plan.toCreate[0].player.membership_status, 'guest');
});

test('buckets a full mixed batch correctly', () => {
    const rows = [
        { first_name: 'Alex', last_name: 'Nguyen', email: 'alex.nguyen@example.com', dob: '1990-01-10' }, // skip: email
        { first_name: 'Casey', last_name: 'Patel', email: '', dob: '1995-03-20' }, // skip: name+dob
        { first_name: 'Bailey', last_name: 'Smith', email: 'new.bailey@example.com', dob: '2001-01-01' }, // review
        { first_name: 'Drew', last_name: 'Kim', email: 'drew.kim@example.com', dob: '1992-02-02' }, // create
    ];
    const plan = planImport(rows, existing, 'active');
    assert.strictEqual(plan.toSkip.length, 2);
    assert.strictEqual(plan.toReview.length, 1);
    assert.strictEqual(plan.toCreate.length, 1);
});

test('intra-batch duplicate: same person appearing twice in one file only creates once', () => {
    const rows = [
        { first_name: 'Jamie', last_name: 'Fox', email: 'jamie.fox@example.com', dob: '1993-04-04' },
        { first_name: 'Jamie', last_name: 'Fox', email: 'jamie.fox@example.com', dob: '1993-04-04' },
    ];
    const plan = planImport(rows, [], 'active');
    assert.strictEqual(plan.toCreate.length, 1);
    assert.strictEqual(plan.toSkip.length, 1);
    assert.strictEqual(plan.toSkip[0].reason, 'email match');
});

test('intra-batch near-duplicate (same name, different email) is flagged for review, not double-created', () => {
    const rows = [
        { first_name: 'Jordan', last_name: 'Lee', email: 'jordan.lee@example.com', dob: '1994-07-07' },
        { first_name: 'Jordan', last_name: 'Lee', email: 'jordan.lee.alt@example.com', dob: '1994-07-07' },
    ];
    const plan = planImport(rows, [], 'active');
    // first row: brand new name+dob -> create. second row: same name, DOB also matches this time
    // so it should skip via name+dob match against the just-created record, not fall through to review.
    assert.strictEqual(plan.toCreate.length, 1);
    assert.strictEqual(plan.toSkip.length, 1);
});

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
