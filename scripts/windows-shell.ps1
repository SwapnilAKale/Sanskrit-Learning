# Helpers shared by setup, uninstall and install-resident (dot-source this file).
#
# Packaged (MSIX) apps such as the Claude desktop app give themselves, and every program started from their terminal,
# a private copy of %LOCALAPPDATA%: writes land in %LOCALAPPDATA%\Packages\<app>\LocalCache\Local. SanskritLearning installed
# from such a terminal is invisible to Windows itself, so the sign-in entry and the Start menu cannot start it.

# The packaged app whose private AppData this process writes to, or $null when %LOCALAPPDATA% is the real one.
# Writes a probe file and looks for it in each app's private copy.
function Get-AppDataRedirect([string]$Base = $env:LOCALAPPDATA) {
    $name = 'sanskrit_learning-probe-' + [guid]::NewGuid().ToString('N')
    $probe = Join-Path $Base $name
    try {
        Set-Content -LiteralPath $probe -Value 'probe'
        foreach ($package in (Get-ChildItem -LiteralPath (Join-Path $Base 'Packages') -Directory -ErrorAction SilentlyContinue)) {
            if (Test-Path -LiteralPath (Join-Path $package.FullName ('LocalCache\Local\' + $name))) { return $package.Name }
        }
        return $null
    } finally { Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue }
}

# Opens a file through the Windows shell (Explorer), as a double-click would. The program it starts belongs to the
# desktop, not to this window: it sees the real AppData and keeps running when this window, or the app hosting it,
# closes. (A program started directly from here would share this window's sandbox and its job object.)
function Start-ViaShell([string]$Path) {
    & (Join-Path $env:SystemRoot 'explorer.exe') $Path
}

# --- One setup or uninstall at a time, and an installation that is either whole or clearly marked unfinished ---------

# Setup and uninstall take this lock: two at once would race on the same folders. Released when the process exits,
# also if it is killed. Returns $false when another one holds it.
function Enter-SetupLock {
    $script:setupLock = New-Object Threading.Mutex($false, 'Local\SanskritLearningSetup')
    try { return $script:setupLock.WaitOne(0) } catch [Threading.AbandonedMutexException] { return $true }
}

# %LOCALAPPDATA%\SanskritLearning\state.json: 'installing' while setup changes files, 'ready' when it finished, 'uninstalling'
# once uninstall started removing. The launcher starts SanskritLearning only when it is 'ready' (or the file is absent, for an
# installation made before this file existed); Diagnose reports any other state.
function Set-InstallState([string]$Base, [string]$State) {
    New-Item -ItemType Directory -Path $Base -Force | Out-Null
    $file = Join-Path $Base 'state.json'
    [IO.File]::WriteAllText($file + '.tmp', (@{ state = $State; at = (Get-Date).ToString('o') } | ConvertTo-Json -Compress))
    Move-Item -LiteralPath ($file + '.tmp') -Destination $file -Force
}
# Processes whose program file is inside $Base. Wrap the call in @(...) before counting: one match comes back as the
# process itself, and Windows PowerShell 5.1 gives it no .Count.
function Get-ProcessesUnder([string]$Base) {
    $prefix = $Base.TrimEnd('\') + '\'
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) }
}
# The items of a JSON array, one by one. Windows PowerShell 5.1's ConvertFrom-Json returns an array as one object, so
# @(... | ConvertFrom-Json) counts '[]' and every longer array as a single item.
function ConvertFrom-JsonList([string[]]$Text) {
    foreach ($item in (($Text -join "`n") | ConvertFrom-Json)) { $item }
}
function Get-InstallState([string]$Base) {
    try { return (Get-Content -LiteralPath (Join-Path $Base 'state.json') -Raw | ConvertFrom-Json).state } catch { return $null }
}

# Puts each staged copy in place of its target by renaming, after moving the current target aside. If any rename
# fails, every swap already made is undone, so the targets are either all new or all as they were. The old copies are
# deleted only when all swaps succeeded. Pairs: @{ Staged = <path>; Target = <path> } (files or folders, same volume).
function Install-Staged([object[]]$Pairs) {
    $suffix = '.old-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
    $done = New-Object System.Collections.Generic.List[object]
    try {
        foreach ($pair in $Pairs) {
            $old = $null
            if (Test-Path -LiteralPath $pair.Target) { $old = $pair.Target + $suffix; Move-Item -LiteralPath $pair.Target -Destination $old -ErrorAction Stop }
            $done.Add(@($pair.Target, $old))
            New-Item -ItemType Directory -Path (Split-Path -Parent $pair.Target) -Force | Out-Null
            Move-Item -LiteralPath $pair.Staged -Destination $pair.Target -ErrorAction Stop
        }
    } catch {
        for ($i = $done.Count - 1; $i -ge 0; $i--) {
            $target, $old = $done[$i]
            if ($old) { if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction SilentlyContinue }; Move-Item -LiteralPath $old -Destination $target -Force -ErrorAction SilentlyContinue }
            elseif (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction SilentlyContinue }
        }
        throw
    }
    foreach ($entry in $done) { if ($entry[1]) { Remove-Item -LiteralPath $entry[1] -Recurse -Force -ErrorAction SilentlyContinue } }
}

# Leftovers of a setup or uninstall that was interrupted: staging folders, old copies kept for a rollback, and folders
# renamed for removal. Safe to delete: the installation itself never depends on them.
function Remove-InterruptedLeftovers([string]$Base) {
    if (-not (Test-Path -LiteralPath $Base)) { return }
    Remove-Item -LiteralPath (Join-Path $Base 'staging') -Recurse -Force -ErrorAction SilentlyContinue
    foreach ($dir in @($Base, (Join-Path $Base 'runtime'), (Join-Path $Base 'app'), (Join-Path $Base 'app\assets'))) {
        Get-ChildItem -LiteralPath $dir -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '\.(old|removing)-[0-9a-f]{8}$' } |
            ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }
    }
}

