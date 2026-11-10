using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

namespace DeviceBridge;

internal sealed class RemoteInput : IDisposable
{
    readonly InputBridge input = new(_ => false);
    readonly object gate = new();
    readonly Queue<(JsonElement Value, Rectangle Bounds, CancellationToken Token, int Cost)> pending = new();
    CancellationTokenSource? lifetime = new();
    bool draining, disposed;
    int pendingBytes;
    readonly Func<string, CancellationToken, Task>? textOverride;
    readonly Action<JsonElement, Rectangle>? immediateOverride;
    public event Action<string>? Failed;
    internal Task Completion { get; private set; } = Task.CompletedTask;
    internal RemoteInput(Func<string, CancellationToken, Task>? textOverride = null, Action<JsonElement, Rectangle>? immediateOverride = null) { this.textOverride = textOverride; this.immediateOverride = immediateOverride; }
    public void Apply(JsonElement value, Rectangle bounds)
    {
        if (value.GetProperty("type").GetString() == "release-all") { Release(); return; }
        bool start; int cost = Encoding.UTF8.GetByteCount(value.GetRawText());
        lock (gate)
        {
            ObjectDisposedException.ThrowIf(disposed, this);
            if (pending.Count >= 128 || cost > 32768 - pendingBytes) throw new IOException("Too much queued remote input. Stop sharing and reconnect.");
            pending.Enqueue((value.Clone(), bounds, lifetime!.Token, cost)); pendingBytes += cost;
            start = !draining; if (start) draining = true;
        }
        if (start) Completion = DrainAsync();
    }
    async Task DrainAsync()
    {
        while (true)
        {
            (JsonElement Value, Rectangle Bounds, CancellationToken Token, int Cost) item;
            lock (gate) { if (!pending.TryDequeue(out item)) { draining = false; return; } pendingBytes -= item.Cost; }
            try
            {
                item.Token.ThrowIfCancellationRequested();
                if (item.Value.GetProperty("type").GetString() == "text")
                {
                    var text = item.Value.GetProperty("text").GetString()!;
                    if (textOverride != null) await textOverride(text, item.Token); else await WriteTextAsync(text, item.Token);
                }
                else if (immediateOverride != null) immediateOverride(item.Value, item.Bounds);
                else ApplyImmediate(item.Value, item.Bounds);
            }
            catch (OperationCanceledException) when (item.Token.IsCancellationRequested) { }
            catch (Exception error) { Release(); Failed?.Invoke(error.Message); }
        }
    }
    void ApplyImmediate(JsonElement value, Rectangle bounds)
    {
        var type = value.GetProperty("type").GetString();
        if (type == "pointer")
        {
            var p = value.GetProperty("point"); double x = p.GetProperty("x").GetDouble(), y = p.GetProperty("y").GetDouble();
            if (!double.IsFinite(x) || !double.IsFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) throw new IOException("Invalid pointer position.");
            Cursor.Position = new Point(bounds.Left + (int)Math.Round(x * (bounds.Width - 1)), bounds.Top + (int)Math.Round(y * (bounds.Height - 1)));
        }
        else if (type == "button")
        {
            bool down = value.GetProperty("down").GetBoolean(); int message = value.GetProperty("button").GetString() switch { "primary" => down ? 0x201 : 0x202, "secondary" => down ? 0x204 : 0x205, "middle" => down ? 0x207 : 0x208, _ => throw new IOException("Invalid mouse button.") };
            input.Apply(new Packet("mouse", A: message));
        }
        else if (type == "scroll")
        {
            double x = value.GetProperty("dx").GetDouble(), y = value.GetProperty("dy").GetDouble(); if (!double.IsFinite(x) || !double.IsFinite(y) || Math.Abs(x) > 4096 || Math.Abs(y) > 4096) throw new IOException("Invalid scroll.");
            if (y != 0) input.Apply(new Packet("mouse", A: 0x20A, B: -(int)y)); if (x != 0) input.Apply(new Packet("mouse", A: 0x20E, B: (int)x));
        }
        else if (type == "key") { var (key, extended) = Key(value.GetProperty("code").GetString()!); input.Apply(new Packet("key", A: key, C: extended | (value.GetProperty("down").GetBoolean() ? 0 : 2))); }
        else if (type == "text")
        {
            var text = value.GetProperty("text").GetString()!; if (text.Length == 0 || Encoding.UTF8.GetByteCount(text) > 4096 || text.Contains('\0')) throw new IOException("Invalid typed text.");
            throw new IOException("Text must use the paced input queue.");
        }
        else if (type == "release-all") input.ReleaseAll(); else throw new IOException("Invalid input event.");
    }
    internal static (int Key, int Extended) Key(string code)
    {
        if (code.Length == 4 && code.StartsWith("Key") && code[3] is >= 'A' and <= 'Z') return (code[3], 0);
        if (code.Length == 6 && code.StartsWith("Digit") && code[5] is >= '0' and <= '9') return (code[5], 0);
        if (code.StartsWith('F') && int.TryParse(code.AsSpan(1), out int function) && function is >= 1 and <= 12) return (0x70 + function - 1, 0);
        return code switch
        {
            "Enter" => (13, 0), "Backspace" => (8, 0), "Tab" => (9, 0), "Escape" => (27, 0), "Space" => (32, 0),
            "ControlLeft" => (0xA2, 0), "ControlRight" => (0xA3, 1), "ShiftLeft" => (0xA0, 0), "ShiftRight" => (0xA1, 0), "AltLeft" => (0xA4, 0), "AltRight" => (0xA5, 1), "MetaLeft" => (0x5B, 1), "MetaRight" => (0x5C, 1),
            "ArrowLeft" => (37, 1), "ArrowUp" => (38, 1), "ArrowRight" => (39, 1), "ArrowDown" => (40, 1), "Home" => (36, 1), "End" => (35, 1), "PageUp" => (33, 1), "PageDown" => (34, 1), "Insert" => (45, 1), "Delete" => (46, 1),
            _ => throw new IOException("Unsupported keyboard shortcut.")
        };
    }
    internal readonly record struct TextEvent(char Unit, bool Up);
    internal static async Task WriteTextAsync(string text, CancellationToken token, Func<TextEvent[], uint>? sink = null, Func<CancellationToken, Task>? pause = null)
    {
        if (text.Length == 0 || new UTF8Encoding(false, true).GetByteCount(text) > 4096 || text.Contains('\0')) throw new IOException("Invalid typed text.");
        // WinUI text controls can overwrite queued VK_PACKET characters when a
        // whole paragraph is injected at once. Emit balanced UTF-16 key pairs,
        // yield to the app between them, and cancel immediately on disconnect.
        foreach (char unit in text)
        {
            token.ThrowIfCancellationRequested();
            var events = new[] { new TextEvent(unit, false), new TextEvent(unit, true) };
            uint sent;
            if (sink != null) sent = sink(events);
            else
            {
                var commands = events.Select(e => new NativeInput { type = 1, union = new NativeUnion { keyboard = new Keyboard { scan = e.Unit, flags = 4u | (e.Up ? 2u : 0) } } }).ToArray();
                sent = SendInput((uint)commands.Length, commands, Marshal.SizeOf<NativeInput>());
            }
            if (sent != events.Length) throw new Win32Exception("Windows could not finish remote typing on this screen.");
            if (pause != null) await pause(token); else await Task.Delay(50, token);
        }
    }
    [StructLayout(LayoutKind.Sequential)] struct Keyboard { public ushort vk, scan; public uint flags, time; public nuint extra; }
    [StructLayout(LayoutKind.Sequential)] struct Mouse { public int x, y; public uint data, flags, time; public nuint extra; }
    [StructLayout(LayoutKind.Explicit)] struct NativeUnion { [FieldOffset(0)] public Keyboard keyboard; [FieldOffset(0)] public Mouse mouse; }
    [StructLayout(LayoutKind.Sequential)] struct NativeInput { public uint type; public NativeUnion union; }
    [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint count, NativeInput[] input, int size);
    public void Release()
    {
        lock (gate) { pending.Clear(); pendingBytes = 0; var prior = lifetime; lifetime = disposed ? null : new(); prior?.Cancel(); prior?.Dispose(); }
        input.ReleaseAll();
    }
    public void Dispose() { lock (gate) { if (disposed) return; disposed = true; } Release(); input.Dispose(); }

}
