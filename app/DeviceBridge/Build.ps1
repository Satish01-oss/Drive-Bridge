param([switch]$Portable)
$ErrorActionPreference = 'Stop'
$project = Join-Path $PSScriptRoot 'DeviceBridge.csproj'
node (Join-Path $PSScriptRoot '..\..\scripts\build-remote-client.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Remote client bundle failed.' }
if ($Portable) {
    dotnet publish $project -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o (Join-Path $PSScriptRoot 'portable')
} else {
    dotnet build $project -c Release
}
if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
