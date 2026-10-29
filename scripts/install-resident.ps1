# Installs SanskritLearning for the current Windows user: login startup and a Start menu shortcut. -Uninstall removes both.
param([switch]$Uninstall, [switch]$StartNow)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$profileDir = Join-Path $env:LOCALAPPDATA 'SanskritLearning\resident'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
# Start menu shortcut.
$shortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'SanskritLearning.lnk'
if ($Uninstall) {
    # Quit the running service first: the process recorded in endpoint.json, if it is ours.
    $endpointFile = Join-Path $profileDir 'endpoint.json'
    if (Test-Path -LiteralPath $endpointFile) {
        try {
            $running = Get-Content -LiteralPath $endpointFile -Raw | ConvertFrom-Json
            $process = Get-CimInstance Win32_Process -Filter ('ProcessId=' + [int]$running.pid) -ErrorAction SilentlyContinue
            if ($process -and $process.CommandLine -like '*resident.cjs*') { Stop-Process -Id $process.ProcessId -Force; Start-Sleep -Milliseconds 500 }
        } catch { }
        Remove-Item -LiteralPath $endpointFile -ErrorAction SilentlyContinue
    }
    Remove-ItemProperty -LiteralPath $runKey -Name 'SanskritLearning' -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $shortcut -ErrorAction SilentlyContinue
    Write-Output 'SanskritLearning stopped; login startup and Start menu shortcuts removed. Your settings, drafts and logs were kept in the profile folder.'
    exit 0
}
# The runtime setup installs beside the app (%LOCALAPPDATA%\SanskritLearning\runtime\node); in a development checkout, node on PATH.
$nodePath = [IO.Path]::GetFullPath((Join-Path $projectRoot '..\runtime\node\node.exe'))
if (-not (Test-Path -LiteralPath $nodePath)) { $nodePath = (Get-Command node.exe -CommandType Application).Source }
New-Item -ItemType Directory -Path $profileDir -Force | Out-Null
# Restrict the token, settings and retained drafts to this Windows user and SYSTEM.
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = New-Object Security.AccessControl.DirectorySecurity
$acl.SetOwner($sid)
$acl.SetAccessRuleProtection($true, $false)
foreach ($identity in @($sid, (New-Object Security.Principal.SecurityIdentifier 'S-1-5-18'))) {
    $rule = New-Object Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.AddAccessRule($rule)
}
# SetAccessControl writes only the owner and access list. Set-Acl also rewrote the audit list,
# which needs SeSecurityPrivilege and failed for a standard user.
(Get-Item -LiteralPath $profileDir).SetAccessControl($acl)
@{ root = $projectRoot; node = $nodePath } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $profileDir 'install.json') -Encoding UTF8
$launcher = Join-Path $profileDir 'start-resident.ps1'
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'start-resident.ps1') -Destination $launcher -Force
$powerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$command = '"' + $powerShell + '" -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $launcher + '"'
New-Item -Path $runKey -Force | Out-Null
New-ItemProperty -LiteralPath $runKey -Name 'SanskritLearning' -Value $command -PropertyType String -Force | Out-Null
# Starts SanskritLearning after Quit without signing out; the launcher does nothing if it is already running.
$link = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcut)
$link.TargetPath = $powerShell
$link.Arguments = '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $launcher + '"'
$link.WorkingDirectory = $profileDir
$link.WindowStyle = 7
$link.Description = 'Start SanskritLearning (does nothing if it is already running)'
$icon = Join-Path $projectRoot 'assets\app.ico'
if (Test-Path -LiteralPath $icon) { $link.IconLocation = $icon + ',0' }
$link.Save()
Write-Output 'SanskritLearning login startup and Start menu shortcuts installed for the current Windows user. No administrator rights or scheduled task used.'
# Start it the way the Start menu does, through the Windows shell: started directly from this window, it would belong
# to this window's job (and die when the window or the app hosting it closes) and could share an app's private AppData.
if ($StartNow) { . (Join-Path $PSScriptRoot 'windows-shell.ps1'); Start-ViaShell $shortcut }
