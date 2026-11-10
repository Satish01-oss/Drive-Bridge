param([string]$Compiler, [switch]$SkipPublish, [string]$WebViewRuntime)
$ErrorActionPreference = 'Stop'
if (-not $SkipPublish) { & (Join-Path $PSScriptRoot 'Build.ps1') -Portable }
[xml]$project = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'DeviceBridge.csproj')
$version = [string]$project.Project.PropertyGroup.Version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'A three-part version is required.' }
$appExe = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'portable/DeviceBridge.exe')).Path
# Bundle the full Microsoft installer. End users never download a second file.
if (-not $WebViewRuntime) {
    $cache = Join-Path $PSScriptRoot 'installer-cache'
    New-Item -ItemType Directory -Force -Path $cache | Out-Null
    $WebViewRuntime = Join-Path $cache 'MicrosoftEdgeWebView2RuntimeInstallerX64.exe'
    if (-not (Test-Path -LiteralPath $WebViewRuntime)) {
        $partial = $WebViewRuntime + '.download'
        $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
        if ($curl) {
            & $curl.Source --fail --location --silent --show-error --retry 2 --max-time 600 --output $partial 'https://go.microsoft.com/fwlink/?linkid=2124701'
            if ($LASTEXITCODE -ne 0) { throw 'The Microsoft offline runtime download did not finish.' }
        } else {
            Invoke-WebRequest -Uri 'https://go.microsoft.com/fwlink/?linkid=2124701' -OutFile $partial -TimeoutSec 600
        }
        $downloadSignature = Get-AuthenticodeSignature -LiteralPath $partial
        if ($downloadSignature.Status -ne 'Valid' -or $downloadSignature.SignerCertificate.Subject -notmatch '(^|,\s*)O=Microsoft Corporation(,|$)') { throw 'Microsoft runtime download signature verification failed.' }
        Move-Item -LiteralPath $partial -Destination $WebViewRuntime -Force
    }
}
$WebViewRuntime = (Resolve-Path -LiteralPath $WebViewRuntime).Path
$signature = Get-AuthenticodeSignature -LiteralPath $WebViewRuntime
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch '(^|,\s*)O=Microsoft Corporation(,|$)') {
    throw 'The bundled WebView2 runtime must have a valid Microsoft Corporation signature.'
}
$runtimeSize = (Get-Item -LiteralPath $WebViewRuntime).Length
if ($runtimeSize -lt 20MB -or $runtimeSize -gt 512MB) { throw 'Unexpected offline WebView2 installer size.' }
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
& $Compiler "/DAppVersion=$version" "/DAppExe=$appExe" "/DWebViewRuntime=$WebViewRuntime" "/DOutputPath=$outputPath" (Join-Path $PSScriptRoot 'installer/DeviceBridge.iss')
if ($LASTEXITCODE -ne 0) { throw 'Installer compilation failed.' }
$setup = Join-Path $outputPath "DeviceBridge-Setup-$version.exe"
$hash = (Get-FileHash -LiteralPath $setup -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  DeviceBridge-Setup-$version.exe" | Set-Content -LiteralPath (Join-Path $outputPath 'SHA256.txt') -Encoding utf8
@{ source = 'https://go.microsoft.com/fwlink/?linkid=2124701'; sha256 = (Get-FileHash -LiteralPath $WebViewRuntime -Algorithm SHA256).Hash.ToLowerInvariant(); bytes = $runtimeSize; publisher = $signature.SignerCertificate.Subject } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $outputPath 'bundled-runtime.json') -Encoding utf8
Write-Output $setup
