# DeviceBridge Windows app source

This is the Windows Forms / .NET 8 source for DeviceBridge **0.8.0**. The website is in `../../dist/`. Source code, third-party notices, bundled driver archive and regression checks are saved together here. Generated build directories and user connection data are excluded from Git.

## Build on Windows

Install the **.NET 8 SDK** on a Windows 10/11 x64 development PC. End users downloading the self-contained app do not need the SDK or a separate runtime.

From this repository's root, use PowerShell:

```powershell
./app/DeviceBridge/Build.ps1
./app/DeviceBridge/Build.ps1 -Portable
```

To create the normal installed Windows app, install Inno Setup 6/7 on the build machine and run `./app/DeviceBridge/Build-Installer.ps1` from the repository root. The result is `app/DeviceBridge/installer-output/DeviceBridge-Setup-0.8.0.exe`. It installs per user, creates desktop and Start menu shortcuts, and registers an uninstall entry in Windows Settings. The end user needs only this one installer.

The first command builds the source; the second publishes the complete app, runtime and included driver as `app/DeviceBridge/portable/DeviceBridge.exe`. NuGet restores the package versions declared in `DeviceBridge.csproj`. No development SDK or generated `bin/obj` files need to be committed.

## Test

```powershell
$exe = Resolve-Path app/DeviceBridge/portable/DeviceBridge.exe
$process = Start-Process -FilePath $exe -ArgumentList '--self-test' -Wait -PassThru -WindowStyle Hidden
Get-Content app/DeviceBridge/portable/self-test-result.txt
if ($process.ExitCode -ne 0) { throw 'Regression checks failed' }
```

The checks exercise local secure pairing, reconnect, packet transport, input geometry, audio buffering and window lifetime. They do not install a driver, send input to another PC, or verify physical audio devices. Test actual device sharing using `TWO-PC-TEST.txt`. The user reported keyboard, mouse, speakers/headphones and microphone working with v0.7.0 between a Wi-Fi PC and Ethernet PC on the same router.

GitHub Actions runs the Windows build and regression checks for app changes. Its artifact contains a versioned self-contained EXE, checksum and test report. Builds remain unsigned until a trusted signing step is performed. Publishing the versioned EXE in a stable GitHub Release updates the public website automatically.

## Update and release

1. Edit the app here and update `<Version>` in `DeviceBridge.csproj` for a new release.
2. Build with `-Portable`, run regression checks and test on two Windows PCs.
3. If a trusted publisher certificate is available, sign the executable with `Sign-Release.ps1 -CertificateThumbprint <thumbprint>`. The default target is `portable/DeviceBridge.exe`. Keep private keys and certificates out of Git.
4. Build the installer with `Build-Installer.ps1`. The Windows workflow produces `DeviceBridge-Setup-<version>.exe` automatically and tests installation, desktop/Start menu shortcuts, reinstallation and uninstallation on its disposable runner. Sign the app before building the installer, then sign the final installer too when trusted signing is available; signing changes checksums.
5. Publish a normal GitHub Release tagged `v<version>` with the installer EXE attached. Pages automatically packages and verifies it, updates both downloads and the visible website version, and deploys. There is no need to edit the website manifests or split the EXE manually. See [release instructions](../../RELEASING.md).

The original embedded archive must remain unchanged: `vendor/VBCABLE_Driver_Pack46.zip`, SHA-256 `bc44e8974191a5a2427d6c979e2dab08dbb09925f3f435dfa2f0ba3e45b6eb90`. The app checks this hash before exposing its installer.

See `README.txt` for app usage, `ARCHITECTURE.txt` and `ARCHITECTURE.md` for implementation notes, `SIGNING-AND-DRIVER.txt` for signing and driver history, and `THIRD-PARTY-NOTICES.txt` plus `licenses/` for dependencies. Some older notes describe earlier testing milestones; the current reported two-PC result is recorded above. The third-party driver, runtime libraries and photographs retain their respective licenses.
