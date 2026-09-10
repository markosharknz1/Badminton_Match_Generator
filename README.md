# Game Scheduler

A local desktop app for running an adult badminton club night: check players
in, take payments, put together doubles rounds (by hand or automatically, with
skill grades and gender-aware pairing), run the round timer with a horn, show
the courts on a TV, and keep the night's history and totals.

Everything runs on the club's own computer. There are no accounts, no cloud,
and no data leaves the machine - see [SECURITY.md](SECURITY.md) for the full
picture.

## Install

1. Download `GameScheduler-vX.Y.Z.zip` from the
   [latest release](https://github.com/markosharknz1/Session_Organiser/releases/latest)
   and extract it anywhere (e.g. `C:\Club\Scheduler`).
2. Double-click `GameScheduler.exe` inside that folder.

First run installs Node.js if the computer doesn't have it (via `winget`),
creates an empty database next to the exe, and puts a shortcut on the desktop.
The exe is only the launcher - keep it in the extracted folder.

**Upgrading:** extract the new ZIP to a new folder and copy `game_scheduler.db`
across from the old one. That file is the club's entire roster and history.

## Setting up a club

Open **Settings** (left menu):

- **Club details** - name and icon, date format, game/changeover lengths,
  whether to track payments, and your payment categories (Member, Non-Member,
  Concession, ...). A fresh install has no categories; add your own.
- **Courts** - which court numbers the venue has.
- **Session templates** - your regular nights: day, time, mode, courts, prices.
- **Email** (optional) - SMTP2Go, Mailgun or Gmail for the end-of-night
  summary.

Players can be bulk-imported from a CSV on the Player Database page - there's a
"Download CSV template" button with the exact columns.

## Verifying a download

Releases are built by GitHub Actions from the tagged source. Each release page
lists the commit, the build log, SHA-256 checksums, and a VirusTotal scan.
Details in [SECURITY.md](SECURITY.md#verifying-a-download).

## Running from source

Requires [Node.js](https://nodejs.org) (LTS). No install step - dependencies
are committed.

```
node server.js
```

then open http://localhost:4000. To build the Windows launcher yourself:

```
pip install pyinstaller pywebview pythonnet pywin32
pyinstaller --onefile --noconsole --name GameScheduler --icon app_icon.ico launcher.py
```

Tests: `npm run csv:test`, `npm run autogen:test`, `npm run report:test`,
`npm run roundbuilder:test`.

## License

[MIT](LICENSE).
