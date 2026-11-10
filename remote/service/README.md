# Development pairing and signaling service

The free preview is deployed at https://devicebridge-signaling-preview.onrender.com. The Windows native host and shared Android/browser controller now use its signed pairing and signaling. Screen/audio travel directly over encrypted WebRTC; the service does not relay media. Physical Android and separate-network acceptance tests remain pending.

```sh
cd remote
npm ci --ignore-scripts
npm test
npm start
```

Defaults to `127.0.0.1:48940`. No ports or firewall rules are opened. `GET /health` describes the service as ephemeral development storage.

## Identity and pairing

1. A client generates an Ed25519 identity and sends its SPKI DER public key (base64url) to `POST /v1/challenges`.
2. The service returns a 60-second, one-use challenge. The client signs its complete JSON value with the `auth` domain from `identity.mjs` and posts `{challengeId,signature}` to `/v1/auth`. It receives a 30-minute bearer token. No private key is sent to the service.
3. The authenticated computer calls `/v1/pairings` with permissions (including `view`) and explicit reconnect consent. The six-character key expires in two minutes.
4. The authenticated phone posts the code to `/v1/requests`. This creates a **pending** request only, valid for five minutes even if the two-minute invitation expires meanwhile. Generating a replacement key invalidates older pending requests. The computer sees the request via WebSocket or `GET /v1/requests`.
5. The computer explicitly approves by signing the exact grant and posting `{grant,signature}` to `/v1/requests/<id>/approve`, or rejects it via `/reject`. Grant fields are documented by `grantFor` in the test fixtures. The server verifies the host signature, peer identities, expiry (maximum seven days) and permission subset. First approval consumes the key and rejects competing pending requests.
6. Only the two approved peers can list that grant via `GET /v1/grants`. Only its computer can revoke it via `POST /v1/grants/<id>/revoke`.

Signatures use canonical sorted-key JSON, prefixed with `devicebridge.<purpose>.v1\n`. Purpose values are `auth`, `grant` and `signal`; signatures cannot be reused across operations. A native implementation must match these exact bytes. Signed signaling includes grant ID, sender, recipient and the complete versioned remote signal envelope. Recipients must verify the signature and bind WebRTC's DTLS fingerprint to the signed offer/answer before accepting media/input.

## WebSocket transport

Obtain a 30-second one-use ticket from authenticated `POST /v1/socket-ticket`, then connect to `/v1/ws` with two subprotocols: `devicebridge.v1` and `ticket.<ticket>`. The server returns only `devicebridge.v1` as the negotiated protocol. Credentials are never accepted in URLs. Browser Origins must be explicitly allowlisted; native clients still need valid tickets.

Events: `ready`, `pairing-request`, `grant-approved`, `pairing-rejected`, `grant-revoked`, `presence`, `signal`, `signal-accepted`, `heartbeat-ack`, `error`. Send `{type:'heartbeat'}` periodically while active. Send `{type:'signal',signed:{grantId,from,to,message,signature}}` to route a bounded, signed WebRTC message. The controller starts a session with an offer. A replacement requires reconnect consent, a strictly higher generation and a fresh session ID. Replay and wrong-peer signaling are rejected.

Presence is visible only to peers sharing a current grant. Replacing a stale socket does not allow its eventual close event to mark the new socket offline. Authentication expires after 30 minutes; clients must reauthenticate and obtain a fresh ticket. Presence is a hint, never authorization. Signaling acceptance acknowledges validation/routing, not delivery to an offline peer.

## Deployment and limits

To bind beyond loopback, an HTTPS public origin is required. Behind a **protected** TLS reverse proxy, set `PUBLIC_ORIGIN=https://your-service.example`, `TRUST_PROXY=true`, `BIND_HOST=0.0.0.0`, `PORT` from the host, and any explicit browser `ALLOWED_ORIGINS`. Do not expose the plain HTTP backend directly. Health checks are public; other requests enforce the origin/HTTPS configuration. Do not log bearer headers, WebSocket ticket subprotocols, challenge proofs, pairing codes or SDP.

This implementation limits request/message sizes, idle authentication/ticket lifetimes, stored records, pairing attempts, incoming request rates, socket buffers and socket counts. It is single-instance and does not provide distributed abuse protection. IPv4/IPv6 addresses come from the socket, not untrusted client IP headers; an ingress-level limit is needed for a hosted proxy.

**Broker state is in memory.** Short codes and pending requests must be recreated after a restart. The Windows host stores grants in CurrentUser DPAPI-protected storage; Android uses its Keystore. On startup, only the authenticated host can restore its locally saved, unexpired, signature-verified grants with explicit reconnect consent via `/v1/grants/restore`. A controller cannot restore them. Local revocation is saved before contacting the service, so a failed network request cannot revive that grant when the host restarts. Revocation tombstones also block restoration during the current broker lifetime. The host's protected local store is the durable authority; this is a single-instance preview, not a durable multi-region service.
