param(
    [Parameter(Mandatory=$true)][string]$CertificateThumbprint,
    [string]$Executable = (Join-Path $PSScriptRoot 'portable\DeviceBridge.exe')
)
$ErrorActionPreference = 'Stop'
$resolvedExecutable = (Resolve-Path -LiteralPath $Executable).Path
$thumb = $CertificateThumbprint.Replace(' ', '')
if ($thumb -notmatch '^[0-9a-fA-F]{40}$') { throw 'Provide a certificate thumbprint, not a password or private key.' }
$certificate = Get-Item -LiteralPath "Cert:\CurrentUser\My\$thumb" -ErrorAction SilentlyContinue
if (-not $certificate) { $certificate = Get-Item -LiteralPath "Cert:\LocalMachine\My\$thumb" -ErrorAction SilentlyContinue }
if (-not $certificate -or -not $certificate.HasPrivateKey) { throw 'A code-signing certificate with a private key must already be available in the Windows certificate store.' }
if ($certificate.NotAfter -le [DateTime]::Now -or $certificate.Subject -eq $certificate.Issuer) { throw 'Use an unexpired certificate from a trusted publisher authority, not a self-signed certificate.' }
$codeSigningUsage = @($certificate.Extensions | Where-Object { $_ -is [System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension] } | ForEach-Object { $_.EnhancedKeyUsages } | Where-Object { $_.Value -eq '1.3.6.1.5.5.7.3.3' })
if ($codeSigningUsage.Count -eq 0) { throw 'The selected certificate is not for code signing.' }
$signature = Set-AuthenticodeSignature -LiteralPath $resolvedExecutable -Certificate $certificate -HashAlgorithm SHA256 -TimestampServer 'http://timestamp.digicert.com'
if ($signature.Status -ne 'Valid') { throw "Signing did not verify as trusted: $($signature.Status). Do not publish this artifact." }
Get-AuthenticodeSignature -LiteralPath $resolvedExecutable | Select-Object Status,@{Name='Publisher';Expression={$_.SignerCertificate.Subject}}
Write-Output 'Repackage the website download from this signed executable before publication. Signing does not guarantee SmartScreen reputation.'
