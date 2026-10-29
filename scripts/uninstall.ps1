# Removes SanskritLearning for the current Windows user: every agent connection (each agent's file restored), the background
# service, login startup, the Start menu entry, the Settings > Apps entry, the runtime, the app and the profile.
#   -Gui                          windows instead of a console: tray menu and Settings > Apps (asks in a window)
#   -KeepModels | -DeleteModels   keep or delete the downloaded speech models (otherwise it asks)
#
# Order, so that a stop at any point leaves something whole and an uninstall that can be run again:
#   1. Check, changing nothing, that every agent file holding a SanskritLearning entry can be restored.
#   2. Disconnect the agents. If this fails, SanskritLearning is still fully installed and working.
#   3. Remove login startup and the Start menu entry, so nothing starts it again; mark the installation 'uninstalling'.
#   4. Stop SanskritLearning.
#   5. Move every folder aside (this fails, before anything is deleted, if a file is in use), then delete them.
#   6. Only then remove the Settings > Apps entry, and last the uninstaller's own folder.
# Every step can be repeated: running uninstall again finishes one that stopped.
param([switch]$KeepModels, [switch]$DeleteModels, [switch]$Gui)
$ErrorActionPreference = 'Continue'
Set-Location -LiteralPath $env:TEMP
. (Join-Path $PSScriptRoot 'windows-shell.ps1')
# From inside a packaged app's terminal, only that app's private copy of AppData would be cleaned.
$sandbox = Get-AppDataRedirect
if ($sandbox) {
    $passOn = @(); if ($KeepModels) { $passOn += '-KeepModels' }; if ($DeleteModels) { $passOn += '-DeleteModels' }; if ($Gui) { $passOn += '-Gui' }
    # The copy in %TEMP% keeps running after the folder it came from is deleted.
    $copy = Join-Path $env:TEMP 'sanskrit_learning-uninstall.ps1'
    Copy-Item -LiteralPath $PSCommandPath -Destination $copy -Force
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'windows-shell.ps1') -Destination (Join-Path $env:TEMP 'windows-shell.ps1') -Force
    Restart-OutsideSandbox -Script $copy -Arguments $passOn -App $sandbox
    exit 3
}
$base = Join-Path $env:LOCALAPPDATA 'SanskritLearning'
$app = Join-Path $base 'app'
$node = Join-Path $base 'runtime\node\node.exe'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$appsKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\SanskritLearning'
$shortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'SanskritLearning.lnk'
$log = New-Object System.Collections.Generic.List[string]
function Say($text) { $log.Add($text); if (-not $Gui) { Write-Host $text } }
if ($Gui) { Add-Type -AssemblyName System.Windows.Forms, System.Drawing; [System.Windows.Forms.Application]::EnableVisualStyles() }

