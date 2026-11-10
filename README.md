# DeviceBridge — Windows app, Android companion and download website

A static, responsive download website for DeviceBridge, the Windows app for sharing a keyboard, mouse, speakers/headphones and microphone between two PCs on the same trusted network. Wi-Fi and Ethernet can be mixed.

Windows 10/11 x64. The website follows the latest published stable GitHub Release. Before the first stable release, it serves the checked-in **0.7.0** preview.

Public website: https://satish01-oss.github.io/Drive-Bridge/

Windows + Android remote preview: https://satish01-oss.github.io/Drive-Bridge/remote-preview.html

Progress and acceptance evidence: https://satish01-oss.github.io/Drive-Bridge/improvements.html

Stable Windows is **0.8.0**. The separate **0.9.0-preview.4** adds the native Windows remote host and signed Android companion. Its source-pinned release includes both installers and SHA-256 sums. Local screen/input/background tests and automated checks pass; physical Android, audio and separate-network recovery acceptance remain pending. No TURN relay is configured.

Original public website: https://devicebridge-windows.majorpiece.chatgpt.site

## Repository layout

- `remote/`: Signed pairing/signaling service, shared WebRTC client and remote protocol documentation. See [development status](remote/README.md).
- `android/`: Native Android companion, protected identity storage and APK build instructions.
- `app/DeviceBridge/`: Windows app source, build/signing scripts, regression checks, original driver bundle and third-party notices. See [app build instructions](app/DeviceBridge/README.md).
- `dist/`: Complete public download website, photographs, release manifests and app download data.
- `scripts/verify-site.mjs`: Website link and EXE integrity validation.
- `scripts/sync-github-release.mjs`: Fetches, verifies and packages the latest GitHub Release during deployment.
- `.github/workflows/`: Automatic website publication and Windows app build/testing.

Website changes publish through GitHub Pages. App changes build and test on a Windows runner and produce a versioned installer in the workflow artifact. **Publishing a stable GitHub Release with that installer EXE automatically updates the website.** See [release instructions](RELEASING.md). Updating app source alone does not release a new download.

## Hosting

New Windows/Android improvements are tracked in `docs/improvements-status.json`. Run `node scripts/build-improvements.mjs` after updating evidence. Parent features stay in progress until physical acceptance passes.

The [project checklist](docs/DeviceBridge-Checklist.html) tracks completed implementation and the remaining two-PC acceptance checks. Edit `docs/project-status.json` with verified evidence and run `node scripts/build-checklist.mjs` to regenerate the standalone HTML. Manual checkbox changes stay in the browser; the HTML can also save an updated offline copy. Checkboxes do not start device sharing; pairing happens in the installed Windows app.

The complete website is in `dist/`. Publish that directory on any HTTPS static host; no installation or build step is required. All site links are relative, including the two-PC test guide, so it also works under a repository path.

The included GitHub Actions workflow validates the downloads and publishes `dist/` to GitHub Pages after pushes to `main`. For first-time Pages setup, select **Settings → Pages → Source → GitHub Actions**, then run **Verify and publish website** from the Actions tab if needed. The Pages URL appears in the deployment output once deployment succeeds.

## Download files

The Pages workflow reads GitHub's latest stable Release, downloads its versioned Windows installer (or a legacy portable x64 EXE) and validates its size, executable format and GitHub SHA-256 digest when available. It generates both manifests, download parts, visible version/date, and a release-notes link in the deployment artifact. It never commits generated release data back to the repository. No API tokens are exposed to website visitors.

The browser joins the same-origin download parts, verifies their size and SHA-256 checksum, then saves one ordinary versioned installer EXE. Users never need to handle the parts. An incomplete or invalid new release fails validation and leaves the previously deployed website running. Drafts and prereleases are ignored. If no stable release exists, the checked-in v0.7.0 parts remain the fallback. Those are real binary data, not Git LFS pointers.

Fallback 0.7.0 SHA-256: `2a56276df30f9cff88714213a4014345926339f0e3cb29165a61b91519e497e9`

Run the same checks locally with Node.js 22 or newer:

```sh
node scripts/verify-site.mjs
node --check dist/app.js
node --test scripts/sync-github-release.test.mjs
```

To preview, serve `dist/` through a local HTTP server. HTTPS (or localhost) is required for the browser's integrity check; opening `index.html` directly as a file is not supported.

## App and third-party notices

This repository contains the website, packaged download and Windows app source. The current app supports per-user installation, desktop/Start menu shortcuts and uninstall through Windows Settings. Version 0.7.0 is an unsigned preview; Windows may display a publisher warning. The included microphone driver has a one-time approval and restart step.

VB-CABLE is included unchanged and remains subject to VB-Audio's licensing. Photo attribution and license links are preserved in `dist/credits.html` and `dist/PHOTO-LICENSES.txt`. The photographs and bundled driver are not covered by any blanket open-source license for this repository.
