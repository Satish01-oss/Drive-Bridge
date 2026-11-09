using System.ComponentModel;
using System.Runtime.InteropServices;

namespace DeviceBridge;

public sealed class InputBridge : IDisposable
{
    readonly Func<Packet, bool> send;
    readonly HookProc keyboardProc, mouseProc;
    nint keyboard, mouse;
    Point original, anchor;
    Point? lastLocalPoint;
    bool watchEdge, edgePending, remoteEdge;
    DeviceSide side, remoteSide;
    long edgeCooldown;
    readonly Dictionary<int, uint> keys = new();
    readonly HashSet<int> buttons = new();
    readonly HashSet<uint> localKeys = new();
    readonly object inputGate = new();
    HookLoop? hookLoop;
    public event Action<string>? Emergency;
    public event Action<int>? EdgeEntered;
    public event Action<int>? ReturnRequested;
    public bool Capturing => Volatile.Read(ref keyboard) != 0;
    public InputBridge(Func<Packet, bool> send)
    {
        this.send = send;
        keyboardProc = (code, message, data) => Guard(() => Keyboard(code, message, data), code, message, data);
        mouseProc = (code, message, data) => Guard(() => Mouse(code, message, data), code, message, data);
    }
    nint Guard(Func<nint> action, int code, nint message, nint data)
    {
        try { return action(); }
        catch (Exception e)
        {
            try { StopCore(); } catch { }
            try { Emergency?.Invoke("Input monitor stopped: " + e.GetType().Name + ". " + e.Message); } catch { }
            return CallNextHookEx(0, code, message, data);
        }
    }
    public void Start() => (hookLoop ??= new HookLoop()).Invoke(StartCore);
    void StartCore()
    {
        if (Capturing) return;
        original = Cursor.Position;
        var screen = Screen.FromPoint(original).Bounds;
        anchor = new Point(screen.Left + screen.Width / 2, screen.Top + screen.Height / 2);
        Cursor.Position = anchor;
        keyboard = SetWindowsHookEx(13, keyboardProc, GetModuleHandle(null), 0);
        if (mouse == 0) mouse = SetWindowsHookEx(14, mouseProc, GetModuleHandle(null), 0);
        if (keyboard == 0 || mouse == 0) { int error = Marshal.GetLastWin32Error(); StopCore(); throw new Win32Exception(error); }
        edgePending = false;
    }
    public void WatchEdge(bool enabled, DeviceSide direction)
    {
        if (hookLoop == null && !enabled) return;
        (hookLoop ??= new HookLoop()).Invoke(() => WatchCore(enabled, direction));
    }
    void WatchCore(bool enabled, DeviceSide direction)
    {
        if (watchEdge == enabled && side == direction && (!enabled || mouse != 0)) return;
        watchEdge = enabled; side = direction; edgePending = false; lastLocalPoint = null;
        edgeCooldown = Environment.TickCount64 + 150;
        if (enabled && mouse == 0)
        {
            mouse = SetWindowsHookEx(14, mouseProc, GetModuleHandle(null), 0);
            if (mouse == 0) { watchEdge = false; throw new Win32Exception(Marshal.GetLastWin32Error()); }
        }
        else if (!enabled && !Capturing && mouse != 0) { UnhookWindowsHookEx(mouse); mouse = 0; }
    }
    public void StopCapture(int? returnFraction = null)
    {
        hookLoop?.Invoke(() => StopCaptureCore(returnFraction));
    }
    void StopCaptureCore(int? returnFraction = null)
    {
        bool wasCapturing = Capturing;
        if (keyboard != 0) UnhookWindowsHookEx(keyboard);
        keyboard = 0;
        if (!watchEdge && mouse != 0) { UnhookWindowsHookEx(mouse); mouse = 0; }
        localKeys.Clear();
        edgePending = false; lastLocalPoint = null; edgeCooldown = Environment.TickCount64 + 150;
        if (wasCapturing) Cursor.Position = returnFraction.HasValue ? DesktopGeometry.Entry(SystemInformation.VirtualScreen, side, returnFraction.Value, false) : original;
    }
    public void Stop()
    {
        hookLoop?.Invoke(StopCore); remoteEdge = false;
    }
    void StopCore()
    {
        watchEdge = false; StopCaptureCore();
        if (mouse != 0) { UnhookWindowsHookEx(mouse); mouse = 0; }
    }
    public void ConfigureRemote(DeviceSide direction, int fraction, bool enabled, bool enter)
    {
        remoteSide = direction; remoteEdge = enabled;
        if (enter) Cursor.Position = DesktopGeometry.Entry(SystemInformation.VirtualScreen, direction, fraction, true);
    }
    nint Keyboard(int code, nint message, nint data)
    {
        if (code < 0) return CallNextHookEx(0, code, message, data);
        var k = Marshal.PtrToStructure<Kbd>(data);
        if ((k.flags & 16) != 0) return CallNextHookEx(0, code, message, data);
        bool up = message == 0x101 || message == 0x105;
        if (up) localKeys.Remove(k.vk); else localKeys.Add(k.vk);
        if (!up && k.vk is 19 or 27 && (localKeys.Contains(0xA2) || localKeys.Contains(0xA3) || localKeys.Contains(0x11)) &&
            (localKeys.Contains(0xA4) || localKeys.Contains(0xA5) || localKeys.Contains(0x12))) { StopCore(); Emergency?.Invoke("Emergency shortcut pressed. All sharing stopped."); return 1; }
        // Keep toggle and emergency chord local. Modifier key-ups are cleared by release.
        if (k.vk == 119 || k.vk == 19) return CallNextHookEx(0, code, message, data);
        send(new Packet("key", A: (int)k.vk, B: (int)k.scan, C: (up ? 2 : 0) | ((k.flags & 1) != 0 ? 1 : 0)));
        return 1;
    }
    nint Mouse(int code, nint message, nint data)
    {
        if (code < 0) return CallNextHookEx(0, code, message, data);
        var m = Marshal.PtrToStructure<Ms>(data);
        if ((m.flags & 1) != 0) return CallNextHookEx(0, code, message, data);
        int kind = (int)message;
        if (!Capturing)
        {
            if (kind == 0x200)
            {
                var position = new Point(m.x, m.y); var previous = lastLocalPoint ?? position; lastLocalPoint = position;
                var delta = new Point(position.X - previous.X, position.Y - previous.Y);
                var bounds = SystemInformation.VirtualScreen;
                if (watchEdge && !edgePending && Environment.TickCount64 >= edgeCooldown && DesktopGeometry.Crossing(bounds, position, delta, side))
                { edgePending = true; EdgeEntered?.Invoke(DesktopGeometry.Fraction(bounds, position, side)); }
            }
            return CallNextHookEx(0, code, message, data);
        }
        if (kind == 0x200)
        {
            int x = m.x - anchor.X, y = m.y - anchor.Y;
            if (x != 0 || y != 0) send(new Packet("move", A: Math.Clamp(x, -32768, 32767), B: Math.Clamp(y, -32768, 32767)));
            // Keep the desk cursor away from screen edges while it is captured.
            // A recenter event has zero delta and is never forwarded.
            if (Cursor.Position != anchor) Cursor.Position = anchor;
        }
        else if (kind is 0x201 or 0x202 or 0x204 or 0x205 or 0x207 or 0x208 or 0x20A or 0x20B or 0x20C or 0x20E)
            send(new Packet("mouse", A: kind, B: unchecked((short)(m.mouseData >> 16))));
        return 1;
    }
    public void Apply(Packet p, CancellationToken lifetime = default)
    {
        lock (inputGate)
        {
        if (lifetime.IsCancellationRequested) return;
        if (p.Kind == "key")
        {
            if (p.A is < 1 or > 254 || p.B is < 0 or > 65535 || p.C is < 0 or > 3) throw new IOException("Invalid keyboard event.");
            // Virtual key preserves non-US layout handling on receiver; extended flag retained.
            Inject(new INPUT { type = 1, u = new UNION { ki = new KEYBDINPUT { vk = (ushort)p.A, scan = (ushort)p.B, flags = (uint)p.C } } });
            if ((p.C & 2) != 0) keys.Remove(p.A); else keys[p.A] = (uint)(p.C & 1);
        }
        else if (p.Kind == "move")
        {
            if (p.A is < -32768 or > 32767 || p.B is < -32768 or > 32767) throw new IOException("Invalid pointer event.");
            var position = Cursor.Position; var bounds = SystemInformation.VirtualScreen;
            if (remoteEdge && DesktopGeometry.Crossing(bounds, position, new Point(p.A, p.B), DesktopGeometry.Opposite(remoteSide)))
            {
                remoteEdge = false;
                ReturnRequested?.Invoke(DesktopGeometry.Fraction(bounds, position, remoteSide)); return;
            }
            Inject(MouseInput(1, p.A, p.B));
        }
        else if (p.Kind == "mouse")
        {
            uint flags = p.A switch { 0x201 => 2, 0x202 => 4, 0x204 => 8, 0x205 => 16, 0x207 => 32, 0x208 => 64, 0x20A => 0x800, 0x20B => 0x80, 0x20C => 0x100, 0x20E => 0x1000, _ => throw new IOException("Invalid mouse event.") };
            if (p.A is 0x20B or 0x20C && p.B is not (1 or 2)) throw new IOException("Invalid mouse button.");
            Inject(MouseInput(flags, data: unchecked((uint)p.B)));
            int button = p.A switch { 0x201 or 0x202 => 1, 0x204 or 0x205 => 2, 0x207 or 0x208 => 3, 0x20B or 0x20C => 3 + p.B, _ => 0 };
            if (button != 0) { if (p.A is 0x201 or 0x204 or 0x207 or 0x20B) buttons.Add(button); else buttons.Remove(button); }
        }
        }
    }
    public void ReleaseAll()
    {
        lock (inputGate)
        {
        foreach (var key in keys.ToArray()) SendInput(1, new[] { new INPUT { type = 1, u = new UNION { ki = new KEYBDINPUT { vk = (ushort)key.Key, flags = 2 | key.Value } } } }, Marshal.SizeOf<INPUT>());
        foreach (var b in buttons.ToArray()) SendInput(1, new[] { MouseInput(b switch { 1 => 4, 2 => 16, 3 => 64, _ => 0x100 }, data: (uint)Math.Max(0, b - 3)) }, Marshal.SizeOf<INPUT>());
        keys.Clear(); buttons.Clear();
        }
    }
    static INPUT MouseInput(uint flags, int x = 0, int y = 0, uint data = 0) => new() { type = 0, u = new UNION { mi = new MOUSEINPUT { dx = x, dy = y, data = data, flags = flags } } };
    static void Inject(INPUT input) { if (SendInput(1, new[] { input }, Marshal.SizeOf<INPUT>()) != 1) throw new Win32Exception("Windows blocked remote input. Elevated apps and secure screens may not accept input."); }
    public void Dispose() { Stop(); ReleaseAll(); hookLoop?.Dispose(); }
    delegate nint HookProc(int code, nint message, nint data);
    [StructLayout(LayoutKind.Sequential)] struct Kbd { public uint vk, scan, flags, time; public nuint extra; }
    [StructLayout(LayoutKind.Sequential)] struct Ms { public int x, y; public uint mouseData, flags, time; public nuint extra; }
    [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION u; }
    [StructLayout(LayoutKind.Explicit)] struct UNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
    [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint data, flags, time; public nuint extra; }
    [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort vk, scan; public uint flags, time; public nuint extra; }
    [DllImport("user32.dll", SetLastError = true)] static extern nint SetWindowsHookEx(int id, HookProc proc, nint mod, uint thread);
    [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(nint hook);
    [DllImport("user32.dll")] static extern nint CallNextHookEx(nint hook, int code, nint message, nint data);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern nint GetModuleHandle(string? module);
    [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint count, INPUT[] inputs, int size);
}
