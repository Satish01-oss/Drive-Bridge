# Remote protocol v1 and recovery adapter contract

Status: executable contract design with local regression coverage. Native adapters, identity exchange and production services are still pending.

## Compatibility boundary

The existing Windows LAN transport remains protocol 8, length-prefixed JSON over its existing TLS listener. Its discovery, authentication, port, source and installer are not changed by this work.

The new protocol uses the string `devicebridge.remote` and integer version `1`. A LAN packet such as `{ "Kind": "auth", "A": 8 }` is rejected by the remote parser. No automatic downgrade or forwarding to the LAN listener is permitted. A future Windows shell will choose the mode and its transport explicitly. Physical old/new app integration tests remain necessary before a new installer is released.

## Roles and capability negotiation

Each peer advertises `deviceId`, `platform`, `roles`, `modes`, `capabilities`, `minVersion`, `maxVersion` and the protocol identifier. IDs are opaque 16–96 character ASCII base64url-style values; production IDs must be generated from cryptographically secure randomness, not human device names. Only `windows` and `macos` advertise desktop hosting in v1; all four platforms may control a desktop. Phone-screen broadcasting needs a later, separate capability design.

Both peers must support version 1, remote-access mode, and the correct host/controller roles. Requests must include `view`; supported optional capabilities are `input`, `speaker` (host audio to controller) and `microphone` (controller microphone to host). Negotiate their intersection. Capability support is **not consent**. The current authenticated host grant must separately authorize every operation.

## Session messages

Every JSON envelope contains exactly:

```json
{
  "protocol": "devicebridge.remote",
  "version": 1,
  "kind": "input",
  "sessionId": "session_random_00001",
  "generation": 1,
  "seq": 0,
  "payload": {"type": "text", "text": "Hello 👋 नमस्ते 你好"}
}
```

`sessionId` is a fresh random ID for each authenticated session. `generation` increases on transport replacement and `seq` increases per ordered channel; safe integers only. Never reuse a session gate across transports. Unknown envelope/payload fields, unsupported kinds/versions, invalid coordinates and oversized data fail closed. Limits are measured in UTF-8 bytes: 64 KiB total JSON, 48 KiB signaling data and 4 KiB per text event. Framing must reject oversize input **before allocation**; this parser also rejects it before JSON parsing. These limits do not apply to media, which uses WebRTC tracks.

| Kind | Payload |
| --- | --- |
| `hello` | Capability advertisement above |
| `session.open` | `deviceId`, `grantId`, `permissionRevision`, requested `permissions` |
| `session.ready` | Current granted `permissions`, `permissionRevision` |
| `heartbeat` | Random `nonce`; adapter tracks acknowledgements/liveness |
| `session.stop` | Reason: user, revoked, expired, shutdown, permission-changed or transport-failed |
| `input` | One typed input event |
| `signal` | Type offer/answer/candidate and bounded string data |

Input types are `pointer` (display ID and normalized 0–1 x/y), `button` (primary/secondary/middle plus down), `key` (physical code plus down), `text` (Unicode committed text), `scroll` (bounded x/y deltas), and `release-all`. Platform adapters must validate key codes against their supported mapping, process text composition separately from physical key events, and never synthesize a press for `release-all`.

Use a reliable ordered WebRTC data channel for control/input, video tracks for the selected display and audio tracks for speaker and microphone. Coalesce high-frequency pointer moves before sending; do not drop ordered key/button releases. Signaling is delivered over authenticated HTTPS/WebSocket. TURN relays encrypted WebRTC transport; the service does not terminate end-to-end media encryption. Bind the negotiated WebRTC identity/fingerprint to the approved device before accepting any control or media.

`SessionGate` runs **after** identity verification. It rejects input without both view and input permission, replayed sequence numbers, wrong sessions, stale generations, and setup attempts to expand permissions. A stop message closes the gate. Audio/track permission enforcement remains the responsibility of native adapters; it is not implemented by the JSON input gate.

## Approval and identity requirements

Initial short-code/QR pairing requires host approval, expiration and rate limits. The six-character code is not a durable authentication secret. Exchange strong device identities, bind approval to the peer public key and issue host-authorized grants. OS-protected storage, a signed challenge with a fresh nonce, replay resistance, relay credentials, and revocation persistence must be implemented before enabling internet access.

The recovery policy receives only **verified** host grants, never a grant copied from incoming JSON or an unauthenticated presence message. Grant fields: host ID, opaque grant ID, permission revision, UTC expiry, allowed permissions, and explicit reconnect consent. The adapter must recheck revocation/expiry on the host for every resumed session; a client-side timer is not an authorization boundary. Device authentication and grant verification are not implemented in this milestone.

## Reconnection state machine

States: idle → waiting → connecting → connected. Interruptions produce host-offline, phone-offline or waiting. Missing, expired or revoked permission produces approval-required. Explicit quit produces stopped. Nothing automatically leaves stopped; a fresh explicit approval/action is required.

* `approve(verifiedGrant)` invalidates older attempts and snapshots the grant.
* `setAvailability(...)` receives trusted/local liveness hints. Hints can delay a retry but never authorize access. Host presence expiry and phone lifecycle handling remain adapter work.
* `tick()` starts one attempt when due and times it out after 15 seconds. Call it periodically while active, including while connected, so grant expiry is noticed.
* `connected(attemptId, verifiedPeerAndPermissions)` accepts only the current attempt, correct host/grant/revision and a subset of approved permissions. An old completion returns a discard action; the adapter must close that specific stale transport.
* `failed(attemptId)` schedules exponential retries: approximately 1, 2, 4, 8, 16, 30 seconds, with jitter and a hard 30-second cap. Retries continue while trusted consent remains valid.
* `disconnected(attemptId)` ignores stale transport-close events. A current connection is cleaned up and can retry only with reconnect consent.
* `reconnectNow()` bypasses backoff when waiting, but never creates parallel attempts or overrides offline/stopped/approval-required states.
* `stop()` and `revoke()` invalidate pending attempts and remove current authorization from this policy. Revoke must also persist on the host and in the service.

The host-internet-loss scenario is covered with a fake clock: connect, mark host offline, wait, mark host online, authenticate a new transport using the existing approved grant, and resume. It does not prove a real internet connection works yet.

## Mandatory cleanup adapter effects

Every drop/cancellation returns, in order: cancel transport, release pressed keys/buttons, restore pointer ownership, and stop microphone/speaker/video tracks. Adapters must execute these even when another effect fails, clear queued input/media, close the old session gate and ensure old callbacks are scoped to their attempt. Session-ready does not itself enable any capture/input: adapters apply only the verified permissions.

If a native transport cannot use ICE restart after network failure, create a fresh authenticated peer connection. A transient disconnected hint can be investigated using liveness before resetting transport. See the [W3C WebRTC connection specification](https://www.w3.org/TR/webrtc/). The current policy operates on confirmed availability/drop events rather than raw browser connection-state strings.

Use host and mobile lifecycle adapters to report sleep, lock, sign-out and OS suspension honestly. This milestone does not enable pre-sign-in control, waking an offline PC, unattended mobile hosting, or unrestricted iOS control.
