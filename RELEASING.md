# Publish a Windows app update

The GitHub Pages website automatically follows this repository's **latest published stable Release**. Drafts and prereleases do not replace the main download.

## Three steps

1. Update the app's `<Version>` in `app/DeviceBridge/DeviceBridge.csproj`, commit and push to `main`. Wait for **Build and test Windows app** to pass. Download its artifact and extract the versioned installer EXE, such as `DeviceBridge-Setup-0.8.0.exe`. The workflow tests installation, desktop/Start menu shortcuts, reinstallation and uninstallation. Install the app on both PCs and run your acceptance test. If you have a publisher signing certificate, sign the app before packaging, then sign the final installer before uploading it.
2. Open [Create a release](https://github.com/Satish01-oss/Drive-Bridge/releases/new). Create tag **v0.8.0** from the tested source commit, add release notes, and attach **DeviceBridge-Setup-0.8.0.exe**. The tag and filename versions must match. Upload the EXE completely **before** clicking **Publish release**. Leave the prerelease checkbox off and make this the latest release.
3. Wait for **Verify and publish website** to succeed in [Actions](https://github.com/Satish01-oss/Drive-Bridge/actions/workflows/pages.yml). The [website](https://satish01-oss.github.io/Drive-Bridge/) now shows that version, release date and notes link, and downloads the updated EXE. Refresh an already-open page to see the new deployment.

Do not attach the workflow artifact ZIP instead of the EXE. Website visitors still download a single EXE; the checksum and regression report in the development artifact are for your review.

## What happens automatically

Release events use `release-website.yml` to dispatch `pages.yml` on `main`. This keeps publication on the branch allowed by the standard `github-pages` environment, rather than attempting to deploy directly from the release tag. The relay has only repository read and workflow-dispatch permissions. Pages still validates the current latest release before deploying.

The Pages workflow runs when a release is published/edited/promoted/unpublished/deleted, when `main` changes, or when run manually. It checks out `main`, asks GitHub for the current latest stable release, downloads the exact versioned installer EXE, verifies size, Windows PE format (a 32-bit installer launcher is valid for the x64 app), and GitHub's SHA-256 digest when supplied. It computes a SHA-256 checksum regardless, packages same-origin download parts, updates the main and setup-guide manifests and displayed metadata, validates the complete site, then deploys.

No GitHub API calls or tokens are needed in visitors' browsers. GitHub release notes are linked rather than inserted as executable HTML. Generated files exist in the Pages deployment artifact; the source checkout keeps its checked-in fallback download. The original ChatGPT-hosted website is a separate deployment and does not follow this GitHub Pages workflow.

## If a release update fails

A missing EXE, a version/name mismatch, an incomplete download, a checksum mismatch or an invalid Windows executable stops publication. The previous successful website stays live. Fix or replace the asset, then edit/save the release notes or use **Actions → Verify and publish website → Run workflow** on `main` to retry. Uploading an asset alone does not emit a release-published event; use one of these retry steps if you added the EXE after publication.

To promote a prerelease, clear its prerelease flag and make it the latest stable release; this triggers a refresh. To roll back, mark the desired valid release as latest and edit/save its notes or run the website workflow. The workflow always asks GitHub for the current latest release, avoiding an old event overwriting a newer release. If no stable release remains, it falls back to the checked-in 0.7.0 preview.

Releases created by an automation using the default `GITHUB_TOKEN` do not trigger another workflow automatically. Such automation must explicitly dispatch `pages.yml` after uploading and publishing the release, or use a suitable GitHub App token. The standard manual GitHub release flow above needs no additional credentials.

The sync does not install updates inside an already-downloaded app. Existing app users download and run the new installer on both PCs. Quit DeviceBridge explicitly from its tray before updating; pairing/preferences are preserved. Minimize and X keep the installed app in the tray. Only Disconnect, Disconnect and quit, or Windows shutdown stops sharing.

Installer assets named `DeviceBridge-Setup-<version>.exe` take precedence. Legacy portable `DeviceBridge-<version>.exe` releases remain supported if no installer asset exists. The installer launches on Windows and installs the x64 app; its launcher may itself be a 32-bit Windows PE file.