# --- Windows -------------------------------------------------------------------------------------------------------
# The progress window runs in its own process, so it keeps moving while this one works and outlives the service, which
# this uninstall stops. It shows the step written to $progressFile, writes <file>.ready once it is on screen, and closes
# when the step reads "done".
$progressFile = Join-Path $env:TEMP 'sanskrit_learning-uninstall-progress.txt'
# The window icon: beside the installed uninstaller, or in assets when run from the app or a checkout. Loaded into
# memory when a window opens, so deleting the folder later does not matter.
$iconFile = @((Join-Path $PSScriptRoot 'app.ico'), (Join-Path (Split-Path -Parent $PSScriptRoot) 'assets\app.ico')) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
$progressUi = $null
function Step($text) {
    if ($Gui) { try { [IO.File]::WriteAllText($progressFile, $text) } catch { } } else { Write-Host $text -ForegroundColor Cyan }
}
function Start-ProgressWindow {
    if (-not $Gui -or $script:progressUi) { return }
    Remove-Item -LiteralPath ($progressFile + '.ready') -Force -ErrorAction SilentlyContinue
    if (-not (Test-Path -LiteralPath $progressFile)) { Step 'Preparing...' }
    $ui = @'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$file = $env:SANSKRIT_LEARNING_PROGRESS
$f = New-Object System.Windows.Forms.Form
$f.Text = 'Uninstall SanskritLearning'; $f.ClientSize = New-Object System.Drawing.Size(420, 130); $f.StartPosition = 'CenterScreen'
$f.FormBorderStyle = 'FixedDialog'; $f.ControlBox = $false; $f.TopMost = $true; $f.Font = New-Object System.Drawing.Font('Segoe UI', 9.5)
if ($env:SANSKRIT_LEARNING_ICON) { try { $f.Icon = New-Object System.Drawing.Icon $env:SANSKRIT_LEARNING_ICON } catch { } }
$title = New-Object System.Windows.Forms.Label; $title.Text = 'Uninstalling SanskritLearning...'; $title.Font = New-Object System.Drawing.Font('Segoe UI', 11, [System.Drawing.FontStyle]::Bold)
$title.Location = New-Object System.Drawing.Point(18, 14); $title.Size = New-Object System.Drawing.Size(390, 24)
$step = New-Object System.Windows.Forms.Label; $step.Location = New-Object System.Drawing.Point(18, 44); $step.Size = New-Object System.Drawing.Size(390, 22); $step.ForeColor = [System.Drawing.Color]::DimGray
$bar = New-Object System.Windows.Forms.ProgressBar; $bar.Style = 'Marquee'; $bar.MarqueeAnimationSpeed = 30
$bar.Location = New-Object System.Drawing.Point(18, 78); $bar.Size = New-Object System.Drawing.Size(384, 18)
$f.Controls.AddRange(@($title, $step, $bar))
# Started with a hidden console: open minimized and restore once shown, so Windows does not hide the form.
$f.Add_Load({ $this.WindowState = 'Minimized' })
$f.Add_Shown({ $this.WindowState = 'Normal'; $this.Activate(); try { [IO.File]::WriteAllText($file + '.ready', '1') } catch { } })
$t = New-Object System.Windows.Forms.Timer; $t.Interval = 150
$t.Add_Tick({ try { $s = [IO.File]::ReadAllText($file) } catch { $s = $null }; if ($s -eq 'done') { $t.Stop(); $f.Close() } elseif ($s) { $step.Text = $s } })
$t.Start(); [void]$f.ShowDialog()
'@
    $env:SANSKRIT_LEARNING_PROGRESS = $progressFile; $env:SANSKRIT_LEARNING_ICON = [string]$iconFile
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($ui))
    $script:progressUi = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -ArgumentList @('-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', $encoded) -WindowStyle Hidden -PassThru
}
function Stop-ProgressWindow {
    if (-not $Gui) { return }
    Step 'done'
    if ($script:progressUi -and -not $script:progressUi.WaitForExit(3000)) { Stop-Process -Id $script:progressUi.Id -Force -ErrorAction SilentlyContinue }
    Remove-Item -LiteralPath $progressFile, ($progressFile + '.ready') -Force -ErrorAction SilentlyContinue
}
function Show-Message([string]$text, [string]$icon = 'Information') {
    if ($Gui) { [void][System.Windows.Forms.MessageBox]::Show($text, 'SanskritLearning', 'OK', $icon) }
    else { $color = 'White'; if ($icon -eq 'Warning') { $color = 'Yellow' }; Write-Host ''; Write-Host $text -ForegroundColor $color }
}
# Stops with a clear account of what state SanskritLearning is in. Nothing done so far is undone, and nothing is left half-done.
function Stop-Uninstall([string]$what, [string]$state) {
    Stop-ProgressWindow
    Show-Message ('Uninstall stopped: ' + $what + "`r`n`r`n" + $state) 'Warning'
    exit 1
}

