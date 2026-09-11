# Game Scheduler start-up window. Run hidden by "Game Scheduler.cmd" (first
# run) or by the desktop shortcut (via launcher-silent.wsf, no console at
# all).
#
# FIRST RUN (no .setup-complete marker beside the app): shows a small
# installer-style window - what setup is about to do, a "create a desktop
# shortcut" tickbox, and Set up / Cancel buttons - then a stepped progress
# view: checking or installing Node.js, preparing the database, creating the
# shortcut, starting the app. Writes .setup-complete on success.
#
# EVERY LATER RUN: a brief "Starting Game Scheduler" splash with the same
# steps, no questions asked.
#
# Plain, readable PowerShell: nothing compiled, nothing downloaded except
# Node.js itself (the official package via winget), and only if it's missing.
param()

$ErrorActionPreference = 'Stop'
$BaseDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $BaseDir
$LogDir = Join-Path $BaseDir 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Port = 4000
$MarkerPath = Join-Path $BaseDir '.setup-complete'
$FirstRun = -not (Test-Path $MarkerPath)

function Log($message) {
    $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Add-Content -Path (Join-Path $LogDir 'run.log') -Value "$stamp  [startup] $message" -Encoding utf8
}

# A downloaded folder that setup installed FROM remembers where the app
# went ("installed-to=<path>" in its marker). Running its .cmd again just
# opens the installed copy instead of setting up a second one.
if (-not $FirstRun) {
    $marker = (Get-Content $MarkerPath -Raw -ErrorAction SilentlyContinue)
    if ($marker -match 'installed-to=(.+)') {
        $installed = $Matches[1].Trim()
        if ($installed -ne $BaseDir -and (Test-Path (Join-Path $installed 'launcher-silent.wsf'))) {
            Log "This folder was installed to $installed - starting that copy."
            Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\wscript.exe') -ArgumentList @('//B', '//nologo', "`"$(Join-Path $installed 'launcher-silent.wsf')`"") -WorkingDirectory $installed
            exit 0
        }
    }
}

# Where the app should live. Per-user "Programs" folder by default: no admin
# rights needed, and well away from Documents.
$DefaultInstallDir = Join-Path $env:LOCALAPPDATA 'Programs\Game Scheduler'
if ($env:GAMESCHEDULER_SETUP_TARGET) { $DefaultInstallDir = $env:GAMESCHEDULER_SETUP_TARGET }  # test hook

