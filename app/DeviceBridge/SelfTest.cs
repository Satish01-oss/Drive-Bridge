using System.Buffers.Binary;
using System.Net.Security;
using System.Net.Sockets;

namespace DeviceBridge;

public static class SelfTest
{
    public static async Task RunAsync()
    {
        var passed = new List<string>();
        void Check(bool okay, string name) { if (!okay) throw new Exception("FAILED: " + name); passed.Add(name); }
        await WindowLifecycleCheck.RunAsync();
        passed.Add("Minimize/maximize, close-to-tray, restore and explicit quit preserve the modeless session lifetime");
        await BackgroundSharingCheck.RunAsync();
        passed.Add("Both roles keep authenticated input/audio delivery running while minimized or closed to tray and the UI thread is blocked");
        await GuiLayoutCheck.RunAsync();
        passed.Add("Both role screens fit at normal and smaller window sizes without horizontal scrolling");
        int hidden=0,restored=0;
        using(var cover=new CursorCover(_=>hidden++,()=>restored++)) {cover.HideAt(Point.Empty);cover.HideAt(Point.Empty);Check(cover.Active&&hidden==1,"Pointer masking activates once during a handoff");cover.Restore();cover.Restore();Check(!cover.Active&&restored==1,"Pointer restore is balanced and safe to repeat");}
        using(var cover=new CursorCover(_=>{throw new IOException("test show failed");},()=>restored++)){try{cover.HideAt(Point.Empty);}catch(IOException){}Check(!cover.Active&&restored==2,"A partial pointer-hide failure still restores pointer state");}
        var closingCover=new CursorCover(_=>hidden++,()=>restored++);closingCover.HideAt(Point.Empty);closingCover.Dispose();closingCover.Dispose();Check(!closingCover.Active&&restored==3,"Disposing an active cursor cover restores it exactly once");
        using(var cancelled=new CancellationTokenSource()){cancelled.Cancel();using var bridge=new InputBridge(_=>true);bridge.Start(cancelled.Token);bridge.EndRemoteControl(true,cancelled.Token);Check(!bridge.Capturing&&!bridge.PointerHidden,"Cancelled connections cannot start input capture or leave an invisible pointer");}
        var cableChoices = new List<(int Id, string Name)> { (-1, "Windows default"), (4, "CABLE In 16ch (VB-Audio Virtual"), (7, "CABLE Input (VB-Audio Virtual") };
        Check(DriverBundle.ChooseCableOutput(cableChoices, "CABLE In 16ch (VB-Audio Virtual Cable)") == 4 && DriverBundle.ChooseCableOutput(cableChoices, null) == 7, "Microphone routing reuses Windows' selected VB-CABLE pin and otherwise prefers the stereo input");
        if (ProcessLoopbackCapture.Supported)
        {
            using var captureSelection = AudioBridge.CreateCapture(false);
            Check(captureSelection is ProcessLoopbackCapture && captureSelection.WaveFormat.Channels == 2 && captureSelection.WaveFormat.BitsPerSample == 16, "Modern Windows system capture does not require a physical playback endpoint");
        }
        Check(DriverBundle.ReadPackage().Length == 1324680, "Bundled official driver archive passes pinned SHA-256 integrity check");
        Check(DriverBundle.ReadLicense().Contains("www.vb-cable.com"), "Original VB-CABLE license included and readable without installation");
        using (var hookLoop = new HookLoop())
        {
            int caller = Environment.CurrentManagedThreadId, worker = 0, repeated = 0;
            hookLoop.Invoke(() => worker = Environment.CurrentManagedThreadId);
            hookLoop.Invoke(() => repeated = Environment.CurrentManagedThreadId);
            Check(worker != caller && worker == repeated, "Hook dispatcher pumps a dedicated thread without installing input hooks");
        }
        Check(ShortPairing.Normalize("ab c2-34") == "ABC234", "Six-character keys normalize case, spaces and separators");
        var testTone = AudioSignal.SpeakerTestPacket();
        Check(testTone.Data?.Length == 96000 && testTone.A == 48000 && testTone.B == 16 && testTone.C == 2 && AudioSignal.Peak(testTone.Data!, new NAudio.Wave.WaveFormat(48000, 16, 2)) is > .05 and < .1, "Network speaker test contains bounded, sample-aligned stereo PCM at a modest level");
        using (var failedCapture = new AudioBridge(_ => true, _ => throw new IOException("test capture unavailable")))
        {
            try { failedCapture.StartCapture(false); throw new Exception("Failed audio capture was accepted"); } catch (IOException) { }
            Check(failedCapture.LastError == "test capture unavailable", "Audio capture initialization errors remain available in the diagnostic report");
        }
        Check(Connection.ExplainFailure("TCP", new SocketException((int)SocketError.ConnectionRefused)).Contains("ConnectionRefused") && Connection.ExplainFailure("TCP", new OperationCanceledException()).Contains("before the connection key"), "Connection errors distinguish an unreachable TCP endpoint from a key mismatch");
        Check(Connection.ExplainFailure("TLS", new System.Security.Authentication.AuthenticationException("test TLS failure")).Contains("TLS: AuthenticationException") && Connection.ExplainFailure("pairing", new EndOfStreamException()).Contains("network and secure connection opened"), "Connection errors identify TLS and post-TLS pairing failures separately");
        var networkScript = NetworkSetup.SetupScript("C:\\Apps\\Device'Bridge.exe", 7);
        Check(networkScript.Contains("'C:\\Apps\\Device''Bridge.exe'") && networkScript.Contains("-Profile Private") && networkScript.Contains("-RemoteAddress LocalSubnet") && !networkScript.Contains("Set-NetFirewallProfile"), "Network setup quotes paths and scopes app rules to Private/LocalSubnet without disabling firewall profiles");
        try { ShortPairing.Normalize("OOOOOO"); throw new Exception("Ambiguous key accepted"); } catch (ArgumentException) { passed.Add("Ambiguous or malformed short key rejected"); }
        var desktop = new Rectangle(-1920, -200, 1920, 1080); var remoteDesktop = new Rectangle(0, 0, 1366, 768);
        foreach (var side in Enum.GetValues<DeviceSide>())
        {
            var entry = DesktopGeometry.Entry(remoteDesktop, side, 32768, true);
            var restore = DesktopGeometry.Entry(desktop, side, 32768, false);
            Check(remoteDesktop.Contains(entry) && desktop.Contains(restore) && Math.Abs(DesktopGeometry.Fraction(remoteDesktop, entry, side) - 32768) < 100, $"{side}: cursor entry and return preserve position across different screen sizes");
            var exit = DesktopGeometry.Opposite(side);
            var point = exit switch { DeviceSide.Left => new Point(0, 300), DeviceSide.Right => new Point(1365, 300), DeviceSide.Above => new Point(500, 0), _ => new Point(500, 767) };
            var direction = exit switch { DeviceSide.Left => new Point(-1, 0), DeviceSide.Right => new Point(1, 0), DeviceSide.Above => new Point(0, -1), _ => new Point(0, 1) };
            Check(DesktopGeometry.Crossing(remoteDesktop, point, direction, exit) && !DesktopGeometry.Crossing(remoteDesktop, point, new Point(-direction.X, -direction.Y), exit), $"{side}: shared edge only returns on outward motion");
        }
        var inbox = new SessionInbox(4);
        for (int i = 0; i < 4; i++) if (!inbox.TryAdd(new Packet("move", A: i))) throw new Exception("Inbox filled early");
        Check(!inbox.TryAdd(new Packet("key", A: 65)), "UI inbox rejects overflow instead of accumulating unbounded callbacks");
        var order = new List<int>(); while (inbox.TryTake(out var queued)) order.Add(queued.A);
        Check(order.SequenceEqual(Enumerable.Range(0, 4)), "UI inbox preserves input event order");
        inbox.TryAdd(new Packet("key", A: 65)); inbox.Close();
        Check(!inbox.TryTake(out _) && !inbox.TryAdd(new Packet("key", A: 66)), "Closed session inbox cannot deliver stale input");
        var mediaInbox = new SessionInbox(20);
        mediaInbox.TryAdd(new Packet("sound-format", A: 48000));
        bool audioAccepted = true;
        for (int frame = 0; frame < 1024; frame++)
        {
            audioAccepted &= mediaInbox.TryAdd(new Packet("sound", A: frame));
            if (frame % 64 == 0 && !mediaInbox.TryAdd(new Packet("key", A: frame))) throw new Exception("Audio starved control queue");
        }
        mediaInbox.TryAdd(new Packet("sound-stop"));
        var mediaFrames = new List<Packet>(); while (mediaInbox.TryTake(out var media)) mediaFrames.Add(media);
        Check(audioAccepted && mediaFrames.Count(p => p.Kind == "sound") == 32 && mediaFrames.First().Kind == "sound-format" && mediaFrames.Last().Kind == "sound-stop", "Audio overflow preserves format/stop ordering while retaining only the newest 32 audio frames");
        Check(mediaFrames.Where(p => p.Kind == "key").Select(p => p.A).SequenceEqual(Enumerable.Range(0, 16).Select(i => i * 64)), "A burst of 1024 audio frames cannot consume input queue capacity or reorder key events");
        Check(Math.Abs(AudioSignal.Peak(new byte[] { 0, 64, 0, 192 }, new NAudio.Wave.WaveFormat(48000, 16, 1)) - .5) < .0001, "PCM16 microphone meter decodes positive and negative samples");
        var floats = new byte[12]; BitConverter.GetBytes(.25f).CopyTo(floats, 0); BitConverter.GetBytes(-.75f).CopyTo(floats, 4); BitConverter.GetBytes(float.NaN).CopyTo(floats, 8);
        Check(Math.Abs(AudioSignal.Peak(floats, NAudio.Wave.WaveFormat.CreateIeeeFloatWaveFormat(48000, 1)) - .75) < .0001, "Float audio meter handles samples and rejects NaN");
        var first = new FakeCapture(); var second = new FakeCapture(); var sources = new Queue<FakeCapture>(new[] { first, second }); var packets = new List<Packet>();
        using (var audio = new AudioBridge(p => { packets.Add(p); return true; }, _ => sources.Dequeue()))
        {
            int failures = 0; audio.Failed += _ => failures++;
            audio.StartCapture(true); audio.StartCapture(true); int before = packets.Count;
            first.Emit(new byte[100]); first.Fail();
            Check(packets.Count == before && failures == 0, "Restarted capture ignores late bytes and errors from its old source");
            second.Emit(new byte[60000]);
            Check(packets.Skip(before).Where(p => p.Kind == "mic").Sum(p => p.Data!.Length) == 60000 && packets.Skip(before).All(p => p.Data!.Length % 2 == 0), "Current microphone chunks remain sample-aligned and within frame limits");
            second.ThrowOnStop = true;
            audio.StopCapture(); before = packets.Count; second.Emit(new byte[100]);
            Check(packets.Count == before, "Stopped microphone cannot continue transmitting late data");
            Check(second.Disposed && audio.LastError.Contains("disappeared"), "Audio cleanup still disposes an endpoint when stopping it throws");
        }
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(60));
        using var host = new PairingHost("127.0.0.1");
        var invitation = Invitation.Decode(host.Invitation.Encode());
        Check(invitation == host.Invitation, "Pairing key round trip");
        try { Invitation.Decode((invitation with { Expires = 1 }).Encode()); throw new Exception("Expired key accepted"); } catch (ArgumentException) { passed.Add("Expired key rejected"); }
        try { Invitation.Decode((invitation with { Address = "8.8.8.8" }).Encode()); throw new Exception("Public address accepted"); } catch (ArgumentException) { passed.Add("Public address rejected"); }
        var accept = host.AcceptAsync();
        try { using var bad = await Connection.JoinAsync(invitation with { Fingerprint = new string('0', 64) }, timeout.Token); throw new Exception("Bad certificate accepted"); }
        catch (System.Security.Authentication.AuthenticationException) { passed.Add("Wrong TLS certificate rejected"); }
        // A bad secret must not consume the invitation or block a subsequent valid peer.
        using (var badTcp = new TcpClient())
        {
            await badTcp.ConnectAsync(invitation.Address, invitation.Port, timeout.Token);
            using var badSsl = new SslStream(badTcp.GetStream(), false, (_, _, _, _) => true);
            await badSsl.AuthenticateAsClientAsync(new SslClientAuthenticationOptions { TargetHost = "DeviceBridge" }, timeout.Token);
            await Wire.WriteAsync(badSsl, new Packet("auth", Text: new string('0', 64)), timeout.Token);
            Check((await Wire.ReadAsync(badSsl, timeout.Token)).Kind == "pairing-rejected", "Wrong pairing secret receives explicit rejection");
        }
        using var client = await Connection.JoinAsync(invitation, timeout.Token);
        using var server = await accept.WaitAsync(timeout.Token);
        passed.Add("Authenticated TLS localhost connection");
        Check(server.NextSecret!.SequenceEqual(client.NextSecret!), "Both peers receive the same saved reconnect credential");
        var savedHost = new TrustedPeer(true, invitation with { Secret = Convert.ToHexString(server.NextSecret!) }, host.ExportCertificate());
        var protectedBytes = System.Security.Cryptography.ProtectedData.Protect(server.NextSecret!, null, System.Security.Cryptography.DataProtectionScope.CurrentUser);
        Check(System.Security.Cryptography.ProtectedData.Unprotect(protectedBytes, null, System.Security.Cryptography.DataProtectionScope.CurrentUser).SequenceEqual(server.NextSecret!), "Windows account credential protection round trip");
        var arrived = new TaskCompletionSource<Packet>(TaskCreationOptions.RunContinuationsAsynchronously);
        var returned = new TaskCompletionSource<Packet>(TaskCreationOptions.RunContinuationsAsynchronously);
        server.Received += p => arrived.TrySetResult(p); client.Received += p => returned.TrySetResult(p);
        var previousContext = SynchronizationContext.Current;
        SynchronizationContext.SetSynchronizationContext(new BlockedUiContext());
        try { client.Start(); server.Start(); }
        finally { SynchronizationContext.SetSynchronizationContext(previousContext); }
        client.Send(new Packet("key", A: 65, B: 30));
        Check((await arrived.Task.WaitAsync(timeout.Token)).A == 65, "Network transport keeps running when the calling UI synchronization context cannot process callbacks");
        var bytes = Enumerable.Range(0, 4096).Select(i => (byte)i).ToArray();
        server.Send(new Packet("sound", Data: bytes));
        Check((await returned.Task.WaitAsync(timeout.Token)).Data!.SequenceEqual(bytes), "Audio bytes transported in reverse direction");
        var inputBurst = new List<int>(); int audioBurst = 0; bool audioValid = true;
        var inputsDone = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var audioDone = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        server.Received += p => { if (p.Text == "stress" && p.Kind == "move") { inputBurst.Add(p.A); if (inputBurst.Count == 128) inputsDone.TrySetResult(); } };
        client.Received += p => { if (p.Text == "stress" && p.Kind == "sound") { audioValid &= p.Data?.Length == 4096 && p.Data[100] == (byte)p.A; if (++audioBurst == 128) audioDone.TrySetResult(); } };
        for (int i = 0; i < 128; i++)
        {
            if (!client.Send(new Packet("move", Text: "stress", A: i)) || !server.Send(new Packet("sound", Text: "stress", A: i, Data: Enumerable.Repeat((byte)i, 4096).ToArray()))) throw new Exception("Duplex transport queue filled unexpectedly");
        }
        await Task.WhenAll(inputsDone.Task, audioDone.Task).WaitAsync(timeout.Token);
        Check(inputBurst.SequenceEqual(Enumerable.Range(0, 128)), "Simultaneous input/audio burst preserves all input event ordering");
        Check(audioBurst == 128 && audioValid, "Simultaneous input/audio burst preserves 128 audio payloads");
        await Task.Delay(7200, timeout.Token);
        Check(client.IsConnected && server.IsConnected, "Heartbeat keeps a session alive beyond the watchdog interval independently of UI callbacks");
        using var malformed = new MemoryStream();
        var prefix = new byte[4]; BinaryPrimitives.WriteInt32BigEndian(prefix, 300000); malformed.Write(prefix); malformed.Position = 0;
        try { await Wire.ReadAsync(malformed, timeout.Token); throw new Exception("Oversized frame accepted"); } catch (IOException) { passed.Add("Oversized frame rejected before allocation"); }
        var ended = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        server.Closed += reason => ended.TrySetResult(reason);
        client.Dispose();
        await ended.Task.WaitAsync(timeout.Token); passed.Add("Peer disconnect detected");
        using var resumedHost = new PairingHost("127.0.0.1", savedHost);
        Check(resumedHost.Invitation.Fingerprint == invitation.Fingerprint && resumedHost.Invitation.Port == invitation.Port, "Saved host retains certificate and network port");
        var resumedAccept = resumedHost.AcceptAsync();
        using var resumedClient = await Connection.JoinAsync(resumedHost.Invitation, timeout.Token);
        using var resumedServer = await resumedAccept.WaitAsync(timeout.Token);
        passed.Add("Saved pairing reconnects over authenticated TLS");
        Check(resumedClient.NextSecret!.SequenceEqual(Convert.FromHexString(savedHost.Invitation.Secret)), "Saved reconnect does not rotate credentials and risk desynchronization");
        // Do not start the peer's heartbeat: exercise the actual lost-peer watchdog.
        var silent = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        resumedServer.Closed += reason => silent.TrySetResult(reason);
        resumedServer.Start();
        Check((await silent.Task.WaitAsync(timeout.Token)).Contains("responding"), "Silent peer triggers automatic disconnect");
        using (var shortHost = new PairingHost("127.0.0.1", discoverable: true, discoveryPort: 0, listeningPort: 0))
        {
            Check(shortHost.Code.Length == 6 && ShortPairing.Normalize(shortHost.Code) == shortHost.Code, "Generated connection key contains exactly six unambiguous characters");
            var shortAccept = shortHost.AcceptAsync();
            var discovered = await LocalDiscovery.FindAsync(timeout.Token, new[] { System.Net.IPAddress.Loopback }, shortHost.DiscoveryPort);
            Check(discovered.Any(e => e.Address.Equals(System.Net.IPAddress.Loopback) && e.Port == shortHost.Invitation.Port), "Local UDP discovery finds the waiting app without broadcasting its code [" + shortHost.DiscoveryStatus + "; candidates: " + string.Join(",", discovered) + "]");
            var endpoint = new System.Net.IPEndPoint(System.Net.IPAddress.Loopback, shortHost.Invitation.Port);
            for (int probe = 0; probe < 6; probe++)
                Check(await TcpDiscovery.ProbeAsync(endpoint, timeout.Token), "TCP discovery probe " + (probe + 1) + " succeeds without consuming the invitation or wrong-key budget");
            var fallback = await TcpDiscovery.FindAsync(timeout.Token, new[] { endpoint });
            Check(fallback.Contains(endpoint), "TCP fallback discovers the app without any UDP broadcast");
            string wrong = (shortHost.Code[0] == 'A' ? "B" : "A") + shortHost.Code[1..];
            try { using var rejected = await Connection.JoinCodeAsync(wrong, timeout.Token, direct: endpoint); throw new Exception("Wrong short key accepted"); }
            catch (PairingRejectedException) { passed.Add("Wrong six-character key is reported distinctly from discovery or network failure"); }
            using (var tamperedTcp = new TcpClient())
            {
                await tamperedTcp.ConnectAsync(endpoint.Address, endpoint.Port, timeout.Token);
                using var tamperedSsl = new SslStream(tamperedTcp.GetStream(), false, (_, _, _, _) => true);
                await tamperedSsl.AuthenticateAsClientAsync(new SslClientAuthenticationOptions { TargetHost = "DeviceBridge" }, timeout.Token);
                try { await ShortPairing.JoinAsync(tamperedSsl, shortHost.Code, new byte[] { 1, 2, 3 }, timeout.Token); throw new Exception("Wrong certificate binding accepted"); }
                catch (PairingRejectedException) { passed.Add("Short-key evidence rejects an incorrect TLS certificate binding"); }
            }
            using var shortClient = await Connection.JoinCodeAsync(shortHost.Code, timeout.Token, direct: endpoint);
            using var shortServer = await shortAccept.WaitAsync(timeout.Token);
            Check(shortClient.PeerProtocol >= 5 && shortServer.PeerProtocol >= 5 && shortClient.NextSecret!.SequenceEqual(shortServer.NextSecret!), "Six-character SRP pairing authenticates both peers and negotiates screen handoff support");
            Check(shortClient.PairedInvitation?.Secret.Length == 64 && shortClient.PairedInvitation.Fingerprint == shortHost.Invitation.Fingerprint, "Short pairing saves a strong reconnect secret and pins the authenticated certificate");
        }
        Check(TcpDiscovery.ParseAddress("192.168.1.20").Port == TcpDiscovery.Port && TcpDiscovery.ParseAddress("192.168.1.20:51000").Port == 51000, "Direct connection address accepts default and explicit ports");
        try { TcpDiscovery.ParseAddress("8.8.8.8:48932"); throw new Exception("Public fallback accepted"); } catch (ArgumentException) { passed.Add("Direct connection fallback rejects public addresses"); }
        var smallSubnet = TcpDiscovery.Neighbors(System.Net.IPAddress.Parse("192.168.1.5"), System.Net.IPAddress.Parse("255.255.255.252"));
        Check(smallSubnet.Count == 1 && smallSubnet[0].ToString() == "192.168.1.6", "Fallback search respects subnet masks and skips self, network and broadcast addresses");
        var wideSubnet = TcpDiscovery.Neighbors(System.Net.IPAddress.Parse("10.20.30.40"), System.Net.IPAddress.Parse("255.255.0.0"));
        Check(wideSubnet.Count == 253 && wideSubnet.All(a => a.ToString().StartsWith("10.20.30.")), "Fallback search is bounded to nearby addresses even on a large subnet");
        using (var udp = new UdpClient(new System.Net.IPEndPoint(System.Net.IPAddress.Loopback, 0)))
        {
            var responding = Task.Run(async () =>
            {
                await udp.ReceiveAsync(timeout.Token); // Deliberately lose the first query.
                var retry = await udp.ReceiveAsync(timeout.Token);
                using var request = System.Text.Json.JsonDocument.Parse(retry.Buffer);
                var nonce = request.RootElement.GetProperty("nonce").GetString();
                var payload = System.Text.Json.JsonSerializer.SerializeToUtf8Bytes(new { kind = "DeviceBridge.Host.v1", nonce, address = "10.99.99.99", port = 48932 });
                await udp.SendAsync(payload, retry.RemoteEndPoint, timeout.Token);
            });
            var retried = await LocalDiscovery.FindAsync(timeout.Token, new[] { System.Net.IPAddress.Loopback }, ((System.Net.IPEndPoint)udp.Client.LocalEndPoint!).Port);
            await responding;
            Check(retried.Any(e => e.Address.Equals(System.Net.IPAddress.Loopback)), "UDP lookup retries a lost broadcast and uses the reachable reply source instead of a wrong advertised adapter");
        }
        using (var tcpOnly = new PairingHost("127.0.0.1"))
        {
            var accepting = tcpOnly.AcceptAsync();
            var stages = new List<string>();
            var endpoint = new System.Net.IPEndPoint(System.Net.IPAddress.Loopback, tcpOnly.Invitation.Port);
            using var fallbackClient = await Connection.JoinCodeCoreAsync(tcpOnly.Code, timeout.Token, stages.Add, null,
                _ => Task.FromResult(new List<System.Net.IPEndPoint>()), ct => TcpDiscovery.FindAsync(ct, new[] { endpoint }));
            using var fallbackServer = await accepting.WaitAsync(timeout.Token);
            Check(fallbackClient.NextSecret!.SequenceEqual(fallbackServer.NextSecret!) && stages.Any(s => s.Contains("direct local-network search")), "Complete six-character pairing succeeds over TCP fallback when UDP discovery returns no PC");
        }
        using (var limited = new PairingHost("127.0.0.1"))
        {
            var limitedAccept = limited.AcceptAsync(); var endpoint = new System.Net.IPEndPoint(System.Net.IPAddress.Loopback, limited.Invitation.Port);
            string wrong = (limited.Code[0] == 'A' ? "B" : "A") + limited.Code[1..];
            for (int attempt = 0; attempt < 5; attempt++)
            {
                try { using var rejected = await Connection.JoinCodeEndpointAsync(endpoint, wrong, timeout.Token); throw new Exception("Wrong short key accepted"); }
                catch (IOException) { }
            }
            try { using var unexpected = await limitedAccept.WaitAsync(timeout.Token); throw new Exception("Pairing attempts were not limited"); }
            catch (IOException e) when (e.Message.Contains("Too many")) { passed.Add("Five incorrect pairing proofs lock the invitation until a new key is generated"); }
        }
        File.WriteAllLines(Path.Combine(AppContext.BaseDirectory, "self-test-result.txt"), new[] { "PASS — " + passed.Count + " checks", "These tests do not inject input, capture audio, or replace two-PC hardware testing." }.Concat(passed));
    }
    sealed class BlockedUiContext : SynchronizationContext
    {
        public override void Post(SendOrPostCallback callback, object? state) { }
    }
    sealed class FakeCapture : NAudio.Wave.IWaveIn
    {
        public NAudio.Wave.WaveFormat WaveFormat { get; set; } = new(48000, 16, 1);
        public bool ThrowOnStop { get; set; }
        public bool Disposed { get; private set; }
        public event EventHandler<NAudio.Wave.WaveInEventArgs>? DataAvailable;
        public event EventHandler<NAudio.Wave.StoppedEventArgs>? RecordingStopped;
        public void StartRecording() { }
        public void StopRecording() { if (ThrowOnStop) throw new IOException("Endpoint disappeared while stopping"); RecordingStopped?.Invoke(this, new NAudio.Wave.StoppedEventArgs()); }
        public void Dispose() { Disposed = true; }
        public void Emit(byte[] bytes) => DataAvailable?.Invoke(this, new NAudio.Wave.WaveInEventArgs(bytes, bytes.Length));
        public void Fail() => RecordingStopped?.Invoke(this, new NAudio.Wave.StoppedEventArgs(new IOException("Late old-source error")));
    }
}
