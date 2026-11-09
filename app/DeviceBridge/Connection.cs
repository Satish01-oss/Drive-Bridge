using System.Buffers.Binary;
using System.Net.Security;
using System.Net.Sockets;
using System.Net;
using System.Security.Cryptography;
using System.Text.Json;
using System.Threading.Channels;

namespace DeviceBridge;

public sealed record Packet(string Kind, string? Text = null, int A = 0, int B = 0, int C = 0, byte[]? Data = null);

public static class Wire
{
    const int Limit = 256 * 1024;
    public static async Task WriteAsync(Stream stream, Packet packet, CancellationToken token)
    {
        var data = JsonSerializer.SerializeToUtf8Bytes(packet);
        if (data.Length > Limit) throw new IOException("Packet exceeds size limit.");
        var header = new byte[4]; BinaryPrimitives.WriteInt32BigEndian(header, data.Length);
        await stream.WriteAsync(header, token); await stream.WriteAsync(data, token);
    }
    public static async Task<Packet> ReadAsync(Stream stream, CancellationToken token)
    {
        var header = new byte[4]; await stream.ReadExactlyAsync(header, token);
        var size = BinaryPrimitives.ReadInt32BigEndian(header);
        if (size < 2 || size > Limit) throw new IOException("Invalid packet size.");
        var data = new byte[size]; await stream.ReadExactlyAsync(data, token);
        return JsonSerializer.Deserialize<Packet>(data) ?? throw new IOException("Invalid packet.");
    }
}