# Documents (and anything OneDrive syncs) is refused: the database and the
# app's browser profile change constantly while a session runs, and a sync
# client fighting over those files corrupts them. Backups already go to
# Documents\GameScheduler\backups on their own.
function InstallDirProblem($dir) {
    if (-not $dir) { return 'Choose a folder to install to.' }
    $docs = [Environment]::GetFolderPath('MyDocuments')
    $full = [System.IO.Path]::GetFullPath($dir)
    if ($docs -and $full.TrimEnd('\').ToLower().StartsWith($docs.TrimEnd('\').ToLower())) {
        return "Please don't install in your Documents folder - it's often synced by OneDrive, and syncing the app's live database corrupts it. Backups are already saved to Documents\GameScheduler\backups automatically."
    }
    if ($full -match '(?i)\\OneDrive') {
        return "Please don't install in a OneDrive folder - syncing the app's live database while a session runs corrupts it."
    }
    if ($full -match '(?i)\\(Temp|Tmp)(\\|$)') { return "That's a temporary folder - it may be cleaned out. Choose somewhere permanent." }
    return $null
}

# --- The window -------------------------------------------------------------
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$form = New-Object System.Windows.Forms.Form
$form.Text = if ($FirstRun) { 'Game Scheduler Setup' } else { 'Game Scheduler' }
$form.Size = if ($FirstRun) { New-Object System.Drawing.Size(560, 560) } else { New-Object System.Drawing.Size(460, 300) }
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.BackColor = [System.Drawing.Color]::White
$form.TopMost = $true  # a short-lived start-up window - keep it above the folder it was launched from
$iconPath = Join-Path $BaseDir 'app_icon.ico'
if (Test-Path $iconPath) { $form.Icon = New-Object System.Drawing.Icon($iconPath) }

$title = New-Object System.Windows.Forms.Label
$title.Text = if ($FirstRun) { 'Welcome to Game Scheduler' } else { 'Starting Game Scheduler' }
$title.Font = New-Object System.Drawing.Font('Segoe UI', 14, [System.Drawing.FontStyle]::Bold)
$title.Location = New-Object System.Drawing.Point(24, 20)
$title.AutoSize = $true
$form.Controls.Add($title)

# --- First-run welcome pane -------------------------------------------------
$welcomeControls = @()
$createShortcut = $true
if ($FirstRun) {
    $intro = New-Object System.Windows.Forms.Label
    $intro.Font = New-Object System.Drawing.Font('Segoe UI', 10)
    $intro.Location = New-Object System.Drawing.Point(24, 60)
    $intro.Size = New-Object System.Drawing.Size(500, 118)
    $intro.Text = "This one-time setup gets everything ready. It will:`r`n`r`n" +
        "   1.  Copy the app to the folder below`r`n" +
        "   2.  Check for the Node.js runtime, and install it from the official`r`n" +
        "        package if it's missing (needs internet, once)`r`n" +
        "   3.  Prepare the database and start Game Scheduler`r`n`r`n" +
        "No cloud, no accounts - see SECURITY.md for the full story."
    $form.Controls.Add($intro); $welcomeControls += $intro

    $installLabel = New-Object System.Windows.Forms.Label
    $installLabel.Text = 'Install to:'
    $installLabel.Font = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)
    $installLabel.Location = New-Object System.Drawing.Point(24, 190)
    $installLabel.AutoSize = $true
    $form.Controls.Add($installLabel); $welcomeControls += $installLabel

    $installBox = New-Object System.Windows.Forms.TextBox
    $installBox.Font = New-Object System.Drawing.Font('Segoe UI', 10)
    $installBox.Location = New-Object System.Drawing.Point(24, 214)
    $installBox.Size = New-Object System.Drawing.Size(400, 26)
    $installBox.Text = $DefaultInstallDir
    $form.Controls.Add($installBox); $welcomeControls += $installBox

    $browseBtn = New-Object System.Windows.Forms.Button
    $browseBtn.Text = 'Browse...'
    $browseBtn.Font = New-Object System.Drawing.Font('Segoe UI', 10)
    $browseBtn.Location = New-Object System.Drawing.Point(432, 212)
    $browseBtn.Size = New-Object System.Drawing.Size(92, 28)
    $browseBtn.Add_Click({
        $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
        $dlg.Description = 'Choose where to install Game Scheduler (not your Documents folder)'
        $dlg.ShowNewFolderButton = $true
        if (Test-Path $installBox.Text) { $dlg.SelectedPath = $installBox.Text }
        if ($dlg.ShowDialog($form) -eq [System.Windows.Forms.DialogResult]::OK) { $installBox.Text = $dlg.SelectedPath }
    })
    $form.Controls.Add($browseBtn); $welcomeControls += $browseBtn

    $installNote = New-Object System.Windows.Forms.Label
    $installNote.Font = New-Object System.Drawing.Font('Segoe UI', 9)
    $installNote.ForeColor = [System.Drawing.Color]::FromArgb(90, 90, 90)
    $installNote.Location = New-Object System.Drawing.Point(24, 246)
    $installNote.Size = New-Object System.Drawing.Size(500, 74)
    $installNote.Text = "Anywhere is fine EXCEPT your Documents folder or another folder OneDrive syncs: the app's database changes constantly while a session runs, and syncing it corrupts it. (Backups are saved to Documents\GameScheduler\backups automatically.) If Game Scheduler is already installed in the folder you choose, it's upgraded and your data is kept."
    $form.Controls.Add($installNote); $welcomeControls += $installNote

    $installError = New-Object System.Windows.Forms.Label
    $installError.Font = New-Object System.Drawing.Font('Segoe UI', 9)
    $installError.ForeColor = [System.Drawing.Color]::FromArgb(185, 28, 28)
    $installError.Location = New-Object System.Drawing.Point(24, 322)
    $installError.Size = New-Object System.Drawing.Size(500, 56)
    $form.Controls.Add($installError); $welcomeControls += $installError

    $shortcutBox = New-Object System.Windows.Forms.CheckBox
    $shortcutBox.Text = 'Create a desktop shortcut'
    $shortcutBox.Font = New-Object System.Drawing.Font('Segoe UI', 10)
    $shortcutBox.Checked = $true
    $shortcutBox.Location = New-Object System.Drawing.Point(28, 386)
    $shortcutBox.AutoSize = $true
    $form.Controls.Add($shortcutBox); $welcomeControls += $shortcutBox

    $goBtn = New-Object System.Windows.Forms.Button
    $goBtn.Text = 'Install and start'
    $goBtn.Font = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)
    $goBtn.Location = New-Object System.Drawing.Point(274, 458)
    $goBtn.Size = New-Object System.Drawing.Size(150, 34)
    $form.Controls.Add($goBtn); $welcomeControls += $goBtn

    $cancelBtn = New-Object System.Windows.Forms.Button
    $cancelBtn.Text = 'Cancel'
    $cancelBtn.Font = New-Object System.Drawing.Font('Segoe UI', 10)
    $cancelBtn.Location = New-Object System.Drawing.Point(434, 458)
    $cancelBtn.Size = New-Object System.Drawing.Size(90, 34)
    $form.Controls.Add($cancelBtn); $welcomeControls += $cancelBtn

    $script:proceed = $false
    $script:cancelled = $false
    $goBtn.Add_Click({
        $problem = InstallDirProblem $installBox.Text
        if ($problem) { $installError.Text = $problem } else { $installError.Text = ''; $script:proceed = $true }
    })
    $cancelBtn.Add_Click({ $script:cancelled = $true })
    $form.Add_FormClosing({ if (-not $script:proceed) { $script:cancelled = $true } })
}