# The confirmation window. On Uninstall it turns into the progress view and closes once the progress window is on
# screen, so there is no moment without a window. Returns 'keep', 'delete', or $null when cancelled.
function Show-Confirmation {
    $form = New-Object System.Windows.Forms.Form
    $form.Text = 'Uninstall SanskritLearning'; $form.ClientSize = New-Object System.Drawing.Size(520, 250); $form.StartPosition = 'CenterScreen'
    $form.FormBorderStyle = 'FixedDialog'; $form.MaximizeBox = $false; $form.MinimizeBox = $false; $form.TopMost = $true; $form.Font = New-Object System.Drawing.Font('Segoe UI', 9.5)
    if ($iconFile) { try { $form.Icon = New-Object System.Drawing.Icon $iconFile } catch { } }
    $form.Add_Load({ $this.WindowState = 'Minimized' })
    $form.Add_Shown({ $this.WindowState = 'Normal'; $this.Activate(); $this.TopMost = $false })
    $text = New-Object System.Windows.Forms.Label
    $text.Text = "This removes SanskritLearning from this PC for your account:`r`n  - the background service, its login startup and Start menu entry`r`n  - the hook in every connected agent (each agent's settings are restored)`r`n  - the app, its Node.js runtime, your SanskritLearning settings and logs"
    $text.Location = New-Object System.Drawing.Point(16, 14); $text.Size = New-Object System.Drawing.Size(490, 90)
    $models = New-Object System.Windows.Forms.CheckBox
    $models.Text = 'Also delete the downloaded speech models (about 1 GB). Untick to keep them for a later install.'
    $models.Checked = $true; $models.Location = New-Object System.Drawing.Point(18, 112); $models.Size = New-Object System.Drawing.Size(488, 44)
    $bar = New-Object System.Windows.Forms.ProgressBar; $bar.Style = 'Marquee'; $bar.MarqueeAnimationSpeed = 30; $bar.Visible = $false
    $bar.Location = New-Object System.Drawing.Point(18, 120); $bar.Size = New-Object System.Drawing.Size(484, 18)
    $ok = New-Object System.Windows.Forms.Button; $ok.Text = 'Uninstall'; $ok.Location = New-Object System.Drawing.Point(280, 200); $ok.Size = New-Object System.Drawing.Size(110, 30)
    $cancel = New-Object System.Windows.Forms.Button; $cancel.Text = 'Cancel'; $cancel.Location = New-Object System.Drawing.Point(396, 200); $cancel.Size = New-Object System.Drawing.Size(110, 30); $cancel.DialogResult = 'Cancel'
    $form.Controls.AddRange(@($text, $models, $bar, $ok, $cancel)); $form.AcceptButton = $cancel; $form.CancelButton = $cancel
    $script:choice = $null; $script:waited = 0
    $watch = New-Object System.Windows.Forms.Timer; $watch.Interval = 150
    $watch.Add_Tick({ $script:waited += 150; if ((Test-Path -LiteralPath ($progressFile + '.ready')) -or $script:waited -gt 15000) { $watch.Stop(); $form.Close() } })
    $ok.Add_Click({
        $script:choice = 'keep'; if ($models.Checked) { $script:choice = 'delete' }
        $text.Font = New-Object System.Drawing.Font('Segoe UI', 11, [System.Drawing.FontStyle]::Bold); $text.Text = 'Uninstalling SanskritLearning...'
        $models.Visible = $false; $ok.Visible = $false; $cancel.Visible = $false; $bar.Visible = $true; $form.ControlBox = $false; $form.CancelButton = $null
        [System.Windows.Forms.Application]::DoEvents()
        Start-ProgressWindow; $watch.Start()
    })
    [void]$form.ShowDialog()
    return $script:choice
}

# --- Start ---------------------------------------------------------------------------------------------------------
if (-not (Enter-SetupLock)) { Show-Message 'SanskritLearning setup or uninstall is already running. Let it finish, then try again.' 'Warning'; exit 4 }

# Nothing installed: only remove entries a damaged installation may have left.
if (-not (Test-Path -LiteralPath $base)) {
    $leftovers = (Test-Path -LiteralPath $appsKey) -or [bool](Get-ItemProperty -LiteralPath $runKey -ErrorAction SilentlyContinue).SanskritLearning -or (Test-Path -LiteralPath $shortcut)
    Remove-ItemProperty -LiteralPath $runKey -Name 'SanskritLearning' -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $shortcut -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $appsKey -Recurse -Force -ErrorAction SilentlyContinue
    if ($leftovers) { Show-Message 'SanskritLearning was not installed any more. Its leftover startup and Settings > Apps entries were removed.' } else { Show-Message 'SanskritLearning is not installed.' }
    exit 0
}

if (-not $KeepModels -and -not $DeleteModels) {
    if ($Gui) {
        $answer = Show-Confirmation
        if (-not $answer) { exit 0 }
        if ($answer -eq 'keep') { $KeepModels = $true }
    } else {
        Write-Host 'Uninstall SanskritLearning' -ForegroundColor White
        $answer = Read-Host 'Delete the downloaded speech models too (about 1 GB)? Keep them to reinstall later without downloading. [D]elete / [K]eep (default: Delete)'
        if ($answer -match '^[kK]') { $KeepModels = $true }
    }
}
Start-ProgressWindow

