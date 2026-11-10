using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.Json;

namespace DeviceBridge;

public sealed record Invitation(string Address, int Port, string Secret, string Fingerprint, long Expires)
{
    public string Encode() => "DB1." + Convert.ToBase64String(JsonSerializer.SerializeToUtf8Bytes(this)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    public static Invitation Decode(string key)
    {
        if (key.Length > 4096 || !key.Trim().StartsWith("DB1.")) throw new ArgumentException("Paste a complete DeviceBridge connection key.");
        var raw = key.Trim()[4..].Replace('-', '+').Replace('_', '/');
        raw = raw.PadRight((raw.Length + 3) / 4 * 4, '=');
        var invite = JsonSerializer.Deserialize<Invitation>(Convert.FromBase64String(raw)) ?? throw new ArgumentException("Invalid key.");
        if (!IPAddress.TryParse(invite.Address, out var ip) || ip.AddressFamily != AddressFamily.InterNetwork ||
            !IsLocal(ip) || invite.Port is < 1024 or > 65535 || invite.Secret.Length != 64 || invite.Fingerprint.Length != 64)
            throw new ArgumentException("Invalid local-network connection key.");
        _ = Convert.FromHexString(invite.Secret); _ = Convert.FromHexString(invite.Fingerprint);
        if (invite.Expires < DateTimeOffset.UtcNow.ToUnixTimeSeconds()) throw new ArgumentException("This key expired. Generate a fresh key on the desk PC.");
        return invite;
    }
    public static bool IsLocal(IPAddress ip)
    {
        var b = ip.GetAddressBytes();
        return b.Length == 4 && (b[0] == 10 || b[0] == 127 || (b[0] == 192 && b[1] == 168) ||
            (b[0] == 172 && b[1] >= 16 && b[1] <= 31) || (b[0] == 169 && b[1] == 254));
    }
    public static List<string> Addresses() => NetworkInterface.GetAllNetworkInterfaces()
        .Where(n => n.OperationalStatus == OperationalStatus.Up && n.NetworkInterfaceType != NetworkInterfaceType.Loopback)
        .OrderBy(n => n.NetworkInterfaceType == NetworkInterfaceType.Wireless80211 ? 0 : n.GetIPProperties().GatewayAddresses.Count > 0 ? 1 : 2)
        .SelectMany(n => n.GetIPProperties().UnicastAddresses)
        .Where(a => a.Address.AddressFamily == AddressFamily.InterNetwork && IsLocal(a.Address))
        .Select(a => a.Address.ToString()).Distinct().ToList();
}

public sealed class PairingHost : IDisposable
{
    readonly X509Certificate2 certificate;
    readonly TcpListener listener;
    readonly CancellationTokenSource stop = new();
    readonly bool reconnecting;
    readonly ShortPairing shortPairing = new();
    readonly LocalDiscovery? discovery;
    int failedAttempts;
    public string Code => shortPairing.Code;
    public string? DiscoveryError { get; }
    internal string DiscoveryStatus => discovery?.Status ?? DiscoveryError ?? "Discovery off";
    internal int DiscoveryPort => discovery?.LocalPort ?? 0;
    public Invitation Invitation { get; }
    public byte[] ExportCertificate() => certificate.Export(X509ContentType.Pfx);
    public PairingHost(string address, TrustedPeer? saved = null, bool discoverable = false, int discoveryPort = LocalDiscovery.Port, int? listeningPort = null)
    {
        reconnecting = saved != null;
        if (saved?.Certificate != null) certificate = new X509Certificate2(saved.Certificate, (string?)null, X509KeyStorageFlags.Exportable);
        else
        {
            using var rsa = RSA.Create(2048);
            var request = new CertificateRequest("CN=DeviceBridge", rsa, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
            using var generated = request.CreateSelfSigned(DateTimeOffset.UtcNow.AddMinutes(-5), DateTimeOffset.UtcNow.AddYears(5));
            certificate = new X509Certificate2(generated.Export(X509ContentType.Pfx), (string?)null, X509KeyStorageFlags.Exportable);
        }
        // Listen on every local adapter: the discoverable route may differ from
        // the UI's preferred Wi-Fi/VPN address. Firewall rules remain LAN-scoped.
        listener = new TcpListener(IPAddress.Any, saved?.Invitation.Port ?? listeningPort ?? (discoverable ? TcpDiscovery.Port : 0));
        listener.Start(4);
        Invitation = new(address, ((IPEndPoint)listener.LocalEndpoint).Port, saved?.Invitation.Secret ?? Convert.ToHexString(RandomNumberGenerator.GetBytes(32)),
            Convert.ToHexString(SHA256.HashData(certificate.RawData)), DateTimeOffset.UtcNow.AddMinutes(10).ToUnixTimeSeconds());
        if (discoverable && saved == null)
        {
            try { discovery = new LocalDiscovery(Invitation, discoveryPort); }
            catch (SocketException) { DiscoveryError = "Local discovery couldn't start. Close other DeviceBridge copies and try a new key."; }
        }
    }
    public async Task<Connection> AcceptAsync()
    {
        // Bounded invitation lifetime, authentication timeout and sequential attempts.
        stop.CancelAfter(TimeSpan.FromMinutes(10));
        while (!stop.IsCancellationRequested)
        {
            var client = await listener.AcceptTcpClientAsync(stop.Token);
            try
            {
                if (client.Client.RemoteEndPoint is not IPEndPoint peer || !Invitation.IsLocal(peer.Address)) throw new IOException("Local addresses only.");
                client.NoDelay = true;
                var ssl = new System.Net.Security.SslStream(client.GetStream(), false);
                try
                {
                    using var timeout = CancellationTokenSource.CreateLinkedTokenSource(stop.Token);
                    timeout.CancelAfter(TimeSpan.FromSeconds(12));
                    await ssl.AuthenticateAsServerAsync(new System.Net.Security.SslServerAuthenticationOptions { ServerCertificate = certificate, EnabledSslProtocols = System.Security.Authentication.SslProtocols.Tls12 | System.Security.Authentication.SslProtocols.Tls13 }, timeout.Token);
                    var auth = await Wire.ReadAsync(ssl, timeout.Token);
                    if (auth.Kind == "discover")
                    {
                        await Wire.WriteAsync(ssl, new Packet("discovery-ready", A: Connection.Protocol), timeout.Token);
                        ssl.Dispose(); client.Dispose(); continue;
                    }
                    if (auth.Kind == "short-pair" && !reconnecting) await shortPairing.AcceptAsync(ssl, auth, certificate.RawData, timeout.Token);
                    else if (auth.Kind != "auth" || auth.Text is null || auth.Text.Length != 64 ||
                        !CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(auth.Text), Encoding.UTF8.GetBytes(Invitation.Secret))) throw new PairingRejectedException();
                    // The initial invitation is exchanged for a private reconnect
                    // credential. Keep that credential on later reconnects so a
                    // dropped session cannot leave the saved peers out of sync.
                    var nextSecret = reconnecting ? Convert.FromHexString(Invitation.Secret) : RandomNumberGenerator.GetBytes(32);
                    await Wire.WriteAsync(ssl, new Packet("ready", Text: Environment.MachineName, A: Connection.Protocol, Data: nextSecret), timeout.Token);
                    listener.Stop(); discovery?.Dispose();
                    return new Connection(client, ssl, "Remote PC") { NextSecret = nextSecret, PeerProtocol = auth.A };
                }
                catch (PairingRejectedException)
                {
                    try
                    {
                        using var rejectTimeout = new CancellationTokenSource(1000);
                        await Wire.WriteAsync(ssl, new Packet("pairing-rejected"), rejectTimeout.Token);
                    }
                    catch (Exception) { }
                    ssl.Dispose(); throw;
                }
                catch { ssl.Dispose(); throw; }
            }
            catch (PairingRejectedException)
            {
                client.Dispose();
                if (++failedAttempts >= 5) throw new IOException("Too many incorrect keys. Generate a new key.");
                await Task.Delay(400, stop.Token);
            }
            catch when (!stop.IsCancellationRequested) { client.Dispose(); await Task.Delay(250, stop.Token); }
            catch { client.Dispose(); throw; }
        }
        throw new OperationCanceledException();
    }
    public void Dispose() { stop.Cancel(); listener.Stop(); discovery?.Dispose(); certificate.Dispose(); }
}
