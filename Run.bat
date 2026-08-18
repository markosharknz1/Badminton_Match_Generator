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

where pythonw >nul 2>nul
if errorlevel 1 (
    echo Python was not found on this machine.
    echo Please run Install.bat first to set it up.
    pause
    exit /b 1
)

start "" pythonw "%~dp0launcher.py"
