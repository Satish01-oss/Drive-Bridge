using System.Text.Json;

namespace DeviceBridge;

public sealed record MicrophoneChoice(string? Id, string Name)
{
    public override string ToString() => Name;
    static string Pathname => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DeviceBridge", "microphone.json");
    public static string? Load()
    {
        try { return JsonSerializer.Deserialize<MicrophoneChoice>(File.ReadAllText(Pathname))?.Id; } catch { return null; }
    }
    public void Save() { Directory.CreateDirectory(Path.GetDirectoryName(Pathname)!); File.WriteAllText(Pathname, JsonSerializer.Serialize(this)); }
}
