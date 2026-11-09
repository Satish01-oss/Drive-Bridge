using System.Net;
using System.Net.NetworkInformation;
using System.Net.Security;
using System.Net.Sockets;

namespace DeviceBridge;

// Broadcast-independent lookup. Only this app's fixed port is probed, on at
// most 254 nearby addresses per adapter (maximum two adapters). No key is sent.
public static class TcpDiscovery
{
    public const int Port = 48932;
    public static IPEndPoint ParseAddress(string value)
    {
        var parts = value.Trim().Split(':');
        if (parts.Length is < 1 or > 2 || !IPAddress.TryParse(parts[0], out var address) || address.AddressFamily != AddressFamily.InterNetwork || !Invitation.IsLocal(address))
            throw new ArgumentException("Enter the first PC's local connection address, for example 192.168.1.20:48932.");
        int port = Port;
        if (parts.Length == 2 && (!int.TryParse(parts[1], out port) || port is < 1024 or > 65535)) throw new ArgumentException("Copy the full connection address shown on the first PC.");
        return new IPEndPoint(address, port);
    }
    internal static List<IPAddress> Neighbors(IPAddress own, IPAddress mask)
    {
        var ip = own.GetAddressBytes(); var bits = mask.GetAddressBytes();
        if (ip.Length != 4 || bits.Length != 4 || !Invitation.IsLocal(own) || IPAddress.IsLoopback(own)) return new();
        var result = new List<IPAddress>();
        for (int last = 1; last < 255; last++)
        {
            var candidate = new byte[] { ip[0], ip[1], ip[2], (byte)last };
            if (candidate.SequenceEqual(ip) || !candidate.Select((b, i) => (b & bits[i]) == (ip[i] & bits[i])).All(x => x)) continue;
            // Exclude the actual subnet's network and broadcast addresses too.
            if (candidate.Select((b, i) => (b & ~bits[i]) == 0).All(x => x) || candidate.Select((b, i) => (b | bits[i]) == 255).All(x => x)) continue;
            result.Add(new IPAddress(candidate));
        }
        return result;
    }
    internal static List<IPEndPoint> Targets() => NetworkInterface.GetAllNetworkInterfaces()
        .Where(n => n.OperationalStatus == OperationalStatus.Up && n.NetworkInterfaceType is NetworkInterfaceType.Wireless80211 or NetworkInterfaceType.Ethernet or NetworkInterfaceType.GigabitEthernet or NetworkInterfaceType.FastEthernetFx or NetworkInterfaceType.FastEthernetT)
        .SelectMany(n => n.GetIPProperties().UnicastAddresses.Where(a => a.Address.AddressFamily == AddressFamily.InterNetwork && Invitation.IsLocal(a.Address)))
        .Take(2).SelectMany(a => Neighbors(a.Address, a.IPv4Mask)).Distinct().Select(a => new IPEndPoint(a, Port)).ToList();
    public static async Task<List<IPEndPoint>> FindAsync(CancellationToken token, IEnumerable<IPEndPoint>? testTargets = null)
    {
        var found = new System.Collections.Concurrent.ConcurrentBag<IPEndPoint>();
        await Parallel.ForEachAsync(testTargets ?? Targets(), new ParallelOptions { MaxDegreeOfParallelism = 32, CancellationToken = token }, async (endpoint, ct) =>
        {
            if (await ProbeAsync(endpoint, ct)) found.Add(endpoint);
        });
        return found.Distinct().Take(8).ToList();
    }
    internal static async Task<bool> ProbeAsync(IPEndPoint endpoint, CancellationToken token)
    {
        using var client = new TcpClient { NoDelay = true };
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(token); timeout.CancelAfter(1500);
        try
        {
            if (!Invitation.IsLocal(endpoint.Address)) return false;
            await client.ConnectAsync(endpoint.Address, endpoint.Port, timeout.Token);
            using var ssl = new SslStream(client.GetStream(), false, (_, cert, _, _) => cert != null);
            await ssl.AuthenticateAsClientAsync(new SslClientAuthenticationOptions { TargetHost = "DeviceBridge", EnabledSslProtocols = System.Security.Authentication.SslProtocols.Tls12 | System.Security.Authentication.SslProtocols.Tls13 }, timeout.Token);
            await Wire.WriteAsync(ssl, new Packet("discover"), timeout.Token);
            var answer = await Wire.ReadAsync(ssl, timeout.Token);
            return answer.Kind == "discovery-ready" && answer.A >= 6;
        }
        catch (Exception e) when (e is IOException or SocketException or OperationCanceledException or System.Security.Authentication.AuthenticationException or System.Text.Json.JsonException) { return false; }
    }
}
