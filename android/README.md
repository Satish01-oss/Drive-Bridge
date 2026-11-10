# DeviceBridge Android companion preview

Android 8 (API 26) or newer; built with Android SDK 37 and Java 17.
This companion controls a Windows PC. It does not host an Android desktop.
The public stable Windows download remains 0.8.0 until preview acceptance.

## Build and verify

From the repository root:

```sh
node scripts/build-remote-client.mjs
cd android
./gradlew --no-daemon testDebugUnitTest assembleDebug
```

On Windows use `gradlew.bat`. Install the Android SDK and set `ANDROID_HOME`;
the wrapper downloads its checksum-pinned Gradle distribution. GitHub Actions
builds the debug test APK; that artifact is not a signed public release.

The native tests cover sorted signed JSON, Unicode and surrogate escaping,
safe numbers and an Ed25519 fixture generated independently by Node.
Five update-policy tests also cover release URL constraints, downgrade rejection,
bounded downloads, truncated/tampered files and package/publisher matching.
Keystore persistence, screen/touch/keyboard, sound, microphone and network
recovery still require the real-phone acceptance test.

## Release signing

Use the existing release identity for updates. Keep it outside the repository.
Set `DEVICEBRIDGE_ANDROID_KEYSTORE` and
`DEVICEBRIDGE_ANDROID_KEYSTORE_PASSWORD` in the build process environment;
alias `devicebridge` is used. Run `assembleRelease`, then verify the APK with
the SDK's `apksigner verify --verbose`. Never commit the key/password or place
them in a command line, build log or public artifact. Without the environment
variables Gradle produces an unsigned release, which must not be published.

## Permissions and background behavior

The app auto-connects to the preview service; enter the six-character Windows
key and approve on that computer. Reconnect requires explicit host consent.
Microphone permission is requested only after tapping Microphone on. Camera,
file access, cleartext traffic and backup are disabled. Moving the app into
the background releases input and stops microphone capture. A foreground
return reconnects only when the host granted trusted reconnect permission.

No TURN relay is configured yet. Direct WebRTC may fail on restricted network
combinations. The free signaling host can sleep and has usage limits; it is
not an unlimited uptime guarantee.

## Remove a computer and update inside the app

Preview 7 adds **Fullscreen** and **☰ Tools** to the connected screen. Android
system bars hide while fullscreen is active; swipe at an edge to reveal them,
or use Exit fullscreen / Android Back to return. Touch, right-click, scroll,
sound, microphone, Enter/Tab/Escape, Select all, Copy and Paste remain in Tools.
The typing field and Send stay in a separate bottom bar. Window insets reserve
space for the keyboard and display cutout; rotating does not reload the app.
Physical portrait/landscape/keyboard acceptance is recorded separately from
the browser layout checks and native compilation.

From preview 6, **Trusted devices → Remove PC** deletes that computer's saved
approval on the phone before any network request and ends the active session.
When online, the broker also notifies the computer and removes that approval.
If offline, removal remains local; the computer may still list the phone.
Pair again from the computer to regain access.

**App updates** checks the public preview descriptor automatically at launch.
The feed source at `frontend/site/android-update.json` is refreshed in the website build when a
published release includes an `Android-update.json` descriptor and its APK.
The website verifies the descriptor against GitHub asset hashes before serving
it. Each descriptor has `schema:1`, the release `tag`, exact source commit and
an `android` object with `filename`, `versionName`, increasing `versionCode`,
`bytes`, `sha256` and the canonical GitHub release download `url`. Upload the
descriptor and APK to the draft before publication. Existing release events
automatically rebuild Pages; publishing newer app source alone is insufficient.
Downloading stays inside the app. Before opening Android's installer, the app
checks the HTTPS release URL, size, SHA-256, package name, newer version code
and matching signing certificate. Only the update cache directory is shared
with Android's installer through a non-exported FileProvider and temporary
read grant. No storage access or broad file-provider paths are requested.

Android requires approval to install updates and may ask once whether this
app may request installs. Preview 4/5 need one manual installation of preview 6
to gain the updater. This is not a silent push installation. Existing protected
identity and saved devices survive an ordinary signed app update. Physical
in-app installation and persistence acceptance are recorded separately.