# --- Progress controls (both modes) ------------------------------------------
$steps = New-Object System.Windows.Forms.Label
$steps.Font = New-Object System.Drawing.Font('Segoe UI', 10)
$steps.Location = New-Object System.Drawing.Point(24, 62)
$steps.Size = New-Object System.Drawing.Size(500, 130)
$steps.Visible = -not $FirstRun
$form.Controls.Add($steps)

$bar = New-Object System.Windows.Forms.ProgressBar
$bar.Style = 'Marquee'
$bar.MarqueeAnimationSpeed = 30
$bar.Location = New-Object System.Drawing.Point(24, 200)
$bar.Size = New-Object System.Drawing.Size(410, 18)
$bar.Visible = -not $FirstRun
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
    if ($script:lines.Count -gt 0) {
        $script:lines[-1] = $script:lines[-1] -replace '^\.\.\.', 'X  '
    }
    $title.Text = if ($FirstRun) { 'Setup could not finish' } else { 'Game Scheduler could not start' }
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
Log "--- start-up window opened (first run: $FirstRun) ---"

# --- First run: wait on the welcome pane -------------------------------------
if ($FirstRun) {
    if ($env:GAMESCHEDULER_SETUP_AUTORUN -eq '1') {
        # test hook: behave as if "Install and start" was clicked immediately
        # (through the same folder check a real click gets)
        $problem = InstallDirProblem $installBox.Text
        if ($problem) { Fail $problem }
        $script:proceed = $true
    }
    while (-not $script:proceed -and -not $script:cancelled) {
        [System.Windows.Forms.Application]::DoEvents()
        Start-Sleep -Milliseconds 50
    }
    if ($script:cancelled) {
        Log 'Setup cancelled at the welcome screen.'
        exit 0
    }
    $createShortcut = $shortcutBox.Checked
    $InstallDir = [System.IO.Path]::GetFullPath($installBox.Text).TrimEnd('\')
    foreach ($c in $welcomeControls) { $c.Visible = $false }
    $title.Text = 'Setting up Game Scheduler'
    $steps.Visible = $true
    $bar.Visible = $true
    [System.Windows.Forms.Application]::DoEvents()
}

# $AppDir is where the app actually runs from after this point - the chosen
# install folder on first run (the downloaded folder is only the source),
# this folder on every later run.
$AppDir = $BaseDir
if ($FirstRun -and $InstallDir -ne $BaseDir.TrimEnd('\')) {
    Step "Copying the app to $InstallDir"
    try { New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null } catch { Fail "Couldn't create the folder $InstallDir`r`n`r`n$($_.Exception.Message)" }
    # robocopy: everything except the live data an existing install may
    # already have there (its database, logs, browser profile, marker) - so
    # installing over an older copy is an upgrade that keeps the club's data.
    $rc = Start-Process -FilePath robocopy -ArgumentList @("`"$BaseDir`"", "`"$InstallDir`"", '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/XF', 'game_scheduler.db', '.setup-complete', '/XD', 'logs', '.edge-app-profile') -WindowStyle Hidden -PassThru
    $code = WaitFor $rc
    if ($code -ge 8) { Fail "Copying the app to $InstallDir failed (robocopy exit code $code). Check the folder is writable, then try again." }
    Done
    $AppDir = $InstallDir
    Set-Content -Path $MarkerPath -Value "installed-to=$AppDir" -Encoding ascii
    $LogDir = Join-Path $AppDir 'logs'
    New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
    Log "Installed to $AppDir - continuing from there."
} elseif ($FirstRun) {
    Log 'Installing in place (chosen folder is this folder).'
}
$MarkerPath = Join-Path $AppDir '.setup-complete'

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
$missing = @('server.js', 'db', 'public', 'node_modules', 'launcher.js') | Where-Object { -not (Test-Path (Join-Path $AppDir $_)) }
if ($missing.Count -gt 0) {
    Fail "Game Scheduler must be run from inside its own folder - it looks like only part of it is here:`r`n$AppDir`r`n`r`nMissing: $($missing -join ', ')`r`n`r`nDownload the full ZIP from the Releases page, extract it anywhere, and run Game Scheduler from inside that folder."
}
Done

Step 'Setting up the database'
$p = Start-Process -FilePath $node -ArgumentList @('db\init.js') -WorkingDirectory $AppDir -WindowStyle Hidden -PassThru -RedirectStandardError (Join-Path $LogDir 'dbinit.err.log')
$code = WaitFor $p
if ($code -ne 0) {
    $detail = ''
    try { $detail = (Get-Content (Join-Path $LogDir 'dbinit.err.log') -Raw).Substring(0, 400) } catch {}
    Fail "Could not set up the database.`r`n`r`n$detail"
}
Done

# --- Desktop shortcut (first run, user's choice) -----------------------------
if ($FirstRun -and $createShortcut) {
    Step 'Creating a desktop shortcut'
    try {
        $shell = New-Object -ComObject WScript.Shell
        $desktop = $shell.SpecialFolders.Item('Desktop')
        $lnk = Join-Path $desktop 'Game Scheduler.lnk'
        if (-not (Test-Path $lnk)) {
            $s = $shell.CreateShortcut($lnk)
            $s.TargetPath = Join-Path $env:SystemRoot 'System32\wscript.exe'
            $s.Arguments = '//B //nologo "' + (Join-Path $AppDir 'launcher-silent.wsf') + '"'
            $s.WorkingDirectory = $AppDir
            $s.IconLocation = (Join-Path $AppDir 'app_icon.ico')
            $s.Description = 'Game Scheduler'
            $s.Save()
            Log 'Created desktop shortcut.'
        } else {
            Log 'Desktop shortcut already exists - left as is.'
        }
        Done
    } catch {
        # best effort - never block the app over a shortcut
        Log "Could not create a desktop shortcut (non-fatal): $($_.Exception.Message)"
        Done
    }
}

# --- Server + app window (launcher.js does the rest) -------------------------
if (PortOpen) {
    Step 'Game Scheduler is already running - opening it'
} else {
    Step 'Starting'
}
Start-Process -FilePath $node -ArgumentList @('launcher.js', '--background') -WorkingDirectory $AppDir -WindowStyle Hidden | Out-Null
$deadline = (Get-Date).AddSeconds(30)
while (-not (PortOpen)) {
    if ((Get-Date) -gt $deadline) { Fail "The server did not start in time.`r`n`r`nSee logs\server.err.log for details." }
    [System.Windows.Forms.Application]::DoEvents()
    Start-Sleep -Milliseconds 200
}
Done
Step 'Opening the app'
if ($FirstRun) {
    Set-Content -Path $MarkerPath -Value ("setup completed " + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')) -Encoding ascii
    Log 'Wrote .setup-complete marker.'
    $title.Text = 'Setup complete'
    $title.ForeColor = [System.Drawing.Color]::FromArgb(21, 128, 61)
    if ($AppDir -ne $BaseDir) {
        $script:lines += "Installed to $AppDir - the downloaded folder can be deleted."
        $steps.Text = ($script:lines -join "`r`n")
    }
}
# launcher.js opens the browser window as soon as the port answers; give it a
# moment so this window doesn't vanish before the app's appears (longer on
# first run so the "installed to" line can be read).
$until = (Get-Date).AddSeconds($(if ($FirstRun -and $AppDir -ne $BaseDir) { 6 } else { 2.5 }))
while ((Get-Date) -lt $until) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 100 }
Done
Log 'start-up window closing'
$form.Close()
