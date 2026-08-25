// Pure, DOM-free logic for the Rounds page's "Build round" designer -
// extracted out of manage.js so it can be unit tested in isolation
// (see roundBuilder.test.js) and so there is exactly one implementation of
// "which round should the designer show" and "how does a server refetch
// merge into local state", instead of two slightly different ones.
//
// Loads as a plain <script> tag in the browser (attaches nothing global
// itself - manage.js calls these via the functions below) and via
// require() in a Node test, hence the dual-export footer.

function emptyCourtState() {
    return { staged: null, draft: { format: 'doubles', side1: [], side2: [] }, editing: false };
}

function buildStagedIndex(serverStagedGames) {
    const byCourtId = new Map();
    for (const g of serverStagedGames) {
        const side1 = g.players.filter((p) => p.side === 1).map((p) => p.player_id);
        const side2 = g.players.filter((p) => p.side === 2).map((p) => p.player_id);
        byCourtId.set(g.court_id, { gameId: g.id, format: g.format, side1, side2 });
    }
    return byCourtId;
}

// The designer always builds one round ahead of whatever's on court
// (staging-ahead is intentional) - this is the one place that decides
// which round number that is, so every caller (initial load, SSE-driven
// refresh) agrees instead of drifting apart.
function resolveTargetRound(clientBuildRound, roundStatus) {
    return clientBuildRound && clientBuildRound >= roundStatus.next_round_number
        ? clientBuildRound
        : roundStatus.next_round_number;
}

// Merges a fresh "what's staged server-side" snapshot into the previous
// client state. Courts with nothing staged server-side keep whatever local
// draft they already had (a court only exists on the server once its own
// Save button has been clicked) - that's what stops saving one court from
// wiping the others, and stops an unrelated SSE refresh from doing the same.
// Switching to a different round always resets everything: an old round's
// drafts are meaningless once the designer has moved on.
function mergeBuilderState(prevState, serverStagedGames, sessionCourts, targetRound, prevTargetRound) {
    const stagedByCourtId = buildStagedIndex(serverStagedGames);
    const roundChanged = !prevState || prevTargetRound !== targetRound;
    const next = {};

    for (const c of sessionCourts) {
        const courtId = c.court_id;
        const serverStaged = stagedByCourtId.get(courtId) || null;
        const prev = roundChanged ? null : prevState[courtId];

        if (serverStaged) {
            const samePersistedGame = prev && prev.staged && prev.staged.gameId === serverStaged.gameId;
            if (samePersistedGame && prev.editing) {
                // Mid-edit on an already-staged court - don't clobber the in-progress edit.
                next[courtId] = prev;
            } else {
                next[courtId] = {
                    staged: serverStaged,
                    draft: { format: serverStaged.format, side1: [...serverStaged.side1], side2: [...serverStaged.side2] },
                    editing: false,
                };
            }
        } else if (prev && !prev.staged) {
            // No server record for this court - keep the unsaved local draft as-is.
            next[courtId] = prev;
        } else {
            next[courtId] = emptyCourtState();
        }
    }

    return next;
}

if (typeof module !== 'undefined') {
    module.exports = { resolveTargetRound, mergeBuilderState, emptyCourtState };
}
