# DeviceBridge remote access — development foundation

This is the new cross-platform remote-access work. It does **not** enable internet access in the released Windows app. There is no deployed pairing service, TURN server, screen capture, native adapter or mobile app in this milestone.

The existing `app/DeviceBridge` Windows local-sharing app and its LAN protocol 8 are unchanged. New remote control uses a separate `devicebridge.remote` version 1 protocol. Never expose the LAN listener directly to the internet.

## Run the foundation checks

Node.js 22 or later; no packages or credentials are required:

```sh
node --test remote/core/*.test.mjs
```

The suite uses in-memory messages and a fake clock. It never opens a network listener, captures audio/screens, injects input, or grants remote access. Protocol negotiation is tested for Windows/Mac hosts and Windows/Mac/Android/iOS controllers. These are contract tests, not proof that native builds run on those platforms.

## Implementation map

| Part | Status |
| --- | --- |
| Versioned message contract and input validation | Implemented and locally tested |
| Session/generation replay gate | Implemented and locally tested |
| Trusted reconnect state machine | Implemented and locally tested; adapter integration pending |
| Host identity verification and protected grant storage | Not implemented |
| Pairing/presence and TURN infrastructure | Not implemented |
| Native capture, input and audio adapters | Not implemented |
| Mobile app and shared interface | Not implemented |
| Physical Mac/Windows/Android/iPhone tests | Pending |

See [the protocol and adapter contract](PROTOCOL.md). JavaScript is the executable reference used for the future web/control service. Native and Flutter clients must implement the same contract and run equivalent conformance tests; JavaScript modules are not a replacement for native screen/input/audio components.

Maintain `docs/improvements-status.json` and rebuild the public checklist after each verified milestone. Record partial work as `in_progress` until its full acceptance criteria pass.
