# Orchestrates the "installed app" experience: start the server in its own
# clearly-labelled console window, wait for it to come up, then open it in a
# chromeless app-style window (no address bar/tabs - not "a website in a
# browser tab"). Called by Run.bat - not meant to be double-clicked directly
# (PowerShell scripts don't run on double-click by default).
#
# Deliberately does NOT try to tie the server's lifetime to the Edge app
# window's lifetime: Edge is a multi-process, single-instance browser, so a
# --app= launch can silently hand off to an already-running Edge instance
# (very common - a fresh machine can easily have dozens of Edge processes
# already open) with no reliable process to track as "the window". Instead,
# the server gets its own titled console window - closing THAT window is the
# one unambiguous "stop the app" action, and the Edge window is just a
# convenience view that can be closed and reopened independently.

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$port = 4000

Write-Host "Starting Game Scheduler server..."
Start-Process -FilePath "cmd.exe" -ArgumentList '/k', 'title Game Scheduler - CLOSE THIS WINDOW TO STOP THE APP && node server.js'

# Wait for it to actually accept connections (up to 15s) before opening the app window.
$ready = $false
for ($i = 0; $i -lt 50; $i++) {
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $tcp.Connect('127.0.0.1', $port)
        $tcp.Close()
        $ready = $true
        break
    } catch {
        Start-Sleep -Milliseconds 300
    }
}

if (-not $ready) {
    Write-Host ""
    Write-Host "The server did not start in time. Check the 'Game Scheduler' console"
    Write-Host "window for error details."
    Read-Host "Press Enter to close"
    exit 1
}

# Prefer a chromeless "app mode" window (no tabs/address bar - feels like a
# real installed app) via Edge, which ships with Windows by default. Falls
# back to whatever the default browser is if Edge isn't found.
$edgePaths = @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles}\Microsoft\Edge\Application\msedge.exe"
)
$edge = $edgePaths | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($edge) {
    Start-Process -FilePath $edge -ArgumentList "--app=http://localhost:$port"
} else {
    Start-Process "http://localhost:$port"
}

Write-Host "Game Scheduler is open."
Write-Host "The server keeps running in the 'Game Scheduler' console window -"
Write-Host "close that window (not just the app window) to stop it."
