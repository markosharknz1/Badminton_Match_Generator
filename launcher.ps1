# Game Scheduler start-up window. Run hidden by "Game Scheduler.cmd" (first
# run) or by the desktop shortcut (via launcher-silent.wsf, no console at
# all). Shows a small native window with what's happening - checking or
# installing Node.js, setting up the database, starting the server - then
# hands over to launcher.js and closes once the app window is up. Plain,
# readable PowerShell: nothing compiled, nothing downloaded except Node.js
# itself (from the official package via winget), and only if it's missing.
param()

$ErrorActionPreference = 'Stop'
$BaseDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $BaseDir
$LogDir = Join-Path $BaseDir 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Port = 4000

function Log($message) {
    $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Add-Content -Path (Join-Path $LogDir 'run.log') -Value "$stamp  [startup] $message" -Encoding utf8
}

# --- The window -------------------------------------------------------------
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Game Scheduler'
$form.Size = New-Object System.Drawing.Size(460, 300)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.BackColor = [System.Drawing.Color]::White
$iconPath = Join-Path $BaseDir 'app_icon.ico'
if (Test-Path $iconPath) { $form.Icon = New-Object System.Drawing.Icon($iconPath) }

$title = New-Object System.Windows.Forms.Label
$title.Text = 'Starting Game Scheduler'
$title.Font = New-Object System.Drawing.Font('Segoe UI', 14, [System.Drawing.FontStyle]::Bold)
$title.Location = New-Object System.Drawing.Point(24, 20)
$title.AutoSize = $true
$form.Controls.Add($title)

$steps = New-Object System.Windows.Forms.Label
$steps.Font = New-Object System.Drawing.Font('Segoe UI', 10)
$steps.Location = New-Object System.Drawing.Point(24, 62)
$steps.Size = New-Object System.Drawing.Size(410, 130)
$form.Controls.Add($steps)

$bar = New-Object System.Windows.Forms.ProgressBar
$bar.Style = 'Marquee'
$bar.MarqueeAnimationSpeed = 30
$bar.Location = New-Object System.Drawing.Point(24, 200)
$bar.Size = New-Object System.Drawing.Size(410, 18)
$form.Controls.Add($bar)

$closeBtn = New-Object System.Windows.Forms.Button
$closeBtn.Text = 'Close'
$closeBtn.Location = New-Object System.Drawing.Point(344, 228)
$closeBtn.Size = New-Object System.Drawing.Size(90, 28)
$closeBtn.Visible = $false
$closeBtn.Add_Click({ $form.Close() })
$form.Controls.Add($closeBtn)

$script:lines = @()
function Step($text) {
    $script:lines += "...  $text"
    $steps.Text = ($script:lines -join "`r`n")
    [System.Windows.Forms.Application]::DoEvents()
    Log $text
}
function Done() {
    $script:lines[-1] = $script:lines[-1] -replace '^\.\.\.', 'OK '
    $steps.Text = ($script:lines -join "`r`n")
    [System.Windows.Forms.Application]::DoEvents()
}
function Fail($message) {
    Log "FAILED: $message"
    $script:lines[-1] = $script:lines[-1] -replace '^\.\.\.', 'X  '
    $title.Text = 'Game Scheduler could not start'
    $title.ForeColor = [System.Drawing.Color]::FromArgb(185, 28, 28)
    $steps.Text = ($script:lines -join "`r`n") + "`r`n`r`n" + $message
    $bar.Visible = $false
    $closeBtn.Visible = $true
    # Keep the window up until the user closes it.
    while ($form.Visible) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 50 }
    exit 1
}
# Waits on a process while keeping the window responsive. Touching .Handle
# first is deliberate: without it PowerShell never caches the process
# handle and .ExitCode comes back $null after exit - which read as a
# failure the first time this ran, on a db\init.js that had succeeded.
function WaitFor($process) {
    $null = $process.Handle
    while (-not $process.HasExited) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 100 }
    return [int]$process.ExitCode
}
function PortOpen() {
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $async = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
        $ok = $async.AsyncWaitHandle.WaitOne(300) -and $client.Connected
        $client.Close()
        return $ok
    } catch { return $false }
}

