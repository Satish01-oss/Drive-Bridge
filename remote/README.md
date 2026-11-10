# DeviceBridge remote access — development foundation

This is the new remote-access work. The current release targets **Windows and Android**; Mac/iPhone work is deferred by the user's latest instruction. It does **not** enable internet access in the released Windows app. A local development pairing/signaling service is implemented, but no public service, TURN relay, screen capture, native adapter or mobile app is deployed yet.

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
| Trusted reconnect state machine | Implemented and locally tested; adapter integration pending |
| Signed host identity and grant verification | Implemented in development service; native storage pending |
| Pairing/presence service | Local HTTP/WebSocket implementation tested; public deployment pending |
| Durable grant/revocation storage | Not implemented |
| TURN infrastructure | Not provisioned; zero-cost constraint applies |
| Native capture, input and audio adapters | Not implemented |
| Mobile app and shared interface | Not implemented |
| Physical Mac/Windows/Android/iPhone tests | Pending |

See [the protocol and adapter contract](PROTOCOL.md). JavaScript is the executable reference used for the future web/control service. Native and Flutter clients must implement the same contract and run equivalent conformance tests; JavaScript modules are not a replacement for native screen/input/audio components.

See [service setup](service/README.md) and [zero-cost hosting constraints](HOSTING.md).

Maintain `docs/improvements-status.json` and rebuild the public checklist after each verified milestone. Record partial work as `in_progress` until its full acceptance criteria pass.
