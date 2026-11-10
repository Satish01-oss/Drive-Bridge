using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Org.BouncyCastle.Crypto.Parameters;
using Org.BouncyCastle.Crypto.Signers;
using Org.BouncyCastle.X509;

namespace DeviceBridge;

internal sealed class RemoteProtectedStore
{
    readonly string directory;
    static readonly byte[] Entropy = SHA256.HashData(Encoding.UTF8.GetBytes("DeviceBridge.Remote.v1"));
    public RemoteProtectedStore(string? directory = null) { this.directory = directory ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DeviceBridge", "Remote"); }
    byte[]? Read(string name) { var path = Path.Combine(directory, name + ".bin"); return File.Exists(path) ? ProtectedData.Unprotect(File.ReadAllBytes(path), Entropy, DataProtectionScope.CurrentUser) : null; }
    void Write(string name, byte[] bytes)
    {
        Directory.CreateDirectory(directory); var path = Path.Combine(directory, name + ".bin"); var temp = path + "." + Guid.NewGuid().ToString("N");
        try { File.WriteAllBytes(temp, ProtectedData.Protect(bytes, Entropy, DataProtectionScope.CurrentUser)); File.Move(temp, path, true); }
        finally { if (File.Exists(temp)) File.Delete(temp); }
    }
    public JsonElement? Get(string key)
    {
        if (key != "grants") throw new IOException("Unsupported storage key.");
        var data = Read(key); return data == null ? null : JsonDocument.Parse(data).RootElement.Clone();
    }
    public void Set(string key, JsonElement value)
    {
        if (key != "grants" || value.ValueKind != JsonValueKind.Array || value.GetArrayLength() > 1000) throw new IOException("Invalid grant storage.");
        var bytes = JsonSerializer.SerializeToUtf8Bytes(value); if (bytes.Length > 2 * 1024 * 1024) throw new IOException("Grant storage is full."); Write(key, bytes);
    }
    byte[] Seed()
    {
        var seed = Read("identity"); if (seed != null) { if (seed.Length != 32) throw new IOException("Invalid saved device identity."); return seed; }
        seed = RandomNumberGenerator.GetBytes(32); Write("identity", seed); return seed;
    }
    public string PublicKey
    {
        get { var seed = Seed(); try { var key = new Ed25519PrivateKeyParameters(seed, 0).GeneratePublicKey(); return Base64Url(SubjectPublicKeyInfoFactory.CreateSubjectPublicKeyInfo(key).GetDerEncoded()); } finally { CryptographicOperations.ZeroMemory(seed); } }
    }
    public string Sign(string purpose, JsonElement value)
    {
        if (purpose is not ("auth" or "grant" or "signal")) throw new IOException("Unsupported signing purpose.");
        var data = Encoding.UTF8.GetBytes("devicebridge." + purpose + ".v1\n" + Canonical(value)); if (data.Length > 65536) throw new IOException("Signing request too large.");
        var seed = Seed(); try { var signer = new Ed25519Signer(); signer.Init(true, new Ed25519PrivateKeyParameters(seed, 0)); signer.BlockUpdate(data, 0, data.Length); return Base64Url(signer.GenerateSignature()); } finally { CryptographicOperations.ZeroMemory(seed); }
    }
    public JsonElement OwnGrant(string id)
    {
        var records = Get("grants"); if (records == null) throw new IOException("This phone has not been approved.");
        foreach (var record in records.Value.EnumerateArray())
        {
            var grant = record.GetProperty("grant"); if (grant.GetProperty("id").GetString() != id) continue;
            if (record.GetProperty("hostKey").GetString() != PublicKey || grant.GetProperty("hostId").GetString() != Base64Url(SHA256.HashData(FromBase64Url(PublicKey))) || grant.GetProperty("expiresAt").GetInt64() <= DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()) throw new IOException("Approval expired or belongs to another computer.");
            var signed = Encoding.UTF8.GetBytes("devicebridge.grant.v1\n" + Canonical(grant)); var verifier = new Ed25519Signer(); var publicDer = FromBase64Url(PublicKey);
            verifier.Init(false, new Ed25519PublicKeyParameters(publicDer.AsSpan(publicDer.Length - 32).ToArray(), 0)); verifier.BlockUpdate(signed, 0, signed.Length);
            if (!verifier.VerifySignature(FromBase64Url(record.GetProperty("signature").GetString()!))) throw new IOException("Invalid saved approval.");
            return grant.Clone();
        }
        throw new IOException("This phone has not been approved.");
    }
    public static bool Verify(string publicKey, string purpose, JsonElement value, string signature)
    {
        try
        {
            if (purpose is not ("auth" or "grant" or "signal") || publicKey.Length != 59 || signature.Length != 86 || !publicKey.StartsWith("MCowBQYDK2VwAyEA", StringComparison.Ordinal)) return false;
            var key = FromBase64Url(publicKey); var bytes = Encoding.UTF8.GetBytes("devicebridge." + purpose + ".v1\n" + Canonical(value)); if (bytes.Length > 65536) return false;
            var verifier = new Ed25519Signer(); verifier.Init(false, new Ed25519PublicKeyParameters(key.AsSpan(key.Length - 32).ToArray(), 0)); verifier.BlockUpdate(bytes, 0, bytes.Length); return verifier.VerifySignature(FromBase64Url(signature));
        }
        catch { return false; }
    }
    internal static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    static byte[] FromBase64Url(string text) { if (text.Length > 512) throw new IOException("Invalid encoded identity."); text = text.Replace('-', '+').Replace('_', '/'); return Convert.FromBase64String(text.PadRight((text.Length + 3) / 4 * 4, '=')); }
    internal static string Canonical(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.Object => "{" + string.Join(",", value.EnumerateObject().OrderBy(p => p.Name, StringComparer.Ordinal).Select(p => Quote(p.Name) + ":" + Canonical(p.Value))) + "}",
        JsonValueKind.Array => "[" + string.Join(",", value.EnumerateArray().Select(Canonical)) + "]",
        JsonValueKind.String => Quote(value.GetString()!),
        JsonValueKind.True => "true", JsonValueKind.False => "false", JsonValueKind.Null => "null",
        JsonValueKind.Number when value.TryGetInt64(out var number) && number is >= -9007199254740991L and <= 9007199254740991L => number.ToString(System.Globalization.CultureInfo.InvariantCulture),
        _ => throw new IOException("Invalid signed JSON value.")
    };
    static string Quote(string text)
    {
        var result = new StringBuilder("\"");
        for (int i = 0; i < text.Length; i++)
        {
            char c = text[i];
            if (c == '"') result.Append("\\\""); else if (c == '\\') result.Append("\\\\");
            else if (c == '\b') result.Append("\\b"); else if (c == '\f') result.Append("\\f"); else if (c == '\n') result.Append("\\n"); else if (c == '\r') result.Append("\\r"); else if (c == '\t') result.Append("\\t");
            else if (c < 32 || char.IsSurrogate(c) && !(char.IsHighSurrogate(c) && i + 1 < text.Length && char.IsLowSurrogate(text[i + 1])) && !(char.IsLowSurrogate(c) && i > 0 && char.IsHighSurrogate(text[i - 1]))) result.Append("\\u").Append(((int)c).ToString("x4"));
            else result.Append(c);
        }
        return result.Append('"').ToString();
    }
}