# --- 1. Check, changing nothing ----------------------------------------------------------------------------------
$agentsScript = Join-Path $app 'scripts\agents.cjs'
$canDisconnect = (Test-Path -LiteralPath $node) -and (Test-Path -LiteralPath $agentsScript)
if ($canDisconnect) {
    Step 'Checking that every agent can be restored...'
    $problems = @(ConvertFrom-JsonList (& $node $agentsScript check-disconnect --json))
    if ($LASTEXITCODE -ne 0 -and -not $problems.Count) { Stop-Uninstall 'the agent check could not run.' 'Nothing was removed. Run Diagnose from the tray menu, then uninstall again.' }
    if ($problems.Count) {
        $list = ($problems | ForEach-Object { '  - ' + $_.name + ': ' + $(if ($_.file) { $_.file + ': ' } else { '' }) + $_.problem }) -join "`r`n"
        Stop-Uninstall ("these agent settings cannot be restored yet:`r`n" + $list) 'Nothing was removed; SanskritLearning is still installed and working. Close the agent (or fix the file) and uninstall again.'
    }
}

# --- 2. Agents -----------------------------------------------------------------------------------------------------
if ($canDisconnect) {
    Step 'Disconnecting agents and restoring their settings...'
    $results = @(ConvertFrom-JsonList (& $node $agentsScript disconnect all --json))
    $failed = @($results | Where-Object { $_.error })
    if (-not $results.Count -or $failed.Count) {
        $why = 'the agent step could not run.'; if ($failed.Count) { $why = ($failed | ForEach-Object { $_.name + ': ' + $_.error }) -join '; ' }
        Stop-Uninstall $why 'SanskritLearning is still installed and working. Agents already disconnected can be connected again from the tray menu > Connect agents. Fix the problem, then uninstall again.'
    }
    foreach ($r in $results) { foreach ($line in $r.lines) { if ($line -notmatch '^No SanskritLearning hook') { Say ('Agents: ' + $r.id + ': ' + $line) } } }
    if (@($results | Where-Object { -not $_.ok }).Count) { Say 'Agents: some agent files differed from their backups; the backups were kept beside them (*.sanskrit_learning.bak).' }
    else { Say 'Agents: every SanskritLearning hook removed.' }
} else { Say 'Agents: the app or its runtime was already missing, so agent hooks could not be checked. Install SanskritLearning again and uninstall it to remove them.' }

# --- 3. Nothing starts it again ------------------------------------------------------------------------------------
Step 'Removing login startup and the Start menu entry...'
Set-InstallState $base 'uninstalling'
Remove-ItemProperty -LiteralPath $runKey -Name 'SanskritLearning' -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $shortcut -Force -ErrorAction SilentlyContinue
if ([bool](Get-ItemProperty -LiteralPath $runKey -ErrorAction SilentlyContinue).SanskritLearning -or (Test-Path -LiteralPath $shortcut)) {
    Stop-Uninstall 'the login startup or Start menu entry could not be removed.' 'Agents are disconnected; the app files are still in place. Uninstall again from Settings > Apps.'
}
Say 'Startup: login entry and Start menu entry removed.'

# --- 4. Stop SanskritLearning -------------------------------------------------------------------------------------------
Step 'Stopping SanskritLearning...'
# Everything run by SanskritLearning's own runtime: the service, hooks in flight, the tray's helpers.
# Always counted as @(...): with a single match Windows PowerShell 5.1 returns the process itself, whose .Count is
# empty, so the service alone was once taken for "nothing running".
for ($i = 0; $i -lt 5 -and @(Get-ProcessesUnder $base).Count; $i++) { @(Get-ProcessesUnder $base) | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Start-Sleep -Milliseconds 600 }
$still = @(Get-ProcessesUnder $base)
if ($still.Count) { Stop-Uninstall ('SanskritLearning could not be stopped (' + (($still | ForEach-Object { $_.Name + ' ' + $_.ProcessId }) -join ', ') + ').') 'It will not start again at sign-in. Restart the PC, then uninstall again from Settings > Apps.' }
Say 'Service: stopped.'

