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

**Double-click `Run.bat`** — that's the only file end users ever need to
touch, first run or the hundredth. It opens the app in a real native window
via `launcher.py`/pywebview (Windows' built-in WebView2, not a browser tab),
and closing that window stops everything cleanly (server included) — no
console window, no leftover background process.

The *first* time it's run on a machine (or if Node.js/Python/pywebview are
missing), `Run.bat` shows a brief setup screen: installs Node.js and Python
via `winget` if needed, installs `pywebview`, and applies the DB schema
(idempotent, safe to re-run, never touches real data). Every run after that
is instant and silent - no setup screen, no console flash. There's no
separate `Install.bat` any more; it was folded into `Run.bat` specifically
so downloading a release and getting the app running is one double-click,
not two.

Manual equivalent (what the scripts wrap), useful when debugging:
```
cd C:\Claude\Game_Scheduler
node server.js
```
Open **http://localhost:4000** (port changed from the original 3000 — user
asked for a non-3000 port; override anytime with `set PORT=xxxx`).

Leave that window open — closing it stops the server, which freezes session
timers mid-session (by design, per spec).

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
(private). `.gitignore` excludes `*.log`, `game_scheduler.db`, `exports/` —
**`node_modules/` is deliberately committed** (see design decisions below),
so this is one of the rare Node projects where you should *not* gitignore it.
Push new commits yourself, or ask Claude to.

### Working on this remotely via claude.ai (not just this local Claude Code setup)

The repo is already set up for this - connect it once via claude.ai's
GitHub connector (Settings → Connectors → GitHub, authorize, pick this
repo), then a claude.ai chat can read/edit/commit to it directly.

Two things to know before doing this:
1. **Read this whole file first** in that remote session - it's written
   for exactly this purpose (a fresh session with no memory of the build).
