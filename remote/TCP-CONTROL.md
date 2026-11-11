> Historical preview 11/12 implementation. Preview 13 restores the original WebRTC mode at the user’s request; this forced split and adaptive scaling are no longer active. See ORIGINAL-MODE.md.

# UDP media and encrypted TCP controls

This update keeps the Windows LAN sharing transport separate. It changes the Android remote mode.

The screen and audio use WebRTC DTLS-SRTP over UDP. Non-UDP trickle candidates are ignored. Some restrictive networks will require a UDP-capable TURN relay; none is provisioned yet. Existing native capture supplies up to 1280-pixel-wide frames at 12 fps. The sender lowers bitrate, frame rate and resolution under loss, delay or low bandwidth, and restores sharper settings after two healthy samples. This is adaptation, not a promise of a particular internet latency.

Text, pointer/tap, buttons, scroll and keys use the authenticated HTTPS/WebSocket service over TCP. A fresh ephemeral P-256 key is exchanged in device-signed signaling for each WebRTC session. ECDH + HKDF-SHA256 derives separate AES-256-GCM keys for each direction, bound to the approved grant, session, generation and device IDs. The relay sees ciphertext and routing metadata, never decoded input. No input contents are logged.

Sequence numbers are unique per direction/key and form the AES-GCM nonce; the authenticated header includes the grant, devices, session and generation. The broker and endpoints reject stale sessions/replays. The receiver serializes decryption and application, preserving order under asynchronous operations. View-only grants cannot carry input. Revocation closes the channel and input gate.

The host acknowledges a command only after it validates the input and accepts it into the native input queue. This confirms host acceptance, not that the intended application had focus or displayed the result. Pointer motion can coalesce within 16 ms; a click/key/text flushes the final pointer first. Buttons, text and key releases are not coalesced.

The text field clears only after the matching host acknowledgement. A missing acknowledgement times out after 10 seconds, releases sharing and leaves the draft available. Unconfirmed input is not automatically replayed after reconnect, because it may already have been applied. The user must check the PC before resending. Queues and WebSocket buffers are bounded; congestion fails visibly instead of silently discarding keys.

Both Windows and Android must be on preview 11 or later for this remote control transport. Older pairs retain their existing behavior with each other. This does not add router port forwarding, expose the Windows LAN input listener, or provision paid infrastructure.

Validation includes real loopback TCP/WebSocket delivery with encrypted Unicode text/acknowledgements, signature-bound key exchange, replay/session/revocation rejection, concurrent duplicate delivery, fractional pointer positions, bounded escaping, ordered pointer/click/key delivery, disconnect cancellation and adaptive video policy. Physical Windows/Android UDP/TCP acceptance remains separate.
