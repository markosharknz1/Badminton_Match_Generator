@echo off
REM Game Scheduler - double-click to start. Hands straight over to the
REM start-up window (launcher.ps1, run with no console via Windows Script
REM Host), which installs Node.js the first time if needed, starts the
REM server, and opens the app. This console closes immediately. The desktop
REM shortcut created on first run starts with no console at all.
wscript.exe //B //nologo "%~dp0launcher-silent.wsf"