$form.Show()
[System.Windows.Forms.Application]::DoEvents()
Log '--- start-up window opened ---'

# --- Node.js ----------------------------------------------------------------
Step 'Checking Node.js'
$node = $null
$cmd = Get-Command node -ErrorAction SilentlyContinue
if ($cmd) { $node = $cmd.Source }
elseif (Test-Path "$env:ProgramFiles\nodejs\node.exe") { $node = "$env:ProgramFiles\nodejs\node.exe" }

if (-not $node) {
    Done
    Step 'Installing Node.js (first time only - this can take a minute or two)'
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $winget) {
        Fail "Node.js isn't installed, and Windows Package Manager (winget) isn't available to install it automatically.`r`n`r`nPlease install Node.js (the LTS version) from https://nodejs.org, then start Game Scheduler again."
    }
    $p = Start-Process -FilePath $winget.Source -ArgumentList @('install', '--id', 'OpenJS.NodeJS.LTS', '-e', '--accept-package-agreements', '--accept-source-agreements', '--silent') -WindowStyle Hidden -PassThru
    $code = WaitFor $p
    if (Test-Path "$env:ProgramFiles\nodejs\node.exe") {
        $node = "$env:ProgramFiles\nodejs\node.exe"
    } else {
        Fail "Automatic Node.js install didn't complete (winget exit code $code).`r`n`r`nPlease install Node.js (the LTS version) from https://nodejs.org, then start Game Scheduler again."
    }
}
Done
Log "Node.js: $node"

# --- App files + database ---------------------------------------------------
Step 'Checking the app files'
$missing = @('server.js', 'db', 'public', 'node_modules', 'launcher.js') | Where-Object { -not (Test-Path (Join-Path $BaseDir $_)) }
if ($missing.Count -gt 0) {
    Fail "Game Scheduler must be run from inside its own folder - it looks like only part of it is here:`r`n$BaseDir`r`n`r`nMissing: $($missing -join ', ')`r`n`r`nDownload the full ZIP from the Releases page, extract it anywhere, and run Game Scheduler from inside that folder."
}
Done

Step 'Setting up the database'
$p = Start-Process -FilePath $node -ArgumentList @('db\init.js') -WorkingDirectory $BaseDir -WindowStyle Hidden -PassThru -RedirectStandardError (Join-Path $LogDir 'dbinit.err.log')
$code = WaitFor $p
if ($code -ne 0) {
    $detail = ''
    try { $detail = (Get-Content (Join-Path $LogDir 'dbinit.err.log') -Raw).Substring(0, 400) } catch {}
    Fail "Could not set up the database.`r`n`r`n$detail"
}
Done

# --- Server + app window (launcher.js does the rest) -------------------------
if (PortOpen) {
    Step 'Game Scheduler is already running - opening it'
} else {
    Step 'Starting'
}
Start-Process -FilePath $node -ArgumentList @('launcher.js', '--background') -WorkingDirectory $BaseDir -WindowStyle Hidden | Out-Null
$deadline = (Get-Date).AddSeconds(30)
while (-not (PortOpen)) {
    if ((Get-Date) -gt $deadline) { Fail "The server did not start in time.`r`n`r`nSee logs\server.err.log for details." }
    [System.Windows.Forms.Application]::DoEvents()
    Start-Sleep -Milliseconds 200
}
Done
Step 'Opening the app'
# launcher.js opens the browser window as soon as the port answers; give it a
# moment so this window doesn't vanish before the app's appears.
$until = (Get-Date).AddSeconds(2.5)
while ((Get-Date) -lt $until) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 100 }
Done
Log 'start-up window closing'
$form.Close()
