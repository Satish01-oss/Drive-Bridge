# Preview 13: restore the original connection mode

At the user's request, preview 13 restores the pre-split peer and native media
pipeline from commit `32525a6e3b68c9363ad99789b06ea05fadd918cd` (preview 10).
The Windows and Android app interfaces, updater, saved-device storage, network
notification filtering and retry backoff are retained.

- Screen and sound use browser-managed encrypted WebRTC media. The app no longer
  filters ICE candidates to UDP only.
- Text, taps, mouse, keys and scrolling use the original ordered, reliable
  WebRTC data channel. The separate WebSocket/TCP input relay is no longer used
  by this mode. Its old service/library paths remain for installed preview 11/12
  compatibility during updates.
- No `AdaptiveVideo` instance or custom bitrate/resolution profile is applied.
  Capture returns to the original canvas stream dimensions (up to 1280 pixels
  wide, 12 fps). Browser congestion control still operates normally; this is not
  a guarantee of full physical-display resolution on every network.
- The typing field clears after the original data channel accepts the message
  into its send queue. It no longer claims a native-host acknowledgement.
- Diagnostics identify `transportMode: original`, `quality: original` and
  `controlTransport: webrtc-datachannel`, without candidate addresses or input
  contents. A mixed preview 11/12 key handshake gives an update-both-apps message.

This is an update with Android version code 913, rather than a package downgrade,
so existing signing identity and saved devices are preserved. Both Windows and
Android should be updated together. Microphone methods/routing are unchanged and
microphone work remains on hold. Readability and sustained connection quality
still require the user's physical-device acceptance.
