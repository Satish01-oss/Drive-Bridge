using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace DeviceBridge;

public sealed class LocalDiscovery : IDisposable
{
    public const int Port = 48931;
    readonly UdpClient socket;
    readonly CancellationTokenSource stop = new();
    public string Status { get; private set; } = "Listening";
    public int LocalPort => ((IPEndPoint)socket.Client.LocalEndPoint!).Port;
    public LocalDiscovery(Invitation invitation, int port = Port)
    {
        socket = new UdpClient(AddressFamily.InterNetwork);
        try { socket.ExclusiveAddressUse = true; socket.Client.Bind(new IPEndPoint(IPAddress.Any, port)); }
        catch { socket.Dispose(); throw; }
        _ = Respond(invitation);
    }
    async Task Respond(Invitation invitation)
    {
        try
        {
            while (!stop.IsCancellationRequested)
            {
                try
                {
                var request = await socket.ReceiveAsync(stop.Token);
                Status = "Discovery request received";
                if (request.Buffer.Length > 512 || !Invitation.IsLocal(request.RemoteEndPoint.Address)) continue;
                try
                {
                    using var json = JsonDocument.Parse(request.Buffer);
                    if (json.RootElement.GetProperty("kind").GetString() != "DeviceBridge.Discover.v1") continue;
                    var nonce = json.RootElement.GetProperty("nonce").GetString();
                    if (nonce?.Length != 32) continue;
                    var answer = JsonSerializer.SerializeToUtf8Bytes(new { kind = "DeviceBridge.Host.v1", nonce, address = invitation.Address, port = invitation.Port });
                    await socket.SendAsync(answer, request.RemoteEndPoint, stop.Token);
                    Status = "Discovery reply sent";
                }
                catch (JsonException) { }
                catch (InvalidOperationException) { }
                catch (KeyNotFoundException) { }
                }
                // An unreachable/stale requester must not permanently silence
                // discovery for every subsequent PC.
                catch (SocketException e) when (!stop.IsCancellationRequested) { Status = "Discovery socket: " + e.SocketErrorCode; await Task.Delay(100, stop.Token); }
            }
        }
        catch (OperationCanceledException) { }
        catch (ObjectDisposedException) { }
        catch (SocketException) { }
    }
    public static async Task<List<IPEndPoint>> FindAsync(CancellationToken token, IEnumerable<IPAddress>? testTargets = null, int discoveryPort = Port)
    {
        using var client = new UdpClient(new IPEndPoint(IPAddress.Any, 0)) { EnableBroadcast = true };
        var nonce = Convert.ToHexString(RandomNumberGenerator.GetBytes(16));
        var query = JsonSerializer.SerializeToUtf8Bytes(new { kind = "DeviceBridge.Discover.v1", nonce });
        var targets = testTargets?.ToList() ?? Broadcasts();
        var found = new Dictionary<string, IPEndPoint>();
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(token); timeout.CancelAfter(TimeSpan.FromMilliseconds(2600));
        async Task SendRounds()
        {
            try
            {
                for (int round = 0; round < 3; round++)
                {
                    foreach (var target in targets)
                    {
                        try { await client.SendAsync(query, new IPEndPoint(target, discoveryPort), timeout.Token); } catch (SocketException) { }
                    }
                    await Task.Delay(700, timeout.Token);
                }
            }
            catch (OperationCanceledException) { }
        }
        var sending = SendRounds();
        try
        {
            while (!timeout.IsCancellationRequested && found.Count < 8)
            {
                var reply = await client.ReceiveAsync(timeout.Token);
                if (reply.Buffer.Length > 512 || !Invitation.IsLocal(reply.RemoteEndPoint.Address)) continue;
                try
                {
                    using var json = JsonDocument.Parse(reply.Buffer);
                    var root = json.RootElement;
                    if (root.GetProperty("kind").GetString() != "DeviceBridge.Host.v1" || root.GetProperty("nonce").GetString() != nonce) continue;
                    if (!IPAddress.TryParse(root.GetProperty("address").GetString(), out var address) || address.AddressFamily != AddressFamily.InterNetwork || !Invitation.IsLocal(address)) continue;
                    var port = root.GetProperty("port").GetInt32(); if (port is < 1024 or > 65535) continue;
                    // The reply's source is the address actually reachable on
                    // this network, even if the host also has a VPN or Ethernet.
                    var endpoint = new IPEndPoint(reply.RemoteEndPoint.Address, port); found[endpoint.ToString()] = endpoint;
                }
                catch (JsonException) { }
                catch (InvalidOperationException) { }
                catch (KeyNotFoundException) { }
            }
        }
        catch (OperationCanceledException) when (!token.IsCancellationRequested) { }
        catch (SocketException) when (!token.IsCancellationRequested) { }
        finally { timeout.Cancel(); await sending; }
        return found.Values.ToList();
    }
    static List<IPAddress> Broadcasts()
    {
        var result = new List<IPAddress> { IPAddress.Broadcast };
        foreach (var adapter in NetworkInterface.GetAllNetworkInterfaces().Where(n => n.OperationalStatus == OperationalStatus.Up && n.NetworkInterfaceType != NetworkInterfaceType.Loopback))
        foreach (var address in adapter.GetIPProperties().UnicastAddresses.Where(a => a.Address.AddressFamily == AddressFamily.InterNetwork && Invitation.IsLocal(a.Address)))
        {
            var ip = address.Address.GetAddressBytes(); var mask = address.IPv4Mask.GetAddressBytes();
            if (mask.Length == 4) result.Add(new IPAddress(ip.Select((b, i) => (byte)(b | ~mask[i])).ToArray()));
        }
        return result.Distinct().ToList();
    }
    public void Dispose() { stop.Cancel(); socket.Dispose(); }
}
