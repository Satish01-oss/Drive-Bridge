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
