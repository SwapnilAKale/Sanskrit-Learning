# Per-user launcher (login startup and the Start menu shortcut). Reads only the installation record beside this file.
$ErrorActionPreference = 'Stop'
try {
    # Single instance: do nothing if the resident recorded in endpoint.json is still running.
    $endpoint = Join-Path $PSScriptRoot 'endpoint.json'
    if (Test-Path -LiteralPath $endpoint) {
        $running = Get-Content -LiteralPath $endpoint -Raw | ConvertFrom-Json
        $process = Get-CimInstance Win32_Process -Filter ('ProcessId=' + [int]$running.pid) -ErrorAction SilentlyContinue
        if ($process -and $process.CommandLine -like '*resident.cjs*') { exit 0 }
    }
    # Start only a finished installation (state.json beside the profile folder, written by setup and uninstall): a setup
    # that stopped halfway, or an uninstall in progress, must not start a mix of old and new files.
    $state = $null
    try { $state = (Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\state.json') -Raw | ConvertFrom-Json).state } catch { }
    if ($state -eq 'uninstalling') { exit 0 }
    if ($state -eq 'installing') {
        Add-Type -AssemblyName System.Windows.Forms
        [void][System.Windows.Forms.MessageBox]::Show("SanskritLearning setup did not finish, so SanskritLearning was not started.`r`n`r`nRun setup again to complete it: open PowerShell in the SanskritLearning folder you downloaded and run .\setup.cmd, or run:`r`n" + (Join-Path (Split-Path -Parent $PSScriptRoot) 'app\setup.cmd'), 'SanskritLearning', 'OK', 'Warning')
        exit 0
    }
    $install = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'install.json') -Raw | ConvertFrom-Json
    $entry = Join-Path $install.root 'src\pc\resident.cjs'
    if (-not (Test-Path -LiteralPath $entry)) { throw 'SanskritLearning project was moved. Run install-resident.ps1 from its new location.' }
    # Node's native named mutex also prevents duplicate tray processes and model loads.
    Start-Process -FilePath $install.node -ArgumentList @(('"' + $entry + '"'),('"' + $install.root + '"'),('"' + $PSScriptRoot + '"')) -WorkingDirectory $install.root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $PSScriptRoot 'resident.log') -RedirectStandardError (Join-Path $PSScriptRoot 'resident-error.log')
} catch {
    $_.Exception.Message | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'startup-error.log')
}
