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

where pythonw >nul 2>nul
if errorlevel 1 (
    echo Python was not found on this machine.
    where winget >nul 2>nul
    if errorlevel 1 (
        echo Windows Package Manager ^(winget^) isn't available to install it automatically.
        echo Please install Python yourself from https://python.org, then run this file again.
        echo.
        pause
        exit /b 1
    )
    echo Installing Python via winget - this may take a minute...
    winget install --id Python.Python.3.12 -e --silent --accept-package-agreements --accept-source-agreements
    if errorlevel 1 (
        echo.
        echo Automatic install failed. Please install Python yourself from https://python.org, then run this file again.
        echo.
        pause
        exit /b 1
    )
    echo.
    echo Python installed - refreshing this window's PATH so we can use it right away...
    call :RefreshPath
    where pythonw >nul 2>nul
    if errorlevel 1 (
        echo.
        echo Python was installed, but this window can't see it yet. Please close
        echo this window and double-click Install.bat again to continue.
        echo.
        pause
        exit /b 1
    )
)

for /f "delims=" %%v in ('python --version') do echo Found %%v
echo.

echo Installing the app-window library ^(pywebview^) - this gives Run.bat a real
echo window with no console popup, instead of opening a browser tab...
python -m pip install --quiet --disable-pip-version-check pywebview==6.2.1 pythonnet==3.1.0
if errorlevel 1 (
    echo.
    echo Something went wrong installing pywebview - see the error above.
    pause
    exit /b 1
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
echo  Setup complete. Double-click Run.bat to start the app - it opens in
echo  its own window (no browser tabs, no console popup), and closing that
echo  window stops the app cleanly. To force-stop it another way, use
echo  Stop.bat.
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
