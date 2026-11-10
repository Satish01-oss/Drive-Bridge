param([Parameter(Mandatory=$true)][string]$Installer)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true') { throw 'This install/reinstall/uninstall smoke test is restricted to the disposable GitHub runner.' }
$testRoot = [IO.Path]::GetFullPath($env:RUNNER_TEMP)
$installDir = [IO.Path]::GetFullPath((Join-Path $testRoot ('DeviceBridge-Installer-Test-' + [Guid]::NewGuid().ToString('N'))))
if (-not $installDir.StartsWith($testRoot + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Test install directory must remain inside RUNNER_TEMP.' }
$desktop = [Environment]::GetFolderPath('DesktopDirectory')
if (-not $desktop) { $desktop = Join-Path $env:USERPROFILE 'Desktop' }
New-Item -ItemType Directory -Force -Path $desktop | Out-Null
$shortcutPath = Join-Path $desktop 'DeviceBridge.lnk'
$setup = (Resolve-Path -LiteralPath $Installer).Path
$expectedHash = (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'portable/DeviceBridge.exe')).Hash
foreach ($attempt in 1,2) {
    $process = Start-Process -FilePath $setup -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/TASKS=desktopicon',('/DIR="' + $installDir + '"')) -WindowStyle Hidden -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "Install/reinstall failed: $($process.ExitCode)" }
    $installedExe = Join-Path $installDir 'DeviceBridge.exe'
    if ((Get-FileHash -LiteralPath $installedExe).Hash -ne $expectedHash) { throw 'Installed app differs from the tested app.' }
    $shell = New-Object -ComObject WScript.Shell
    if (-not (Test-Path -LiteralPath $shortcutPath) -or $shell.CreateShortcut($shortcutPath).TargetPath -ne $installedExe) { throw 'Desktop shortcut is missing or points to the wrong app.' }
    $startLink = Join-Path ([Environment]::GetFolderPath('Programs')) 'DeviceBridge.lnk'
    if (-not (Test-Path -LiteralPath $startLink) -or $shell.CreateShortcut($startLink).TargetPath -ne $installedExe) { throw 'Start menu shortcut is missing or points to the wrong app.' }
    $entry = Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\{7344E2DF-3B58-4B13-8C38-A4131B2594B2}_is1'
    if ($entry.DisplayName -ne 'DeviceBridge') { throw 'Installed Apps entry is missing.' }
    Write-Output "Install/reinstall $attempt passed: app, desktop, Start menu and uninstall registration verified."
}
$uninstaller = Join-Path $installDir 'unins000.exe'
$process = Start-Process -FilePath $uninstaller -ArgumentList '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART' -WindowStyle Hidden -Wait -PassThru
if ($process.ExitCode -ne 0 -or (Test-Path -LiteralPath $installedExe) -or (Test-Path -LiteralPath $shortcutPath)) { throw 'Uninstall did not remove the installed app and desktop shortcut.' }
Write-Output 'Uninstall passed. Saved pairing/preferences are intentionally retained.'
