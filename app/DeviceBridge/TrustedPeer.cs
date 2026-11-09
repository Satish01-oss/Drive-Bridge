using System.Security.Cryptography;
using System.Text.Json;

namespace DeviceBridge;

public sealed record TrustedPeer(bool Desk, Invitation Invitation, byte[]? Certificate)
{
    static string Location => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DeviceBridge", "peer.dat");
    static readonly byte[] Entropy = "DeviceBridge.TrustedPeer.v1"u8.ToArray();
    public static TrustedPeer? Load()
    {
        try
        {
            if (!File.Exists(Location)) return null;
            var plain = ProtectedData.Unprotect(File.ReadAllBytes(Location), Entropy, DataProtectionScope.CurrentUser);
            try { return JsonSerializer.Deserialize<TrustedPeer>(plain); }
            finally { CryptographicOperations.ZeroMemory(plain); }
        }
        catch { return null; }
    }
    public void Save()
    {
        var plain = JsonSerializer.SerializeToUtf8Bytes(this);
        try
        {
            var encrypted = ProtectedData.Protect(plain, Entropy, DataProtectionScope.CurrentUser);
            Directory.CreateDirectory(Path.GetDirectoryName(Location)!);
            File.WriteAllBytes(Location + ".tmp", encrypted);
            File.Move(Location + ".tmp", Location, true);
        }
        finally { CryptographicOperations.ZeroMemory(plain); }
    }
    public static void Forget() { if (File.Exists(Location)) File.Delete(Location); }
}
