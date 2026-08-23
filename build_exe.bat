@echo off
setlocal
cd /d "%~dp0"

REM Dev-only tool - rebuilds GameScheduler.exe from launcher.py after a code
REM change. End users never run this; they just use the committed exe.
where pyinstaller >nul 2>nul
if errorlevel 1 (
    echo PyInstaller isn't installed. Run: python -m pip install pyinstaller
    pause
    exit /b 1
)

rmdir /s /q build 2>nul
rmdir /s /q dist 2>nul
del GameScheduler.spec 2>nul

pyinstaller --onefile --noconsole --name GameScheduler --icon app_icon.ico launcher.py
if errorlevel 1 (
    echo Build failed - see the error above.
    pause
    exit /b 1
)

copy /y dist\GameScheduler.exe GameScheduler.exe >nul
rmdir /s /q build 2>nul
rmdir /s /q dist 2>nul
del GameScheduler.spec 2>nul

echo.
echo Built GameScheduler.exe successfully.
pause
