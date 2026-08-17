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
    where winget >nul 2>nul
    if errorlevel 1 (
        echo Windows Package Manager ^(winget^) isn't available to install it automatically.
        echo Please install Node.js yourself from https://nodejs.org ^(the LTS version^), then run this file again.
        echo.
        pause
        exit /b 1
    )
    echo Installing Node.js LTS via winget - this may take a minute...
    winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
    if errorlevel 1 (
        echo.
        echo Automatic install failed. Please install Node.js yourself from https://nodejs.org ^(the LTS version^), then run this file again.
        echo.
        pause
        exit /b 1
    )
    echo.
    echo Node.js installed - refreshing this window's PATH so we can use it right away...
    call :RefreshPath
    where node >nul 2>nul
    if errorlevel 1 (
        echo.
        echo Node.js was installed, but this window can't see it yet. Please close
        echo this window and double-click Install.bat again to continue.
        echo.
        pause
        exit /b 1
    )
)

for /f "delims=" %%v in ('node --version') do echo Found Node.js %%v
echo.

set "EDGE_FOUND=0"
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "EDGE_FOUND=1"
if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "EDGE_FOUND=1"
if "%EDGE_FOUND%"=="1" (
    echo Found Microsoft Edge - Run.bat will open the app in its own window.
) else (
    echo Microsoft Edge was not found - Run.bat will fall back to opening your
    echo default browser instead ^(everything still works, just as a normal tab^).
)
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
echo.
echo  Want a real Start Menu / taskbar icon instead? Once the app is open,
echo  click "+ Install app" in the header (or the install icon in Edge's
echo  address bar) - one click, and Windows adds it like any other app.
echo ============================================
pause
exit /b 0

:RefreshPath
REM Re-reads PATH from the registry (System + User) into this already-running
REM window, so a program winget just installed becomes usable immediately
REM instead of requiring the window to be closed and reopened.
for /f "tokens=2*" %%A in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul') do set "SYS_PATH=%%B"
for /f "tokens=2*" %%A in ('reg query "HKCU\Environment" /v Path 2^>nul') do set "USER_PATH=%%B"
set "PATH=%SYS_PATH%;%USER_PATH%"
goto :eof