public sealed class Connection : IDisposable
{
    readonly TcpClient client;
    readonly SslStream stream;
    readonly CancellationTokenSource stop = new();
    readonly Channel<Packet> outgoing = Channel.CreateBounded<Packet>(new BoundedChannelOptions(512) { SingleReader = true, FullMode = BoundedChannelFullMode.Wait });
    int disposed;
    long lastReceived = Environment.TickCount64;
    long sent, received, inputReceived, audioReceived, roundTrip = -1;
    public string Peer { get; }
    public bool IsConnected => Volatile.Read(ref disposed) == 0;
    public CancellationToken Lifetime => stop.Token;
    public string Diagnostics => $"Connected: {IsConnected}\nFrames sent / received: {Interlocked.Read(ref sent)} / {Interlocked.Read(ref received)}\nInput frames received: {Interlocked.Read(ref inputReceived)}\nAudio frames received: {Interlocked.Read(ref audioReceived)}\nRound-trip milliseconds: {Interlocked.Read(ref roundTrip)}\nOutgoing queue: {outgoing.Reader.Count}";
    public byte[]? NextSecret { get; init; }
    public int PeerProtocol { get; init; }
    public Invitation? PairedInvitation { get; init; }
    public event Action<Packet>? Received;
    public event Action<string>? Closed;
    public Connection(TcpClient client, SslStream stream, string peer) { this.client = client; this.stream = stream; Peer = peer; }
    public static async Task<Connection> JoinAsync(Invitation invite, CancellationToken token)
    {
        var client = new TcpClient { NoDelay = true };
        SslStream? ssl = null;
        try
        {
            await client.ConnectAsync(invite.Address, invite.Port, token);
            ssl = new SslStream(client.GetStream(), false, (_, cert, _, _) => cert != null &&
                CryptographicOperations.FixedTimeEquals(SHA256.HashData(cert.GetRawCertData()), Convert.FromHexString(invite.Fingerprint)));
            await ssl.AuthenticateAsClientAsync(new SslClientAuthenticationOptions { TargetHost = "DeviceBridge", EnabledSslProtocols = System.Security.Authentication.SslProtocols.Tls12 | System.Security.Authentication.SslProtocols.Tls13 }, token);
            await Wire.WriteAsync(ssl, new Packet("auth", Text: invite.Secret, A: 7), token);
            var answer = await Wire.ReadAsync(ssl, token);
            if (answer.Kind != "ready" || answer.Data?.Length != 32) throw new IOException("Pairing rejected.");
            return new Connection(client, ssl, answer.Text ?? "Desk PC") { NextSecret = answer.Data, PeerProtocol = answer.A };
        }
        catch { ssl?.Dispose(); client.Dispose(); throw; }
    }
    public static Task<Connection> JoinCodeAsync(string code, CancellationToken token, Action<string>? progress = null, IPEndPoint? direct = null) =>
        JoinCodeCoreAsync(code, token, progress, direct, ct => LocalDiscovery.FindAsync(ct), ct => TcpDiscovery.FindAsync(ct));
    internal static async Task<Connection> JoinCodeCoreAsync(string code, CancellationToken token, Action<string>? progress, IPEndPoint? direct,
        Func<CancellationToken, Task<List<IPEndPoint>>> udpLookup, Func<CancellationToken, Task<List<IPEndPoint>>> tcpLookup)
    {
        code = ShortPairing.Normalize(code);
        progress?.Invoke("Looking for the first PC on your local network…");
        var tried = new HashSet<IPEndPoint>(); bool mismatch = false; IOException? lastFailure = null;
        async Task<Connection?> TryCandidates(IEnumerable<IPEndPoint> candidates)
        {
            foreach (var endpoint in candidates)
            {
                if (!tried.Add(endpoint)) continue;
                progress?.Invoke("Opening the local-network connection…");
                using var attempt = CancellationTokenSource.CreateLinkedTokenSource(token); attempt.CancelAfter(TimeSpan.FromSeconds(10));
                try { return await JoinCodeEndpointAsync(endpoint, code, attempt.Token); }
                catch (PairingRejectedException) { mismatch = true; }
                catch (IOException e) when (!token.IsCancellationRequested) { lastFailure = e; }
            }
            return null;
        }
        if (direct != null)
        {
            var result = await TryCandidates(new[] { direct }); if (result != null) return result;
        }
        else
        {
            var result = await TryCandidates(await udpLookup(token)); if (result != null) return result;
            progress?.Invoke("Trying a direct local-network search. Keep the first PC's key screen open…");
            result = await TryCandidates(await tcpLookup(token)); if (result != null) return result;
        }
        token.ThrowIfCancellationRequested();
        if (mismatch) throw new PairingRejectedException();
        if (lastFailure != null) throw lastFailure;
        throw new IOException("The first PC wasn't found. Keep its key screen open. On BOTH PCs use Fix connection / network access and allow this copy on your trusted network. If it still fails, enter the first PC's connection address under More options.");
    }
    internal static async Task<Connection> JoinCodeEndpointAsync(IPEndPoint endpoint, string code, CancellationToken token)
    {
        if (!Invitation.IsLocal(endpoint.Address)) throw new ArgumentException("A local-network address is required.");
        var client = new TcpClient { NoDelay = true }; SslStream? ssl = null;
        string stage = "TCP";
        try
        {
            await client.ConnectAsync(endpoint.Address, endpoint.Port, token);
            // Trust is established by SRP plus certificate-bound evidence below,
            // not by accepting this initial self-signed certificate on its own.
            ssl = new SslStream(client.GetStream(), false, (_, cert, _, _) => cert != null);
            stage = "TLS";
            await ssl.AuthenticateAsClientAsync(new SslClientAuthenticationOptions { TargetHost = "DeviceBridge", EnabledSslProtocols = System.Security.Authentication.SslProtocols.Tls12 | System.Security.Authentication.SslProtocols.Tls13 }, token);
            var certificate = ssl.RemoteCertificate!.GetRawCertData();
            stage = "pairing";
            var answer = await ShortPairing.JoinAsync(ssl, code, certificate, token);
            if (answer.Kind != "ready" || answer.Data?.Length != 32) throw new PairingRejectedException();
            var saved = new Invitation(endpoint.Address.ToString(), endpoint.Port, Convert.ToHexString(answer.Data), Convert.ToHexString(SHA256.HashData(certificate)), DateTimeOffset.UtcNow.AddMinutes(10).ToUnixTimeSeconds());
            return new Connection(client, ssl, answer.Text ?? "Desk PC") { NextSecret = answer.Data, PeerProtocol = answer.A, PairedInvitation = saved };
        }
        catch (PairingRejectedException) { ssl?.Dispose(); client.Dispose(); throw; }
        catch (Exception e) when (e is IOException or SocketException or OperationCanceledException or System.Security.Authentication.AuthenticationException or System.Text.Json.JsonException)
        {
            ssl?.Dispose(); client.Dispose();
            throw new IOException(ExplainFailure(stage, e), e);
        }
        catch { ssl?.Dispose(); client.Dispose(); throw; }
    }
    internal static string ExplainFailure(string stage, Exception error)
    {
        string detail = error is SocketException socket ? socket.SocketErrorCode.ToString() : error is OperationCanceledException ? "TimedOut" : error.GetType().Name;
        return stage switch
        {
            "TCP" => "Cannot reach the first PC over the network (TCP: " + detail + "). Check that both PCs use the same local network and allow DeviceBridge with Fix connection / network access. This failed before the connection key could be checked.",
            "TLS" => "The first PC answered, but Windows could not establish the secure connection (TLS: " + detail + "). Details: " + error.Message,
            _ => "The network and secure connection opened, but pairing did not finish (pairing: " + detail + "). Close older copies, use the latest app on both PCs, then generate a fresh key."
        };
    }
    int started;
    public void Start()
    {
        if (Interlocked.Exchange(ref started, 1) != 0) return;
        ConnectionLog.Write("Session started.");
        _ = Task.Run(ReadLoop); _ = Task.Run(WriteLoop); _ = Task.Run(Heartbeat);
    }
    public bool Send(Packet packet)
    {
        if (Volatile.Read(ref disposed) != 0) return false;
        if (outgoing.Writer.TryWrite(packet)) return true;
        End("Network queue filled. Sharing stopped to prevent delayed input.");
        return false;
    }
    async Task ReadLoop()
    {
        try
        {
            while (!stop.IsCancellationRequested)
            {
                var p = await Wire.ReadAsync(stream, stop.Token);
                Interlocked.Exchange(ref lastReceived, Environment.TickCount64); Interlocked.Increment(ref received);
                if (p.Kind == "ping") Send(new Packet("pong", Text: p.Text));
                else if (p.Kind == "pong")
                {
                    if (long.TryParse(p.Text, out var started))
                    {
                        var elapsed = Environment.TickCount64 - started;
                        if (elapsed is >= 0 and <= 60000) Interlocked.Exchange(ref roundTrip, elapsed);
                    }
                }
                else
                {
                    if (p.Kind is "key" or "mouse" or "move") Interlocked.Increment(ref inputReceived);
                    if (p.Kind is "mic" or "sound") Interlocked.Increment(ref audioReceived);
                    Received?.Invoke(p);
                }
            }
        }
        catch (Exception e) { End(e is EndOfStreamException ? "The other PC disconnected." : "Connection ended: " + e.Message); }
    }
    async Task WriteLoop()
    {
        try { await foreach (var packet in outgoing.Reader.ReadAllAsync(stop.Token)) { await Wire.WriteAsync(stream, packet, stop.Token); Interlocked.Increment(ref sent); } }
        catch (Exception e) { End("Connection ended: " + e.Message); }
    }
    async Task Heartbeat()
    {
        try
        {
            while (!stop.IsCancellationRequested)
            {
                await Task.Delay(1000, stop.Token);
                if (Environment.TickCount64 - Interlocked.Read(ref lastReceived) > 6000) { End("Peer stopped responding. Input released."); return; }
                Send(new Packet("ping", Text: Environment.TickCount64.ToString(System.Globalization.CultureInfo.InvariantCulture)));
            }
        }
        catch (OperationCanceledException) { }
    }
    void End(string reason)
    {
        if (Interlocked.Exchange(ref disposed, 1) != 0) return;
        ConnectionLog.Write("Session ended: " + reason);
        stop.Cancel(); outgoing.Writer.TryComplete(); stream.Dispose(); client.Dispose(); Closed?.Invoke(reason);
    }
    public void Stop(string reason) => End(reason);
    public void Dispose() => End("Disconnected. All sharing stopped.");
}
