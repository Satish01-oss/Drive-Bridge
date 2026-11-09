# DeviceBridge — Windows app and download website

A static, responsive download website for DeviceBridge, the Windows app for sharing a keyboard, mouse, speakers/headphones and microphone between two PCs on the same trusted network. Wi-Fi and Ethernet can be mixed.

Current app: **0.7.0** · **Windows 10/11 x64** · **DeviceBridge-0.7.0.exe**.

Public website: https://satish01-oss.github.io/Drive-Bridge/

Original public website: https://devicebridge-windows.majorpiece.chatgpt.site

## Repository layout

- `app/DeviceBridge/`: Windows app source, build/signing scripts, regression checks, original driver bundle and third-party notices. See [app build instructions](app/DeviceBridge/README.md).
- `dist/`: Complete public download website, photographs, release manifests and app download data.
- `scripts/verify-site.mjs`: Website link and EXE integrity validation.
- `.github/workflows/`: Automatic website publication and Windows app build/testing.

Website changes publish through GitHub Pages. App changes build and test on a Windows runner and produce a downloadable test artifact. Updating app source alone does not replace the website's released executable; follow the app's release instructions to publish a reviewed new version.

## Hosting

The complete website is in `dist/`. Publish that directory on any HTTPS static host; no installation or build step is required. All site links are relative, including the two-PC test guide, so it also works under a repository path.

The included GitHub Actions workflow validates the downloads and publishes `dist/` to GitHub Pages after pushes to `main`. For first-time Pages setup, select **Settings → Pages → Source → GitHub Actions**, then run **Verify and publish website** from the Actions tab if needed. The Pages URL appears in the deployment output once deployment succeeds.

## Download files

Both release manifests reference the nine binary parts in `dist/downloads/`. The browser joins these parts, verifies their size and SHA-256 checksum, then saves one ordinary **DeviceBridge-0.7.0.exe**. Users never need to handle the parts. Keep all parts in order and publish them with the website; they are real binary data, not Git LFS pointers.

SHA-256: `2a56276df30f9cff88714213a4014345926339f0e3cb29165a61b91519e497e9`

Run the same checks locally with Node.js 22 or newer:

```sh
node scripts/verify-site.mjs
node --check dist/app.js
```

To preview, serve `dist/` through a local HTTP server. HTTPS (or localhost) is required for the browser's integrity check; opening `index.html` directly as a file is not supported.

## App and third-party notices

This repository contains the website, packaged download and Windows app source. Version 0.7.0 is an unsigned preview; Windows may display a publisher warning. The included microphone driver has a one-time approval and restart step.

VB-CABLE is included unchanged and remains subject to VB-Audio's licensing. Photo attribution and license links are preserved in `dist/credits.html` and `dist/PHOTO-LICENSES.txt`. The photographs and bundled driver are not covered by any blanket open-source license for this repository.
