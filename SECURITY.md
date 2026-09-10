# Security and privacy

Game Scheduler is a local desktop app for running a club's session night. It is
built to keep a club's data on the club's own computer. This page says exactly
what it does and doesn't do, so you can judge that for yourself.

## Where your data lives

- **One file.** Every player, session, game and payment record is in
  `game_scheduler.db` (an SQLite database) in the folder you run the app from.
  Nothing is stored anywhere else, and nothing is sent anywhere.
- **Backups.** Each time the app opens it copies that file to
  `Documents\GameScheduler\backups` on the same computer (newest 30 kept).
- **Not encrypted.** The database holds personal details - names, dates of
  birth, contact details, and any email credentials you enter in Settings - in
  plain form. Treat the computer and its backups the way you'd treat a
  membership spreadsheet: keep the login protected and don't share the folder.

## What connects to the internet

The app makes **no** network connections of its own - no accounts, no cloud
sync, no analytics, no update checks. The only outbound traffic is:

1. **Sending the end-of-night summary email**, only when you click *Send*, to
   whichever provider you configured in Settings (SMTP2Go, Mailgun, or Gmail).
   Nothing is ever sent automatically.
2. **Installing Node.js on first run**, via Windows Package Manager (`winget`),
   if it isn't already on the computer. The app runs on Node.js; the installer
   comes from the official Node.js package.

The server the app starts listens on port 4000. It binds to all interfaces so a
second screen on the same network (the External Display on a TV) can reach it,
but it has no authentication - it is meant for a club's own private network,
not the public internet.

## Verifying a download

Every release is built by GitHub Actions from the tagged source in this
repository - not on a personal machine. Each release page shows the commit it
was built from, a link to the build log, SHA-256 checksums of the files, and a
VirusTotal scan of the exe.

To check a download on Windows:

```powershell
Get-FileHash .\GameScheduler-v1.2.3.zip -Algorithm SHA256
```

and compare against `SHA256SUMS.txt` on the release page.

`GameScheduler.exe` is packaged with PyInstaller and is not code-signed, so
Windows SmartScreen may show an "unknown publisher" prompt the first time, and
some antivirus engines flag PyInstaller executables generically. If either
worries you, build it yourself from source (see the README) - it's a one-line
build - or run the app directly with `node server.js`, which needs no exe at
all.

## Reporting a problem

Open an issue on this repository, or email the maintainer via the address on
the GitHub profile. Please include what you saw and how to reproduce it.
