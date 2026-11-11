> Historical preview 11/12 implementation. Preview 13 restores the original WebRTC mode at the user’s request; this forced split and adaptive scaling are no longer active. See ORIGINAL-MODE.md.

# Preview 12: connection recovery and UDP screen stability

The physical preview 11 phone report showed `mediaProtocol: udp`, connected ICE,
367 frames received and 366 decoded on the same Wi-Fi. It did not establish the
cause of the intermittent drops, and no input acknowledgement was present in
that snapshot. The UI still said “loading” because video could arrive before
the control-ready event; ready now checks whether video has already loaded.

The previous code tore down media immediately on service/presence loss and on
every network notification. Preview 12 keeps an already-approved UDP stream for
up to eight seconds during a service interruption, releases native held input
and pauses new controls. The authenticated service must confirm the exact live
grant/session/generation before controls resume. A restarted broker with no
matching session requires a fresh secure connection. Pending/unconfirmed input,
explicit stop, revocation and expiry still stop immediately; commands are not
replayed. Grace timeouts and late replies are tested. Repeated failures back off
with jitter up to 30 seconds, rather than resetting to a three-second loop.

Duplicate browser/Android online notifications are ignored; a real Android
network handover is distinguished from the initial availability notification.
Diagnostics retain the last disconnect message. Already-verified private grants
are checked for current trust/expiry on every TCP frame without repeating native
signature RPCs for pointer motion. Session, direction, permission and AES-GCM
checks remain in place.

Video adapts to interval packet loss and encoder CPU limitation as well as
bandwidth and round-trip delay. Empty sender encodings are retried instead of
inventing a read-only encoding entry. Bitrate limits are 220/750/2500 kbps; source
capture remains at most 1280 pixels wide and 12 fps. Each completed native canvas
draw explicitly requests a capture frame when supported. Statistics expose only
aggregate bandwidth/loss/delay and generic encoder errors, never candidate
addresses, typed text or media content.

Research used primary documentation:

- [W3C WebRTC](https://www.w3.org/TR/webrtc/): disconnected can be transient;
  failed ICE requires recovery. This implementation creates a fresh authenticated
  session after actual failure rather than reusing the old encryption context.
- [W3C canvas media capture](https://www.w3.org/TR/mediacapture-fromelement/):
  explicit frame requests after complete drawing.
- [Render WebSockets](https://render.com/docs/websocket): connections can close
  when an instance is replaced. This is a possible interruption source, not a
  confirmed cause of the user's drops.

No TURN relay or paid infrastructure is provisioned. Networks that block direct
UDP may still need a relay. Microphone implementation work remains on hold.
Automated checks do not substitute for a sustained physical phone/PC test.
