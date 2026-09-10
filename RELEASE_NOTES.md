## Game Scheduler v1.0.10

### Installing

1. Download **`GameScheduler-v1.0.10.zip`** below and extract it anywhere.
2. Double-click **`GameScheduler.exe`** inside that folder.

The `.exe` is the launcher - keep it in the extracted folder with the files beside it.

**Upgrading:** extract the new ZIP to a new folder, then copy `game_scheduler.db` from the old folder into the new one before launching - that file is your whole roster and history.

### What's new

- **Settings has a proper layout.** A menu down the left - Overview, Session templates, Courts, Skill compatibility, Email, Payments, Club details - with one window at a time on the right. Overview shows the club at a glance: each normal session with its day, time, mode, courts and prices. Club details expands into Club name & icon, Date format, Game defaults and Payment categories, each with its own Save.
- **Session templates offer every court number (1-32)** - picking one not yet on the Courts page adds it there when you save.
- **Rounds played, one round at a time.** On the Rounds page the window steps through rounds (Previous/Next) showing the round, when it started, and the players. In History a session's rounds are a table - round, start time, courts, players - and each row opens that round's games.
- **"Games played today"** button in the round designer: everyone checked in, fewest games first, so you can see fairness at a glance while building a round.
- **History filter and trends.** A "Show" dropdown for all sessions, ad-hoc only, or one session template (e.g. Tuesday morning). It filters the calendar, the list and the Excel export, and adds a trend panel - sessions, average players, average rounds, best night, and a players-per-session chart.
- **CSV import template.** Player Database has a "Download CSV template" button with the exact columns and two example rows. The "Download backup" button now works inside the app window too.
- **No horn on opening the app.** A round left running when the app was last closed no longer sounds the horn when the app starts and tidies it up.
- **A brand-new install starts with no payment categories** - each club sets up its own.

### Notes

- This is the first release built by GitHub Actions from the tagged source. The section below lists the exact commit, the build log, SHA-256 checksums, and a VirusTotal scan - see [SECURITY.md](https://github.com/markosharknz1/Session_Organiser/blob/master/SECURITY.md) for what the app does with your data.
- Your roster and history live in one local file (`game_scheduler.db`) - not included in this release, but backed up automatically to `Documents\GameScheduler\backups` every time the app opens.
