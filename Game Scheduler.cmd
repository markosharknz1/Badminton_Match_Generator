@echo off
setlocal
cd /d "%~dp0"

REM Game Scheduler - double-click to start. Installs Node.js on first use if
REM the computer doesn't have it (via Windows Package Manager), then hands
REM over to launcher.js, which opens the app in its own window. This console
REM window closes by itself once the app is up.

set "NODE=node"
where node >nul 2>nul
if not errorlevel 1 goto :run
if exist "%ProgramFiles%\nodejs\node.exe" (
    set "NODE=%ProgramFiles%\nodejs\node.exe"
    goto :run
)

echo Game Scheduler needs Node.js, which isn't installed yet.
echo Installing it now with Windows Package Manager - this can take a minute...
echo.
where winget >nul 2>nul
if errorlevel 1 (
    echo Windows Package Manager isn't available on this computer.
    echo Please install Node.js ^(the LTS version^) from https://nodejs.org and run Game Scheduler again.
    pause
    exit /b 1
)
winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements
if errorlevel 1 (
    echo.
    echo Could not install Node.js automatically.
    echo Please install it ^(the LTS version^) from https://nodejs.org and run Game Scheduler again.
    pause
    exit /b 1
)
if exist "%ProgramFiles%\nodejs\node.exe" (
    set "NODE=%ProgramFiles%\nodejs\node.exe"
    goto :run
)
echo.
echo Node.js is installed. Please close this window and run Game Scheduler again.
pause
exit /b 0

:run
"%NODE%" launcher.js
