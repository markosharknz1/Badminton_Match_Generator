// CSV import / dedup-matching logic for the players roster.
// Deliberately pure functions (no DB, no Express) so the matching rules can
// be tested in isolation before any UI exists.

// --- CSV parsing (hand-rolled RFC4180-ish: quoted fields, "" escaped quotes,
// CRLF or LF line endings, no external dependency) ---
function parseCsv(text) {
    const rows = [];
    let field = '';
    let row = [];
    let inQuotes = false;
    let i = 0;
    const len = text.length;

    while (i < len) {
        const char = text[i];
        if (inQuotes) {
            if (char === '"') {
                if (text[i + 1] === '"') {
                    field += '"';
                    i += 2;
                } else {
                    inQuotes = false;
                    i++;
                }
            } else {
                field += char;
                i++;
            }
            continue;
        }
        if (char === '"') {
            inQuotes = true;
            i++;
        } else if (char === ',') {
            row.push(field);
            field = '';
            i++;
        } else if (char === '\r') {
            i++;
        } else if (char === '\n') {
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
            i++;
        } else {
            field += char;
            i++;
        }
    }
    if (field.length > 0 || row.length > 0) {
        row.push(field);
        rows.push(row);
    }

    // Drop fully-blank trailing rows (e.g. a trailing newline in the file).
    const nonBlank = rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
    if (nonBlank.length === 0) return [];

    const header = nonBlank[0].map((h) => h.trim());
    return nonBlank.slice(1).map((r) => {
        const obj = {};
        header.forEach((h, idx) => {
            obj[h] = (r[idx] ?? '').trim();
        });
        return obj;
    });
}

function normalizeEmail(email) {
    return (email || '').trim().toLowerCase();
}

function normalizeName(name) {
    return (name || '').trim().toLowerCase();
}

// Decide what to do with one CSV row against the current known set of players
// (existing DB rows plus anything already staged earlier in this same batch).
//
// Priority, per spec:
//   1. Exact email match (case-insensitive) -> skip, never overwrite.
//   2. No email match -> try name + DOB exact match -> skip, never overwrite.
//   3. Same name but different email/DOB -> flag "review", do not auto-skip or auto-create.
//   4. No match at all -> create.
function matchPlayer(row, knownPlayers) {
    const rowEmail = normalizeEmail(row.email);
    if (rowEmail) {
        const emailMatch = knownPlayers.find((p) => normalizeEmail(p.email) === rowEmail);
        if (emailMatch) {
            return { action: 'skip', reason: 'email match', matchedPlayer: emailMatch };
        }
    }

    const rowFirst = normalizeName(row.first_name);
    const rowLast = normalizeName(row.last_name);
    const rowDob = (row.dob || '').trim();

    if (rowDob) {
        const nameDobMatch = knownPlayers.find(
            (p) =>
                normalizeName(p.first_name) === rowFirst &&
                normalizeName(p.last_name) === rowLast &&
                (p.dob || '').trim() === rowDob
        );
        if (nameDobMatch) {
            return { action: 'skip', reason: 'name+dob match', matchedPlayer: nameDobMatch };
        }
    }

    const nameMatches = knownPlayers.filter(
        (p) => normalizeName(p.first_name) === rowFirst && normalizeName(p.last_name) === rowLast
    );
    if (nameMatches.length > 0) {
        return { action: 'review', reason: 'same name, different email/DOB', candidates: nameMatches };
    }

    return { action: 'create' };
}

// Runs matchPlayer over every row and buckets the result. batchMembershipStatus
// is applied to every created player - the CSV's own membership_status column
// (if present) is ignored, per spec: set from the import batch, not guessed per-row.
function planImport(rows, existingPlayers, batchMembershipStatus) {
    const toCreate = [];
    const toSkip = [];
    const toReview = [];

    // Players created earlier in this same batch must also be matchable by
    // later rows in the file (e.g. an accidental duplicate row), so we grow
    // a working copy rather than only matching against existingPlayers.
    const known = existingPlayers.slice();

    rows.forEach((row, index) => {
        const result = matchPlayer(row, known);
        if (result.action === 'skip') {
            toSkip.push({ rowIndex: index, row, reason: result.reason, matchedPlayer: result.matchedPlayer });
        } else if (result.action === 'review') {
            toReview.push({ rowIndex: index, row, reason: result.reason, candidates: result.candidates });
        } else {
            const newPlayer = {
                first_name: row.first_name?.trim() || '',
                last_name: row.last_name?.trim() || '',
                email: row.email?.trim() || null,
                phone: row.phone?.trim() || null,
                dob: row.dob?.trim() || null,
                skill_level: row.skill_level?.trim() || null,
                gender: row.gender?.trim() || null,
                membership_status: batchMembershipStatus,
                membership_number: row.membership_number?.trim() || null,
                notes: row.notes?.trim() || null,
            };
            toCreate.push({ rowIndex: index, row, player: newPlayer });
            known.push(newPlayer);
        }
    });

    return { toCreate, toSkip, toReview };
}

module.exports = { parseCsv, matchPlayer, planImport };
