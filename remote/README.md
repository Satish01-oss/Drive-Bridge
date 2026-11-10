# DeviceBridge remote access — Windows + Android preview

The current implementation targets **Windows and Android**; Mac/iPhone work is deferred. Stable Windows remains 0.8.0; remote access is available separately in [0.9.0-preview.4](https://github.com/Satish01-oss/Drive-Bridge/releases/tag/v0.9.0-preview.4). Use the [public setup page](https://satish01-oss.github.io/Drive-Bridge/remote-preview.html) for both downloads. The signed pairing service is live on Render Free. Direct WebRTC connections may fail on restrictive networks because no TURN relay is configured.

The existing `app/DeviceBridge` Windows local-sharing app and its LAN protocol 8 are unchanged. New remote control uses a separate `devicebridge.remote` version 1 protocol. Never expose the LAN listener directly to the internet.

## Run the foundation checks

Node.js 22 or later; no packages or credentials are required:

```sh
node --test remote/core/*.test.mjs
```

Those core checks use in-memory messages and a fake clock. The additional service suite uses ephemeral loopback HTTP/WebSocket listeners and test-only identities. No test captures audio/screens, injects input or grants actual remote control. Protocol negotiation retains future Apple compatibility; these are contract tests, not proof of native builds on those platforms. Run the complete suite with `cd remote`, `npm ci --ignore-scripts`, then `npm test`.

## Implementation map

| Part | Status |
| --- | --- |
| Versioned message contract and input validation | Implemented and locally tested |
| Session/generation replay gate | Implemented and locally tested |
| Trusted reconnect state machine | Shared policy and native client retry implemented; physical outage acceptance pending |
| Signed host identity and grant verification | Broker/client verification, Windows DPAPI and Android Keystore implemented |
| Pairing/presence service | Live on Render Free; expiring keys and explicit host approval |
| Durable grant/revocation storage | Host-protected grants restored after broker restart; local revocation persisted before network request |
| TURN infrastructure | Not provisioned; zero-cost constraint applies |
| Native capture, input and audio adapters | Windows screen/input/background tested locally; audio and physical phone acceptance pending |
| Mobile app and shared interface | Signed Android preview APK built; physical installation/controller acceptance pending |
| Physical Windows/Android tests | Pending; Apple deferred |

See [the protocol and adapter contract](PROTOCOL.md). The shared JavaScript client runs inside native Windows WebView2 and Android WebView shells with platform-specific identity and media/input adapters. Current automated coverage is 84 shared/service tests, 92 Windows checks and four Android native contract tests. Local runtime tests cover screen viewing, multilingual queued typing, cancellation after Stop, minimize/X and hidden-window restoration; they do not substitute for physical Android, audio or separate-network acceptance.

See [service setup](service/README.md) and [zero-cost hosting constraints](HOSTING.md).

Maintain `docs/improvements-status.json` and rebuild the public checklist after each verified milestone. Record partial work as `in_progress` until its full acceptance criteria pass.