# --- 5. Files ------------------------------------------------------------------------------------------------------
if ($KeepModels) { Step 'Deleting files (keeping the speech models)...' } else { Step 'Deleting files and speech models...' }
# Moving a folder aside fails if any file in it is in use, so this finds every blocked file before anything is deleted.
$suffix = '.removing-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
$items = @(Get-ChildItem -LiteralPath $base -Force | Where-Object { $_.Name -ne 'uninstaller' -and $_.Name -ne 'state.json' -and $_.Name -notmatch '\.(old|removing)-[0-9a-f]{8}$' })
$moved = New-Object System.Collections.Generic.List[string]
foreach ($item in $items) {
    $to = $item.FullName + $suffix; $ok = $false
    for ($i = 0; $i -lt 5 -and -not $ok; $i++) { try { Move-Item -LiteralPath $item.FullName -Destination $to -ErrorAction Stop; $ok = $true } catch { Start-Sleep -Milliseconds 600 } }
    if (-not $ok) {
        # Put back what was already moved: the installation stays as it was, only disconnected and not starting.
        foreach ($m in $moved) { Move-Item -LiteralPath $m -Destination ($m.Substring(0, $m.Length - $suffix.Length)) -ErrorAction SilentlyContinue }
        # Name the programs that mention the folder on their command line (an editor or terminal opened there, a log viewer).
        $users = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.IndexOf($base, [StringComparison]::OrdinalIgnoreCase) -ge 0 } | ForEach-Object { $_.Name + ' (process ' + $_.ProcessId + ')' } | Select-Object -Unique -First 5)
        $who = ''; if ($users.Count) { $who = ' Programs that refer to it: ' + ($users -join ', ') + '.' }
        Stop-Uninstall ($item.FullName + ' is in use by another program.' + $who) 'No files were deleted. Close any window or program using that folder (or restart the PC), then uninstall again from Settings > Apps.'
    }
    $moved.Add($to)
}
# Models to keep go back to their place inside app\assets, so setup finds and re-verifies them. They are also taken
# from the app folder of an earlier uninstall that stopped after moving it aside.
if ($KeepModels) {
    New-Item -ItemType Directory -Path (Join-Path $app 'assets') -Force | Out-Null
    $oldApps = @($app + $suffix) + @(Get-ChildItem -LiteralPath $base -Directory -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^app\.(old|removing)-[0-9a-f]{8}$' } | ForEach-Object { $_.FullName })
    foreach ($oldApp in $oldApps) {
        foreach ($keep in @('assets\models', 'assets\models-verified.json')) {
            if ((Test-Path -LiteralPath (Join-Path $oldApp $keep)) -and -not (Test-Path -LiteralPath (Join-Path $app $keep))) { Move-Item -LiteralPath (Join-Path $oldApp $keep) -Destination (Join-Path $app $keep) -ErrorAction SilentlyContinue }
        }
        try {
            $retired = (Get-Content -LiteralPath (Join-Path $oldApp 'assets\live-models.json') -Raw | ConvertFrom-Json).retired
            foreach ($r in $retired) { $dir = Join-Path $app ($r.path -replace '/', '\'); if (Test-Path -LiteralPath $dir) { Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue } }
        } catch { }
    }
}
Remove-InterruptedLeftovers $base
$left = @(Get-ChildItem -LiteralPath $base -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '\.(old|removing)-[0-9a-f]{8}$' })
if ($left.Count) { Stop-Uninstall ('some files could not be deleted (' + $left[0].FullName + ').') 'SanskritLearning is stopped and disconnected, and will not start again. Restart the PC, then uninstall again from Settings > Apps to delete the rest.' }
if ($KeepModels) { Say ('Files: removed. The speech models were kept in ' + (Join-Path $app 'assets') + '; setup will reuse them, or delete ' + $base + ' to remove them.') }
else { Say ('Files: ' + $base + ' deleted, including the speech models.') }

# --- 6. Settings > Apps entry, then the uninstaller itself ------------------------------------------------------------
Step 'Finishing...'
Remove-Item -LiteralPath $appsKey -Recurse -Force -ErrorAction SilentlyContinue
Say 'Settings > Apps: entry removed.'
# PowerShell has read this whole script, so its folder can go too.
Remove-Item -LiteralPath (Join-Path $base 'uninstaller'), (Join-Path $base 'state.json') -Recurse -Force -ErrorAction SilentlyContinue
if (-not $KeepModels) { Remove-Item -LiteralPath $base -Recurse -Force -ErrorAction SilentlyContinue }
# Setup's log, launchers left in %TEMP% by earlier runs, and the copies made when this run left an app's sandbox.
Remove-StaleLaunchers
Remove-Item -LiteralPath (Join-Path $env:TEMP 'sanskrit_learning-setup.log') -Force -ErrorAction SilentlyContinue
if ($PSScriptRoot -ieq $env:TEMP.TrimEnd('\')) { Remove-Item -LiteralPath (Join-Path $env:TEMP 'windows-shell.ps1'), $PSCommandPath -Force -ErrorAction SilentlyContinue }
Say 'SanskritLearning was uninstalled.'
Stop-ProgressWindow
Show-Message ($log -join "`r`n`r`n")
