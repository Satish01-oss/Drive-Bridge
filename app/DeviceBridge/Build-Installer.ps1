param([string]$Compiler, [switch]$SkipPublish)
$ErrorActionPreference = 'Stop'
if (-not $SkipPublish) { & (Join-Path $PSScriptRoot 'Build.ps1') -Portable }
[xml]$project = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'DeviceBridge.csproj')
$version = [string]$project.Project.PropertyGroup.Version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'A three-part version is required.' }
$appExe = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'portable/DeviceBridge.exe')).Path
if (-not $Compiler) {
    $found = Get-Command ISCC.exe -ErrorAction SilentlyContinue
    if ($found) { $Compiler = $found.Source }
    else {
        foreach ($base in @(${env:ProgramFiles(x86)}, $env:ProgramFiles)) {
            foreach ($edition in @('Inno Setup 6', 'Inno Setup 7')) {
                $candidate = Join-Path $base "$edition/ISCC.exe"
                if (Test-Path -LiteralPath $candidate) { $Compiler = $candidate; break }
            }
            if ($Compiler) { break }
        }
    }
}
if (-not $Compiler -or -not (Test-Path -LiteralPath $Compiler)) { throw 'Install Inno Setup 6/7, or supply -Compiler with the path to ISCC.exe.' }
$outputPath = Join-Path $PSScriptRoot 'installer-output'
New-Item -ItemType Directory -Force -Path $outputPath | Out-Null
& $Compiler "/DAppVersion=$version" "/DAppExe=$appExe" "/DOutputPath=$outputPath" (Join-Path $PSScriptRoot 'installer/DeviceBridge.iss')
if ($LASTEXITCODE -ne 0) { throw 'Installer compilation failed.' }
$setup = Join-Path $outputPath "DeviceBridge-Setup-$version.exe"
$hash = (Get-FileHash -LiteralPath $setup -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  DeviceBridge-Setup-$version.exe" | Set-Content -LiteralPath (Join-Path $outputPath 'SHA256.txt') -Encoding utf8
Write-Output $setup
