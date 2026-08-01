@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo  Game Scheduler - Install / first-time setup
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js was not found on this machine.
    echo Please install it from https://nodejs.org ^(the LTS version^), then run this file again.
    echo.
    pause
    exit /b 1
)

for /f "delims=" %%v in ('node --version') do echo Found Node.js %%v
echo.

echo Setting up the database - safe to run even if one already exists, this never deletes data...
node db\init.js
if errorlevel 1 (
    echo.
    echo Something went wrong setting up the database - see the error above.
    pause
    exit /b 1
)

echo.
set "SEED="
set /p SEED="Load sample demo data? Only say yes on a brand-new install - it WIPES any existing players/sessions. (y/N): "
if /I "%SEED%"=="y" (
    node db\seed.js
) else (
    echo Skipped - keeping the database as-is.
)

echo.
echo ============================================
echo  Setup complete. Double-click Run.bat to start the app.
echo ============================================
pause
