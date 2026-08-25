// Isolated tests for the Rounds designer's round-selection and state-merge
// logic (see roundBuilder.js). Pure functions, no DB/DOM - run with:
// node public/roundBuilder.test.js
const assert = require('assert');
const { resolveTargetRound, mergeBuilderState, emptyCourtState } = require('./roundBuilder');

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

const COURTS = [{ court_id: 1, court_number: 1 }, { court_id: 2, court_number: 2 }, { court_id: 3, court_number: 3 }];

function stagedGame(id, courtId, format, side1, side2) {
    return {
        id,
        court_id: courtId,
        format,
        players: [
            ...side1.map((player_id) => ({ player_id, side: 1 })),
            ...side2.map((player_id) => ({ player_id, side: 2 })),
        ],
    };
}

console.log('\n=== resolveTargetRound ===');

test('idle/break with no client round yet -> next_round_number', () => {
    const target = resolveTargetRound(null, { next_round_number: 6 });
    assert.strictEqual(target, 6);
});

test('client already viewing a round still ahead of next -> stays put', () => {
    const target = resolveTargetRound(7, { next_round_number: 6 });
    assert.strictEqual(target, 7);
});

test('a round just activated (client stuck on it) -> advances past it, not stuck showing it', () => {
    // This is bug 1: round 6 just went from staged to active, so
    // next_round_number is now 7 - the designer must advance to 7, not
    // keep re-querying round 6 (which now holds 'active' games, not
    // 'staged' ones, and would render as an empty round 6 forever).
    const target = resolveTargetRound(6, { next_round_number: 7 });
    assert.strictEqual(target, 7);
});

test('a round just completed (client stuck on the one before it) -> advances to the empty next round', () => {
    const target = resolveTargetRound(5, { next_round_number: 6 });
    assert.strictEqual(target, 6);
});

console.log('\n=== mergeBuilderState ===');

test('first load with nothing staged -> every court empty', () => {
    const state = mergeBuilderState(null, [], COURTS, 6, null);
    assert.strictEqual(Object.keys(state).length, 3);
    for (const c of COURTS) assert.deepStrictEqual(state[c.court_id], emptyCourtState());
});

test('first load picks up already-staged courts from the server', () => {
    const staged = [stagedGame(101, 2, 'doubles', [10, 11], [12, 13])];
    const state = mergeBuilderState(null, staged, COURTS, 6, null);
    assert.strictEqual(state[2].staged.gameId, 101);
    assert.deepStrictEqual(state[2].draft.side1, [10, 11]);
    assert.deepStrictEqual(state[1], emptyCourtState());
});

test('saving court 2 does not wipe unsaved local drafts on courts 1 and 3', () => {
    // This is bug 2 reproduced directly: build all three courts locally,
    // then simulate court 2's save succeeding (it now shows up staged on
    // the server) and the resulting reload - courts 1 and 3 were never
    // saved, so the server has nothing for them, and their local drafts
    // must survive the reload untouched.
    const prev = {
        1: { staged: null, draft: { format: 'doubles', side1: [1, 2], side2: [3, 4] }, editing: false },
        2: { staged: null, draft: { format: 'doubles', side1: [10, 11], side2: [12, 13] }, editing: false },
        3: { staged: null, draft: { format: 'doubles', side1: [20, 21], side2: [22, 23] }, editing: false },
    };
    const staged = [stagedGame(101, 2, 'doubles', [10, 11], [12, 13])];
    const next = mergeBuilderState(prev, staged, COURTS, 6, 6);

    assert.deepStrictEqual(next[1].draft, prev[1].draft, 'court 1 draft must survive court 2 being saved');
    assert.deepStrictEqual(next[3].draft, prev[3].draft, 'court 3 draft must survive court 2 being saved');
    assert.strictEqual(next[2].staged.gameId, 101, 'court 2 should now reflect the persisted game');
});

test('an SSE refresh from another client does not wipe this client\'s unsaved drafts either', () => {
    // Same mechanism as above but framed as the SSE 'game' event path -
    // any reload while still on the same round must be non-destructive to
    // whatever hasn't been persisted yet, regardless of what triggered it.
    const prev = {
        1: { staged: null, draft: { format: 'doubles', side1: [1, 2], side2: [3, 4] }, editing: false },
        2: emptyCourtState(),
        3: emptyCourtState(),
    };
    const next = mergeBuilderState(prev, [], COURTS, 6, 6);
    assert.deepStrictEqual(next[1].draft, prev[1].draft);
});

test('an in-progress edit on an already-staged court is not clobbered by a same-game reload', () => {
    const staged = [stagedGame(101, 2, 'doubles', [10, 11], [12, 13])];
    const prev = {
        1: emptyCourtState(),
        2: {
            staged: { gameId: 101, format: 'doubles', side1: [10, 11], side2: [12, 13] },
            draft: { format: 'doubles', side1: [10, 99], side2: [12, 13] }, // mid-edit: swapped player 11 -> 99
            editing: true,
        },
        3: emptyCourtState(),
    };
    const next = mergeBuilderState(prev, staged, COURTS, 6, 6);
    assert.deepStrictEqual(next[2].draft, prev[2].draft, 'in-progress edit must survive a reload of the same persisted game');
    assert.strictEqual(next[2].editing, true);
});

test('a court unstaged elsewhere resets to empty rather than keeping stale staged data', () => {
    const prev = {
        1: emptyCourtState(),
        2: { staged: { gameId: 101, format: 'doubles', side1: [10, 11], side2: [12, 13] }, draft: { format: 'doubles', side1: [10, 11], side2: [12, 13] }, editing: false },
        3: emptyCourtState(),
    };
    const next = mergeBuilderState(prev, [], COURTS, 6, 6); // court 2's staged game is gone server-side
    assert.deepStrictEqual(next[2], emptyCourtState());
});

test('moving to a different round resets every court, even ones with unsaved drafts', () => {
    const prev = {
        1: { staged: null, draft: { format: 'doubles', side1: [1, 2], side2: [3, 4] }, editing: false },
        2: emptyCourtState(),
        3: emptyCourtState(),
    };
    const next = mergeBuilderState(prev, [], COURTS, 7, 6); // round advanced from 6 to 7
    for (const c of COURTS) assert.deepStrictEqual(next[c.court_id], emptyCourtState());
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
