@echo off
REM Game Scheduler - double-click to start. Hands straight over to the
REM start-up window (launcher.ps1), which installs Node.js the first time if
REM needed, starts the server, and opens the app. conhost --headless runs
REM PowerShell with no console window of its own; this window closes
REM immediately. The desktop shortcut created by setup starts the same way
REM with no console at all.
start "" "%SystemRoot%\System32\conhost.exe" --headless powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0launcher.ps1"