# Launchers from earlier runs whose window was closed before the launcher could delete itself: all but the running one.
function Remove-StaleLaunchers {
    Get-ChildItem -LiteralPath $env:TEMP -Filter 'sanskrit_learning-*.cmd' -File -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -ine $env:SANSKRIT_LEARNING_LAUNCHER } | Remove-Item -Force -ErrorAction SilentlyContinue
}

# Re-runs a script in a new, ordinary PowerShell window opened through the shell, passing its arguments on.
# The temporary .cmd lives in %TEMP%, which packaged apps do not redirect, and deletes itself.
function Restart-OutsideSandbox([string]$Script, [string[]]$Arguments, [string]$App) {
    $cmd = Join-Path $env:TEMP ('sanskrit_learning-' + [IO.Path]::GetFileNameWithoutExtension($Script) + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8) + '.cmd')
    $quoted = ($Arguments | ForEach-Object { '"' + $_ + '"' }) -join ' '
    @(
        '@echo off',
        'title SanskritLearning',
        'set "SANSKRIT_LEARNING_LAUNCHER=%~f0"',
        ('powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "' + $Script + '" ' + $quoted),
        'echo.',
        'pause',
        '(goto) 2>nul & del "%~f0"'
    ) | Set-Content -LiteralPath $cmd -Encoding ASCII
    Write-Host ''
    Write-Host ('This window runs inside an app (' + $App + ') that keeps its own private copy of AppData.') -ForegroundColor Yellow
    Write-Host 'Anything installed from here would be invisible to Windows, so SanskritLearning could not start at sign-in or from the Start menu.' -ForegroundColor Yellow
    Write-Host 'Continuing in a new PowerShell window...' -ForegroundColor Yellow
    Start-ViaShell $cmd
}
