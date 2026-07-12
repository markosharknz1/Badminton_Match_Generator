# Game Scheduler — Progress / Handoff Doc

Read this first if you're picking up this project in a new conversation.

## What this is

A locally-installed app for running **adult badminton club sessions**: check
players in, track who's waiting, build or auto-generate court games with
skill/gender balancing, and track payment per player per session. Separate
codebase/database from an existing **junior training-session app** that also
lives on this machine at `C:\Claude\badminton_club` (Python/Flask) — that one
is untouched and out of scope; don't read or modify it.

## Stack & non-negotiables (from the original spec)

- Node.js + Express + **sql.js** (pure-JS SQLite — avoids native build tools
  that broke `better-sqlite3` on Windows previously)
- Fully local, no cloud dependency, transportable via file copy (OneDrive
  sync between machines — not git, though a GitHub repo now also exists,
  see below)
- Single project folder, own `package.json`, own `.db` file
- Server binds to `0.0.0.0` (not just localhost) so a TV on the club wifi can
  reach the `/display.html` kiosk screen

## How to run it

```
cd C:\Claude\Game_Scheduler
node server.js
```
Open **http://localhost:4000** (port changed from the original 3000 — user
asked for a non-3000 port; override anytime with `set PORT=xxxx`).

Leave the terminal window open — closing it stops the server, which freezes
session timers mid-session (by design, per spec; the UI should eventually
warn about this but currently doesn't visibly).

To reseed fresh demo data at any time (wipes and rebuilds all tables):
```
node db/seed.js
```
Seeds 24 fake players, 7 courts, 6 payment categories, 4 session templates
(Monday evening/manual, Thursday morning/auto, Thursday evening/manual,
**Friday social**), one open "Monday evening" session with 16 players
checked in and one completed round.

Test suites (all pure, isolated, no shared state with the real dev db):
```
npm run csv:test       # CSV import dedup logic (19 tests)
npm run autogen:test   # auto-generate algorithm (12 tests)
npm run report:test    # Excel export / peak-concurrent metric (7 tests)
```

## Repository

Pushed to GitHub: **https://github.com/markosharknz1/Badminton_Match_Generator**
(private). One commit so far (the whole build). `.gitignore` excludes
`node_modules/`, `*.log`, `game_scheduler.db`, `exports/`. Push new commits
yourself, or ask Claude to.

## Build status — all done

The app was built in the 12 layers below (each built, curl/browser-tested,
and verified working before moving to the next), plus follow-on feature
requests after the initial build.

| # | Layer | Status |
|---|---|---|
| 1 | DB schema + migrations + seed + verify | ✅ |
| 2 | Core CRUD API (players, sessions, attendance, courts, club settings) | ✅ |
| 3 | CSV import + dedup logic | ✅ |
| 4 | Session templates + "same as usual"/"need to change something" start flow | ✅ |
| 5 | Check-in flow UI (two-table layout, double-click add/remove) | ✅ |
| 6 | Real-time sync (SSE) across all tabs | ✅ |
| 7 | Manual game builder (drag-and-drop, staged future rounds) | ✅ |
| 8 | Auto-generate algorithm + unattended scheduler | ✅ |
| 9 | Read-only kiosk Display screen | ✅ |
| 10 | Club management page (settings, courts, skill matrix, templates, CSV import) | ✅ |
| 11 | Session history / audit view | ✅ |
| 12 | Excel session-trend export | ✅ |
| — | **Follow-on: third "social" session mode** (check-in + payment only, no rounds) | ✅ |
| — | **Follow-on: full payment-category system** (Member/Non-Member/Concession/etc., per-template pricing, "Other + note" for free entries, "first time" flag) | ✅ |
| — | **Follow-on: payment tracking made optional**, gated by `club_settings.square_enabled` toggle | ✅ |
| — | **Follow-on: port changed** from 3000 default to 4000 default | ✅ |
| — | **Follow-on: pushed to GitHub** (private repo) | ✅ |

Every feature above was verified end-to-end (curl for API correctness, then
live in a browser via the preview tools) before being marked done. Two real
bugs were caught and fixed during that verification (see "Bugs found and
fixed" below) — this is a good pattern to keep using for any future changes.

## File map

```
db/
  schema.sql        - full schema, single source of truth
  index.js          - sql.js open/save/query helpers (all/get functions)
  store.js          - singleton in-memory connection used by the running server
  init.js, seed.js, verify.js  - npm run db:init / db:seed / db:verify
lib/
  eventBus.js        - SSE pub/sub (broadcast/addClient/removeClient)
  roundLifecycle.js  - round state machine (start/end game/break), shared by
                        manual buttons AND the scheduler AND auto-generate
  autoGenerate.js    - pure, read-only game-generation algorithm (+ .test.js)
  scheduler.js       - setInterval loop driving unattended round rotation
  csvImport.js       - pure dedup/parsing logic (+ .test.js, .sample.js)
  sessionReport.js   - Excel export metrics incl. peak-concurrent sweep (+ .test.js)
routes/               - one file per resource, thin Express handlers over db/store.js
public/
  checkin.html/.js    - check-in screen (also hosts payment recording modal)
  manage.html/.js     - "Rounds" screen (round controls + game builder + payment-rate-aware? no)
  display.html/.js    - kiosk display
  club.html/.js       - club settings, courts, skill matrix, payment categories, templates, CSV import
  history.html/.js    - session history + Excel export UI
  events.js           - shared `subscribeToEvents()` SSE client helper
  style.css           - one shared stylesheet for all staff pages (display.html has its own inline styles)
server.js              - wires all routers, binds 0.0.0.0:4000, starts scheduler
```

## Key design decisions already made (don't re-litigate these)

- **Skill compatibility matrix is symmetric**, not directional (spec flagged
  this as an open question; symmetric was the stated default and nobody's
  asked to change it).
- **No separate gender-compatibility toggle** — folded into general
  skill/gender balancing in the auto-generate algorithm, not a distinct grid.
- **`pairing_rules` has no `session_id` column** — `session_only` scope rules
  can't actually be tied to one specific session with the current schema, so
  `autoGenerate.js` treats every pairing rule as always-active regardless of
  scope. Flagged in a code comment. Would need a schema addition if a club
  actually needs session-scoped rules.
- **Recent-pairing lookback window is fixed at 4 rounds**, not yet
  club-editable (spec listed this as an open decision; punted).
- **Payment categories are club-wide and editable** from the Club page
  (add/rename/reorder/deactivate/delete-if-unused) but **prices are set per
  session template**, not club-wide — Friday social is deliberately cheaper
  than Monday evening in the seed data to prove this works.
- **"First time" is a simple boolean flag** on attendance (`first_time`),
  not a priced category and not a discount modifier on other categories —
  user was explicit: "just a flag to show that we have new people."
- **Social mode sessions never enter round/game logic at all** — no
  `current_phase` transitions ever happen (`phase_ends_at` stays null so the
  scheduler naturally skips them), the Rounds page shows an explanatory
  message instead of controls, and the API rejects round-start attempts with
  a clear 400 error as a defense-in-depth backstop.
- **Payment tracking is fully optional**, gated by the pre-existing
  `club_settings.square_enabled` checkbox (relabeled "Track payments..." on
  the Club page). When off: no Payment column on check-in, no rates fetched,
  everything behaves exactly like before the payment feature existed. When
  on: full category+amount+note+first-time recording via a modal, opened by
  clicking a player's payment cell in the "Here today" table.
- **The old simple `attendance.payment_method` enum (cash/card/voucher/
  other) was removed entirely**, replaced by the richer
  `payment_category_id` + `payment_amount_cents` + `payment_note` +
  `first_time` columns. This app only *records* what was charged for the
  club's own tracking — it does not process real payments; Square (or cash,
  physically) handles the actual transaction.
- **Removing a player mid-session** (double-click on "Here today" →
  confirm) sets `state='left'`, `left_reason='removed'`, and cleanly detaches
  them from any *staged* (not yet played) future-round games — active/
  completed games are never touched, preserving the audit trail. This cascade
  lives in `routes/attendance.js`'s PUT handler.

## Bugs found and fixed during verification (context for future debugging)

1. **Seed script court-ID bug**: assumed court row IDs equal `court_number`
   (only true on a totally empty DB); broke on reseed because courts use
   `AUTOINCREMENT`. Fixed by capturing real inserted IDs and resetting
   `sqlite_sequence` at the top of `seed.js` for deterministic reseeds.
2. **Auto-generate double-booking bug**: `generateRound()`'s player pool
   only checked `attendance.state = 'here_today'`, not whether a player was
   already claimed by another *staged* game in the same round (staging
   deliberately doesn't change attendance state). Surfaced by the "Auto-
   generate round" button in the Rounds builder when filling remaining empty
   courts after a partial manual build. Fixed with a `NOT IN (...)`
   exclusion subquery; regression test added in `autoGenerate.test.js`.

## Explicitly NOT built yet / deferred

- **"Finish session" feature** — the spec describes a close-out sequence
  (auto-move stragglers to `left`, stop the scheduler, flip `status='closed'`,
  show a summary screen with peak headcount / rounds played / payment
  breakdown by category). This was deferred at check-in-screen build time
  (step 5) and never circled back to. Sessions currently get closed via a
  raw `PUT /api/sessions/:id {status:"closed"}` call (works fine via API/
  curl, no dedicated UI button or summary screen exists yet). **This is
  probably the most valuable next thing to build** — it would also be the
  natural place to surface the payment-category breakdown the spec asks for.
- **No README / setup docs** — spec calls for docs covering the Windows
  firewall prompt on first LAN bind, the QR-code-for-TV workflow, and the
  OneDrive cross-machine sync gotchas (don't run the app on two machines
  against the same `.db` file simultaneously).
- **Directional skill compatibility** — not built, symmetric only (see above).
- **Club-editable recent-pairing lookback window** — not built, fixed at 4.
- **`pairing_rules` session-scoping** — not built (see schema gap above).
- **Display screen has no special handling for social-mode sessions** — it
  falls back naturally (shows all courts as "free" forever, full waiting
  list) since no games are ever created, which is a reasonable default but
  wasn't purpose-built.

## Testing/verification pattern established this whole build

For any change: reseed (`node db/seed.js`) → restart server → test the raw
API via `curl` first (fast, precise) → then verify live in the browser via
the preview tools → check `read_console_messages` for JS errors → clean up
(stop test server, reseed fresh data) before ending the turn. Keep using
this — it caught both real bugs listed above.

## Environment quirks worth knowing

- **Browser pane screenshots often time out** on this project's pages (a
  recurring tooling quirk this whole session, not a bug in the app). When
  that happens, fall back to `read_page`/`get_page_text` and
  `javascript_tool` DOM inspection instead of `computer{action:"screenshot"}`
  — this has reliably worked as a substitute throughout the build.
- **`preview_start` with `{name: "game-scheduler"}`** uses
  `C:\Claude\.claude\launch.json` (already configured, port 4000). Using
  `{url: "http://localhost:4000/..."}` against a server already started via
  Bash also works and was more reliable in at least one session where the
  named-preview route seemed to serve stale state — if the browser pane ever
  shows data that doesn't match what you just seeded, suspect a stale/zombie
  server process and start fresh with `Get-Process node | Stop-Process
  -Force` before retrying.
- The Windows/git-bash path translation (`/c/Users/...` vs `C:\Users\...`)
  trips up Node scripts invoked from Bash with Unix-style paths — use
  relative paths or proper Windows paths when a Node one-liner needs to read
  a file written via a bash heredoc/redirect.

## Suggested next steps (pick one, or something else)

1. Build "Finish session" (close-out + summary screen with payment
   breakdown) — biggest remaining spec gap.
2. Write the README / setup docs (firewall, QR code, OneDrive workflow).
3. Whatever new feature request comes up — this doc plus the code itself
   should be enough context to continue without re-deriving the whole
   history above.
