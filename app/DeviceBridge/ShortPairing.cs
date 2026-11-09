using System.Net.Security;
using System.Security.Cryptography;
using System.Text;
using Org.BouncyCastle.Crypto.Agreement.Srp;
using Org.BouncyCastle.Crypto.Digests;
using Org.BouncyCastle.Security;
using BcInteger = Org.BouncyCastle.Math.BigInteger;

namespace DeviceBridge;

public sealed class PairingRejectedException : IOException
{
    public PairingRejectedException() : base("The connection key did not match.") { }
}

// SRP authenticates the short code without transmitting it. Evidence is additionally
// bound to the TLS certificate and a fresh client nonce, preventing a TLS relay
// from borrowing the real host's SRP exchange for a different certificate.
public sealed class ShortPairing
{
    const string Alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    static readonly byte[] Identity = "DeviceBridge/short-pairing/v1"u8.ToArray();
    readonly byte[] salt = RandomNumberGenerator.GetBytes(16);
    readonly BcInteger verifier;
    public string Code { get; } = new(Enumerable.Range(0, 6).Select(_ => Alphabet[RandomNumberGenerator.GetInt32(Alphabet.Length)]).ToArray());
    public ShortPairing()
    {
        var generator = new Srp6VerifierGenerator();
        var group = Srp6StandardGroups.rfc5054_2048;
        generator.Init(group.N, group.G, new Sha256Digest());
        verifier = generator.GenerateVerifier(salt, Identity, Encoding.ASCII.GetBytes(Code));
    }
    public static string Normalize(string code)
    {
        var normalized = code.Trim().Replace(" ", "").Replace("-", "").ToUpperInvariant();
        if (normalized.Length != 6 || normalized.Any(c => !Alphabet.Contains(c))) throw new ArgumentException("Enter the six-character key shown on the first PC.");
        return normalized;
    }
    public async Task AcceptAsync(SslStream stream, Packet hello, byte[] certificate, CancellationToken token)
    {
        if (hello.Data?.Length != 16) throw new PairingRejectedException();
        var group = Srp6StandardGroups.rfc5054_2048;
        var server = new Srp6Server(); server.Init(group.N, group.G, verifier, new Sha256Digest(), new SecureRandom());
        var publicValue = server.GenerateServerCredentials();
        await Wire.WriteAsync(stream, new Packet("srp-challenge", Text: Convert.ToHexString(salt), Data: publicValue.ToByteArrayUnsigned()), token);
        var proof = await Wire.ReadAsync(stream, token);
        try
        {
            if (proof.Kind != "srp-proof" || proof.Data is not { Length: > 0 and <= 256 } || proof.Text == null || proof.Text.Length is < 2 or > 64) throw new PairingRejectedException();
            server.CalculateSecret(new BcInteger(1, proof.Data));
            if (!server.VerifyClientEvidenceMessage(new BcInteger(1, Convert.FromHexString(proof.Text!)))) throw new PairingRejectedException();
            var evidence = server.CalculateServerEvidenceMessage(); var sessionKey = server.CalculateSessionKey().ToByteArrayUnsigned();
            try
            {
                await Wire.WriteAsync(stream, new Packet("srp-ok", Text: Convert.ToHexString(Bind(sessionKey, certificate, hello.Data, false)), Data: evidence.ToByteArrayUnsigned()), token);
                var confirmation = await Wire.ReadAsync(stream, token);
                if (confirmation.Kind != "srp-bound" || confirmation.Data?.Length != 32 || !CryptographicOperations.FixedTimeEquals(confirmation.Data, Bind(sessionKey, certificate, hello.Data, true))) throw new PairingRejectedException();
            }
            finally { CryptographicOperations.ZeroMemory(sessionKey); }
        }
        catch (Org.BouncyCastle.Crypto.CryptoException) { throw new PairingRejectedException(); }
        catch (FormatException) { throw new PairingRejectedException(); }
    }
    public static async Task<Packet> JoinAsync(SslStream stream, string code, byte[] certificate, CancellationToken token)
    {
        code = Normalize(code);
        var nonce = RandomNumberGenerator.GetBytes(16);
        await Wire.WriteAsync(stream, new Packet("short-pair", A: 7, Data: nonce), token);
        var challenge = await Wire.ReadAsync(stream, token);
        if (challenge.Kind != "srp-challenge" || challenge.Text?.Length != 32 || challenge.Data is not { Length: > 0 and <= 256 }) throw new PairingRejectedException();
        var group = Srp6StandardGroups.rfc5054_2048;
        var client = new Srp6Client(); client.Init(group.N, group.G, new Sha256Digest(), new SecureRandom());
        var publicValue = client.GenerateClientCredentials(Convert.FromHexString(challenge.Text), Identity, Encoding.ASCII.GetBytes(code));
        client.CalculateSecret(new BcInteger(1, challenge.Data));
        var evidence = client.CalculateClientEvidenceMessage();
        await Wire.WriteAsync(stream, new Packet("srp-proof", Text: Convert.ToHexString(evidence.ToByteArrayUnsigned()), Data: publicValue.ToByteArrayUnsigned()), token);
        var response = await Wire.ReadAsync(stream, token);
        if (response.Kind != "srp-ok" || response.Data is not { Length: > 0 and <= 32 } || response.Text?.Length != 64 || !client.VerifyServerEvidenceMessage(new BcInteger(1, response.Data))) throw new PairingRejectedException();
        var sessionKey = client.CalculateSessionKey().ToByteArrayUnsigned();
        try
        {
            if (!CryptographicOperations.FixedTimeEquals(Convert.FromHexString(response.Text), Bind(sessionKey, certificate, nonce, false))) throw new PairingRejectedException();
            await Wire.WriteAsync(stream, new Packet("srp-bound", Data: Bind(sessionKey, certificate, nonce, true)), token);
            return await Wire.ReadAsync(stream, token);
        }
        finally { CryptographicOperations.ZeroMemory(sessionKey); }
    }
    static byte[] Bind(byte[] key, byte[] certificate, byte[] nonce, bool client) => HMACSHA256.HashData(key, SHA256.HashData(certificate).Concat(nonce).Concat(new[] { client ? (byte)1 : (byte)0 }).ToArray());
}
