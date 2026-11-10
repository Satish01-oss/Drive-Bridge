DEVICEBRIDGE 0.8 PREVIEW — ONE DESK. TWO PCs.

ONE APP ON BOTH PCs
Run DeviceBridge-Setup-0.8.0.exe once on both Windows 10/11 x64 PCs.
Then open DeviceBridge from your desktop or Start menu. Close older copies
using the tray’s Disconnect and quit command before installing an update.
Both PCs must be on the same trusted local network. One may use Wi-Fi and the
other Ethernet. Guest Wi-Fi and router isolation can block local communication.

CONNECT IN THREE STEPS
1. On the PC with your keyboard, mouse, speakers and microphone, choose the first
   option. The app displays a six-character key such as ABC234.
2. On the other PC choose the second option, enter that key, then click
   CONNECT & ALLOW. This button IS the approval action. There is no separate
   Allow popup. After pairing the visible Allow this PC to receive keyboard and
   mouse checkbox is checked. Uncheck it at any time to revoke control.
3. On the first PC choose Left, Right, Above or Below for the other PC's screen.
   Move the physical mouse to that edge; switching is automatic after connection.
   Move back through the joining edge on the other PC to return. F8 also toggles
   control. Ctrl+Alt+Esc (or Ctrl+Alt+Pause) disconnects immediately.

The layout describes the position of physical screens. Screen images are not
streamed. Both PCs should use version 0.8 for automatic screen-edge handoff.
The key uses six uppercase letters/numbers without ambiguous I/O/0/1 characters.
It expires after ten minutes. Five incorrect pairing proofs lock that invitation;
click New key to generate another. The key is not broadcast or sent as plaintext.
Pairing uses SRP-6a and certificate-bound evidence inside TLS. Saved sessions use a
separate strong secret and pinned certificate, protected by Windows account DPAPI.
This new pairing/handoff implementation has not had independent security review.

NEXT TIME
Choose Reconnect my saved PC on the first PC, then on the other PC. One pair is
remembered. Generate a new key if the saved address changed or no longer works.
The screen position and chosen physical microphone are remembered.

IF THE PCs CANNOT FIND EACH OTHER
Open Fix connection / network access. Choose the adapter connected to your
trusted router. If you own or may configure that network, select the trust
checkbox and click Allow DeviceBridge on this trusted network. Windows asks for
administrator approval. This makes only the selected network Private and creates
app-specific TCP/UDP rules restricted to Private networks and the local subnet.
Windows Firewall, Defender and SmartScreen are not disabled. Managed network
policies may require your administrator. No router port-forwarding is needed.
Lookup retries UDP discovery, then searches nearby local addresses over TCP. More options also accepts the desk PC’s displayed connection address. Router isolation can prevent local communication.

SOUND AND MICROPHONE
Sound and the desk microphone start after pairing. The desk-role choice describes this sharing. Turn off Share my microphone whenever needed. Use headphones to avoid acoustic feedback.
To use the desk microphone in a calling app on the other PC, install the included
VB-CABLE driver there using Set up included microphone driver. Review the vendor
license, approve the installer and restart that PC. Reopen the app and reconnect.
DeviceBridge selects the cable playback pin automatically. Select CABLE Output as the calling app’s microphone. The desk PC has a Microphone to share selector and live levels.
VB-CABLE by VB-Audio, www.vb-cable.com, is donationware. Contributions and license
purchases are welcome. Professional deployments require appropriate licenses:
https://vb-audio.com/Services/licensing.htm
No extra driver download is needed. Its original package is included unchanged.

WINDOWS AND THE SYSTEM TRAY
Minimize hides the session to the tray and keeps sharing running. X also hides it to the
tray instead of disconnecting. Open DeviceBridge again or double-click its tray
icon to restore it. Use the tray’s Disconnect and quit command to exit.
Ctrl+Alt+Esc still stops sharing immediately.

SYSTEM AUDIO
On Windows build 20348 or newer, system sound uses process-isolated loopback
capture across render endpoints. No physical speaker is required on the other
PC. DeviceBridge’s own microphone playback is excluded from that speaker stream.
Older Windows uses endpoint loopback and needs a usable physical render endpoint.
If VB-CABLE’s 16-channel pin is the default output, the mic route reuses that pin
rather than opening the mutually exclusive stereo pin at the same time.

CHECK YOUR SETUP
Check my setup includes a short speaker tone, an eight-second microphone level
check, incoming audio levels, a test typing field and click target. It measures
levels without saving audio. Copy report includes counts, device names, profiles
and timing, excluding pairing keys, typed text, audio samples and private IPs.
Setup/help dialogs pause automatic edge capture until closed.

PREVIEW LIMITATIONS
The app is unsigned. Windows SmartScreen/unknown-publisher prompts may appear;
verified app signing remains pending. Driver elevation/restart and a calling
app's microphone selection cannot be silently eliminated.
A physical Wi-Fi/Ethernet session was observed stable for over two minutes in
version 0.6.1. The user reported keyboard, mouse, sound and microphone working
in version 0.7. Version 0.8 adds independent background packet delivery and a
Windows installer; its physical two-PC acceptance still needs confirmation.
Automated transport, short-key and geometry checks are not hardware verification.
No screen streaming, sign-in/secure-desktop control, multi-PC sessions, automatic
updates or guarantee for every Windows device. Current binary: x64, Windows 10/11,
English UI. Unused framework translations are omitted to reduce download size.
F8 and Pause are reserved; Ctrl+Alt+Esc is an additional emergency shortcut.

SOURCE AND TESTS
Windows .NET 8 SDK is required to build the source. Build.ps1 -Portable publishes
a compressed self-contained executable. Build-Installer.ps1 makes the normal
Windows installer, including desktop and Start menu shortcuts and an uninstall
entry in Settings. Help, licenses and the driver are embedded.
DeviceBridge.exe --self-test runs non-hardware regression checks and writes its
result beside the executable. --inventory exports a read-only device/setup report.
See ARCHITECTURE.md, TWO-PC-TEST.txt and SIGNING-AND-DRIVER.txt for details.
