## Game Scheduler v1.0.11

### Installing

1. Download **`GameScheduler-v1.0.11.zip`** below and extract it anywhere - it's only the download.
2. Double-click **`Game Scheduler.cmd`** inside the extracted folder. Windows may show an "Open File - Security Warning" because it's a script from the internet - click **Run**.
3. A setup window opens: choose where to install (the default is `C:\Apps\Game_Scheduler` - anywhere is fine **except your Documents folder or anything OneDrive syncs**), tick whether you want a desktop shortcut, and click **Install and start**.

Setup copies the app to that folder, installs Node.js if the computer doesn't have it, creates the database, and opens the app. You can delete the downloaded folder afterwards; use the desktop shortcut from then on.

**Upgrading from v1.0.10 or earlier:** run the new `Game Scheduler.cmd` and choose the folder your existing copy is in - it's upgraded in place and your `game_scheduler.db` (the club's entire roster and history) is kept. If your existing copy is in your Documents folder, choose a new location and copy `game_scheduler.db` across from the old folder before launching.

### What's new

- **No more `.exe`.** Earlier releases shipped a packaged program that antivirus tools sometimes flagged purely for how it was packaged (7 engines on VirusTotal for v1.0.10, including Windows Defender). There is now no compiled program at all: the app is the readable source in the ZIP, run by Node.js, opening in the Microsoft Edge (or Chrome) already on the computer - in its own window, no address bar or tabs. The VirusTotal scan linked below is of this ZIP.
- **A proper first-run setup** - install location, desktop shortcut, progress as it goes - and a brief start-up window on every later launch instead of console windows.
- **Singles sessions** (e.g. squash). Each session template - and the start-session forms - now has a format, doubles or singles. Auto-generate builds singles rounds properly: two players a court, same-grade opponents where the numbers allow, no repeat matchups from recent rounds, and the avoid-pair and grade-compatibility rules still apply.
- **Settings has a menu down the left** - Overview, Session templates, Courts, Skill compatibility, Email, Payments, Club details - with one window at a time on the right. The Overview shows each normal session with its day, time, mode, format, courts and prices.
- **Session templates offer every court number** (1-32); picking one not yet on the Courts page adds it there.
- **Rounds played, one round at a time.** On the Rounds page the window steps through rounds with the time each started; in History a session's rounds are a table you click into.
- **"Games played today"** button in the round designer - everyone checked in, fewest games first.
- **History filter and trends** - all sessions, ad-hoc only, or one session template - driving the calendar, the list, the Excel export, and a trend panel with a players-per-session chart.
- **CSV import template** button on the Player Database page with the exact columns.
- Fixes: no horn for a stale round when the app opens; the "Download backup" button works inside the app window.
- The app is sport-neutral throughout, and a brand-new install starts with no payment categories - each club sets up its own.

### Notes

- Your roster and history live in one local file (`game_scheduler.db`) - not included in this release, but backed up automatically to `Documents\GameScheduler\backups` every time the app opens.
