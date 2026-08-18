@echo off
setlocal
cd /d "%~dp0"

set "PIDFILE=logs\server.pid"
if not exist "%PIDFILE%" (
    echo Game Scheduler doesn't look like it's running - no logs\server.pid found.
    pause
    exit /b 0
)

set /p SERVERPID=<"%PIDFILE%"
taskkill /PID %SERVERPID% /F >nul 2>nul
del "%PIDFILE%" >nul 2>nul
echo Game Scheduler stopped.
pause