2. **A plain claude.ai chat almost certainly can't run/test Node code the
   way Claude Code does here** (no persistent server, no real browser to
   click through). Treat remote edits as *proposed* changes: `git pull`
   them locally afterward and actually run the app (or ask Claude Code to)
   before trusting them - this project's whole history so far has been
   "verify live before calling it done" (see the testing pattern section),
   and that discipline doesn't carry over automatically to a chat session
   that can't execute the code. Conversely, if you make local changes in
   Claude Code, `git push` before switching to a remote session, and
   `git pull` before resuming locally, so the two don't diverge.

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
| — | **Follow-on: Display screen — wall clock, 2-minute warning banner, combined "next match starts in" countdown (remaining + break), escalating break-phase urgency styling** | ✅ |
| — | **Follow-on: vendored `node_modules` + pinned exact dependency versions** (no cloud/npm-registry dependency at install time, ever) | ✅ |
| — | **Follow-on: `Install.bat` / `Run.bat`** — double-click setup, and double-click launch that opens the app in its own window automatically | ✅ |
| — | **Follow-on: Excel (.xlsx) player import** — upload the club's membership export directly (Rego #/Full Name/Gender/Mbshp Type/Status columns); Comp A/B/C maps to skill grade, Social/Junior default to C flagged for review; reuses the existing dedup/commit pipeline | ✅ |
| — | **Follow-on: `db.ensureBaselineDefaults()`** — self-heals club_settings/courts/payment_categories/skill_compatibility if empty (fixes the Club page crashing when the demo-data prompt is declined at install, the correct real-club choice) | ✅ |
| — | **Follow-on: `Install.bat` auto-installs Node.js LTS via winget** if missing, with a registry-based PATH refresh so the same window can use it immediately | ✅ |
| — | **Follow-on: installable PWA** — manifest.json + icons + service worker (app-shell caching, API calls always hit the network live) + a header "+ Install app" button wired to the native browser install prompt, so the app gets a real Start Menu/taskbar icon (no Electron - this is Edge's native install support) | ✅ |
| — | **Follow-on: `launcher.py` replaces the console-window launcher** — Run.bat now opens a real native app window via pywebview (uses Windows' built-in WebView2 runtime, not a bundled Chromium like Electron); closing that window stops the server automatically, no console ever shown, no separate "save" step needed (every write already persists immediately). `Stop.bat` added as a manual fallback. `Install.bat` auto-installs Python via winget + pins `pywebview`/`pythonnet` versions, same pattern as the Node.js auto-install | ✅ |
| — | **Follow-on: Display link fixed to stay inside the app shell** — the Display nav link's `target="_blank"` was falling through to WebView2's default behaviour of opening a real separate Edge browser window. `launcher.py` now exposes a `js_api` (`Api.open_display()`) and `pwa.js` intercepts the click (only when `window.pywebview` exists, i.e. inside the native shell) to open a second chromeless pywebview window instead - verified via process-count check (Edge process count unchanged, pywebview window count went 1→2) | ✅ |
| — | **Follow-on: Display screen redesigned for at-a-glance legibility** — courts grid beside a single-column resting list (no grades anywhere - it's member-facing), 4 courts max per row, big bold court numbers/names sized to read from across a room by a 40-50 person crowd, teams shown as stacked names (no "&"/"vs") with a clear gap between partners and an even clearer gap between the two teams, long names truncate with ellipsis instead of wrapping (keeps the grid uniform - and fixed a real bug this surfaced, `min-width:0` needed on grid items or long unwrapped names blow out the grid horizontally). Verified at true 1920x1080 and against 6-10 court counts populated with real club member names | ✅ |
| — | **Follow-on: check-in now pops a details modal** — double-clicking an available player opens a modal (name, "Edit" toggle for the full player profile, and - when payment tracking is on - a required payment category dropdown sourced from the session's own payment rates, amount, first-time flag, note) instead of silently checking them in; check-in and payment are recorded together in one action. When payment tracking is off the modal still opens (no payment section) and check-in needs no extra input. The existing "Here today" payment-cell modal (for fixing payment after the fact) is untouched. Verified live: required-payment validation blocks check-in, edit-and-save persists to the real player record, and the full check-in-with-payment flow writes the correct attendance + payment row | ✅ |
| — | **Follow-on: v1.0.0 tagged + GitHub release published**, then `Install.bat` folded into `Run.bat`** — a downloaded release needed two double-clicks (Install.bat, then Run.bat) to get running; not truly one-click. `Run.bat` now branches itself: if Node/Python/pywebview are all already present it launches instantly with zero console window (the every-day path); otherwise it shows the same setup screen Install.bat used to (minus the interactive demo-data prompt, which real club use should always decline anyway) and then launches. `Install.bat` deleted - one file to double-click, first run or the hundredth. Also hardened `launcher.py`: since pythonw has no console, any startup failure (missing dependency, WebView2 issue, etc.) now shows a real Windows message box instead of the window just never appearing with no explanation | ✅ |
| — | **Follow-on: v1.0.1 released** - Display screen header stripped down to just the courts/countdown/resting (dropped club name and session label/date, less to read from a distance). Verified by downloading and running the actual published release zip in an isolated folder, not just the working tree | ✅ |
| — | **Follow-on: "first time visitor" and "new member" are two independent flags on attendance**, and neither requires payment tracking any more — both checkboxes/badges were nested inside the payment section of the check-in modal/"Here today" table, so clubs with payment tracking off had no way to flag either at all. Added `attendance.new_member` (mirrors `first_time` - a one-off per-visit flag, not a persistent player attribute) via `db/index.js`'s new `ensureColumns()` migration (additive `ALTER TABLE`, idempotent, runs on every boot alongside `ensureBaselineDefaults` - retrofits the column onto existing real databases without touching their data). Both checkboxes moved out of the payment section to always show in the check-in modal, and both badges ("1st" / "New") now render next to the player's name in "Here today" regardless of payment tracking. Verified live: migration runs cleanly against the real 141-player database, both flags record independently (one ticked without the other), and both still work correctly with payment tracking off | ✅ |

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
  xlsxImport.js       - parses the club's membership Excel export into the same row shape csvImport uses
  sessionReport.js   - Excel export metrics incl. peak-concurrent sweep (+ .test.js)
routes/               - one file per resource, thin Express handlers over db/store.js
public/
  checkin.html/.js    - check-in screen (also hosts payment recording modal)
  manage.html/.js     - "Rounds" screen (round status/controls + drag-drop game builder)
  display.html/.js    - kiosk display (wall clock, countdowns, warning banner - own inline styles)
  club.html/.js       - club settings, courts, skill matrix, payment categories, templates, CSV import
  history.html/.js    - session history + Excel export UI
  events.js           - shared `subscribeToEvents()` SSE client helper
  pwa.js               - shared: registers sw.js, wires the "+ Install app" header button
  sw.js                - service worker: caches the static app shell, never caches /api/*
  manifest.json         - PWA manifest (start_url /checkin.html, standalone display)
  icons/                - generated app icons (192/512/maskable-512, blue "GS" monogram)
  style.css           - one shared stylesheet for the staff pages (checkin/manage/club/history)
server.js              - wires all routers, binds 0.0.0.0:4000, starts scheduler
launcher.py             - starts server.js hidden, opens a real native app window via
                           pywebview (WebView2), stops the server when that window closes;
                           any startup failure shows a real message box (pythonw has no
                           console to print to) instead of silently doing nothing
Run.bat                 - double-click: THE only file end users need. Fast path (Node/
                           Python/pywebview all present) launches launcher.py via pythonw
                           instantly with zero console window. Slow path (first run, or
                           something's missing) shows a brief setup screen - auto-installs
                           Node.js/Python via winget, pip installs pywebview/pythonnet,
                           applies DB schema - then launches. No separate Install.bat.
Stop.bat                - double-click: force-stops the server (manual fallback; normally
                           just close the app window instead)
node_modules/           - committed on purpose, not gitignored (see decisions below)
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
- **`node_modules` is committed to git, not gitignored**, and `package.json`
  uses exact pinned versions (no `^` ranges). The user explicitly required
  zero cloud dependency at *any* point, including install — caret ranges
  meant a fresh `npm install` could silently pull a different (and
  potentially breaking) version than what was actually tested, and a
  gitignored `node_modules` meant a fresh clone/copy needed internet access
  just to become runnable. Verified by copying the whole project to a
  location that never had `npm install` run against it and confirming it
  ran correctly from there alone.
- **`Run.bat` does NOT tie the server's lifetime to the Edge app-window's
  lifetime.** First attempt tried tracking the launched Edge process's PID
  (or polling for a process whose command line matched `--app=...`) and
  killing the server when that disappeared — this broke immediately in
  testing: Edge is a multi-process, single-instance browser, so a fresh
  `--app=` launch commonly hands off to an already-running Edge instance
  under the same user profile (this machine had 67 Edge processes running
  at the time) with no reliable single process left to track, so the server
  got killed within ~2 seconds of starting. Fixed by giving the server its
  own clearly-titled console window ("CLOSE THIS WINDOW TO STOP THE APP")
  as the one unambiguous stop control, and treating the Edge app window as a
  pure, independent convenience view. If a genuine "closing the app window
  stops everything" experience (like the junior app's `pywebview`, which
  embeds the browser control *in-process*) is wanted later, that would need
  Electron or a similar in-process embed — deliberately not done here to
  avoid reintroducing native-build/heavy-vendoring risk.

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
- **No formal README.md** — this file (`PROGRESS.md`) and `Run.bat`'s
  own on-screen messages cover most of what a README would, but the spec's
  original ask (Windows firewall prompt on first LAN bind, the
  QR-code-for-TV workflow specifically, and the OneDrive cross-machine sync
  gotchas) was never written up as a standalone polished doc.
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
- If you're in a **remote/claude.ai session with no Bash/PowerShell/browser
  tools at all**, you obviously can't run the verification pattern above.
  Say so plainly rather than claiming something was tested - propose the
  change, and note it needs running locally to confirm.

## Suggested next steps (pick one, or something else)

1. Build "Finish session" (close-out + summary screen with payment
   breakdown) — biggest remaining spec gap.
2. Write the README / setup docs (firewall, QR code, OneDrive workflow).
3. Whatever new feature request comes up — this doc plus the code itself
   should be enough context to continue without re-deriving the whole
   history above.
