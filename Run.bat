@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js was not found on this machine.
    echo Please install it from https://nodejs.org ^(the LTS version^), then run Install.bat.
    pause
    exit /b 1
)

echo Starting Game Scheduler...
echo Leave this window open for the whole session - closing it stops the server
echo and freezes any live match timers.
echo.
node server.js

echo.
echo The server has stopped.
pause
