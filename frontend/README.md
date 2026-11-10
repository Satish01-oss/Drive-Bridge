# DeviceBridge website — Vercel frontend

Public URL: https://devicebridge-frontend.vercel.app/
Progress: https://devicebridge-frontend.vercel.app/improvements.html

This folder owns the download website and public progress checklist. It does
not start the signaling server, build Windows or Android, or deploy backend
functions. The connection service stays in `remote/` on Render.

```text
frontend/
  site/          Website HTML, CSS, JavaScript, photographs and release data
  build.mjs      Refreshes downloads/checklist and verifies the static output
  package.json   Optional npm build entry point; no package dependencies
  vercel.json    Settings for a project rooted in this folder
  dist/          Generated public website; ignored by Git
remote/          Pairing/signaling backend on Render
app/DeviceBridge/ Windows app source
android/         Android app source
scripts/         Shared release integrity and checklist helpers
docs/            Progress data and templates
```

## Easiest Vercel setup

Import `Satish01-oss/Drive-Bridge` and keep the root at the repository root.
The root `vercel.json` sets everything:

| Setting | Value |
| --- | --- |
| Framework | Other (no framework) |
| Root directory | Repository root |
| Build command | `node frontend/build.mjs` |
| Output directory | `frontend/dist` |
| Install command | None |
| Node | 22.x |

No environment variables or paid add-ons are required. The build uses public
GitHub Releases and built-in Node modules. It verifies the EXE checksum before
publishing the download. API failure fails the build and preserves the prior
deployment. `GITHUB_TOKEN` is optional for authenticated CI rate limits; it is
never included in the website.

If choosing `frontend` as the Vercel root instead, its local `vercel.json` uses
`node build.mjs` and `dist`. Enable access to source files outside that root for
the shared `scripts/` and `docs/`. Using the repository root avoids that step.

Build locally from either root with Node 22 or newer:

```sh
node frontend/build.mjs
# or: cd frontend && npm run build
```

Edit `site/`, never generated `dist/`. The public GitHub Pages release feed is
retained for existing Android updater compatibility and automatic latest stable
Windows downloads on Vercel. On Vercel, download buttons refresh that trusted
feed, fetch its parts and verify SHA-256 before saving one installer. The local
verified build remains a fallback if the feed is temporarily unavailable.

GitHub Pages uses the same `frontend/dist` build, so its existing download and
update URLs continue working. The Android preview download is separate from
the stable Windows release. Connection keys and device grants stay in the app;
they are not website environment variables.
