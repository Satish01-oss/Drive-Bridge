using System.Drawing.Imaging;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace DeviceBridge;

internal sealed class RemoteHostForm : Form
{
    const string Origin = "https://devicebridge.local";
    readonly WebView2 web = new() { Dock = DockStyle.Fill };
    readonly RemoteProtectedStore store = new();
    readonly RemoteInput input = new();
    readonly NotifyIcon tray;
    readonly bool designPreview;
    string? captureId;
    Rectangle captureBounds;
    bool allowInput;
    long grantExpiresAt;
    CancellationTokenSource? captureStop;
    sealed class FrameState { public int Pending; public int AudioPending; }
    FrameState? frameState;
    string? displayId;
    AudioBridge? remoteAudio;
    bool allowMicrophone;
    int microphoneDevice = -2;
    public bool QuitRequested { get; private set; }
    public RemoteHostForm(bool designPreview = false)
    {
        this.designPreview = designPreview;
        Text = AppActivation.Title + " · Remote preview"; Icon = AppActivation.Icon; ClientSize = new Size(1020, 790); MinimumSize = new Size(780, 620); StartPosition = FormStartPosition.CenterScreen;
        Controls.Add(web); var menu = new ContextMenuStrip(); menu.Items.Add("Open DeviceBridge", null, (_, _) => RestoreWindow());
        menu.Items.Add("Stop remote sharing", null, (_, _) => EmergencyStop()); menu.Items.Add("Back to local sharing", null, (_, _) => CloseToWelcome());
        menu.Items.Add("Disconnect and quit", null, (_, _) => { QuitRequested = true; Close(); });
        tray = new NotifyIcon { Icon = AppActivation.Icon, Text = "DeviceBridge · Remote", ContextMenuStrip = menu, Visible = true }; tray.DoubleClick += (_, _) => RestoreWindow();
        Shown += async (_, _) => await InitializeAsync();
        Resize += (_, _) => { if (WindowState == FormWindowState.Minimized) Hide(); };
        FormClosing += (_, e) => { if (!QuitRequested && !returnToWelcome && e.CloseReason == CloseReason.UserClosing) { e.Cancel = true; Hide(); } };
        FormClosed += (_, _) => { StopCapture(); input.Dispose(); tray.Visible = false; tray.Dispose(); UnregisterHotKey(Handle, 41); };
    }
    bool returnToWelcome;
    void CloseToWelcome() { returnToWelcome = true; StopCapture(); Close(); }
    public void RestoreWindow() { WindowState = FormWindowState.Normal; Show(); Activate(); }
    protected override void OnHandleCreated(EventArgs e) { base.OnHandleCreated(e); RegisterHotKey(Handle, 41, 1 | 2 | 4, (uint)Keys.Escape); }
    protected override void WndProc(ref Message message) { if (message.Msg == 0x312 && message.WParam == 41) EmergencyStop(); base.WndProc(ref message); }
    void EmergencyStop() { StopCapture(); Post(new { type = "native-stop" }); }
    async Task InitializeAsync()
    {
        try
        {
            var assets = ExtractAssets();
            var profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DeviceBridge", "Remote", "WebProfile");
            var environment = await CoreWebView2Environment.CreateAsync(null, profile, new CoreWebView2EnvironmentOptions("--disable-background-timer-throttling --disable-renderer-backgrounding --autoplay-policy=no-user-gesture-required"));
            await web.EnsureCoreWebView2Async(environment);
            web.CoreWebView2.SetVirtualHostNameToFolderMapping("devicebridge.local", assets, CoreWebView2HostResourceAccessKind.DenyCors);
            web.CoreWebView2.Settings.AreDevToolsEnabled = false; web.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
            web.CoreWebView2.NewWindowRequested += (_, e) => e.Handled = true;
            web.CoreWebView2.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
            web.CoreWebView2.NavigationStarting += (_, e) => { if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out var uri) || uri.GetLeftPart(UriPartial.Authority) != Origin) e.Cancel = true; };
            web.CoreWebView2.ProcessFailed += (_, _) => EmergencyStop();
            web.CoreWebView2.WebMessageReceived += MessageReceived;
            web.CoreWebView2.Navigate(Origin + "/index.html");
        }
        catch (Exception e)
        {
            Controls.Remove(web); web.Dispose();
            Controls.Add(new Label { Dock = DockStyle.Fill, Padding = new Padding(35), Font = new Font("Segoe UI", 13), Text = "Remote preview could not start.\n\nThis preview needs Microsoft Edge WebView2 Runtime. Local sharing remains available from the tray menu.\n\n" + e.Message });
        }
    }
    static string ExtractAssets()
    {
        var assembly = Assembly.GetExecutingAssembly(); var names = assembly.GetManifestResourceNames().Where(n => n.StartsWith("RemoteAssets/")).Order().ToArray();
        if (names.Length < 8) throw new IOException("Remote client assets are missing. Build the client before publishing the Windows app.");
        var files = names.Select(name => { using var stream = assembly.GetManifestResourceStream(name)!; using var memory = new MemoryStream(); stream.CopyTo(memory); return (Name: name["RemoteAssets/".Length..].Replace('\\', '/'), Bytes: memory.ToArray()); }).ToArray();
        var hash = Convert.ToHexString(SHA256.HashData(files.SelectMany(f => f.Bytes).ToArray()));
        var directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DeviceBridge", "Remote", "Assets", hash); Directory.CreateDirectory(directory);
        foreach (var file in files)
        {
            var target = Path.GetFullPath(Path.Combine(directory, file.Name)); if (!target.StartsWith(directory + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new IOException("Invalid client asset.");
            Directory.CreateDirectory(Path.GetDirectoryName(target)!); if (!File.Exists(target) || !File.ReadAllBytes(target).SequenceEqual(file.Bytes)) File.WriteAllBytes(target, file.Bytes);
        }
        return directory;
    }
    void Post(object value) { if (!IsDisposed && web.CoreWebView2 != null) web.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(value)); }
    void MessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        string? rpcId = null;
        try
        {
            if (!Uri.TryCreate(e.Source, UriKind.Absolute, out var source) || source.GetLeftPart(UriPartial.Authority) != Origin || source.AbsolutePath != "/index.html") return;
            if (e.WebMessageAsJson.Length > 3 * 1024 * 1024) throw new IOException("Remote request is too large.");
            using var document = JsonDocument.Parse(e.WebMessageAsJson); var request = document.RootElement; var type = request.GetProperty("type").GetString();
            if (request.TryGetProperty("rpcId", out var id)) rpcId = id.GetString();
            object? result = null;
            switch (type)
            {
                case "identity.get": result = new { publicKey = store.PublicKey }; break;
                case "identity.sign": result = store.Sign(request.GetProperty("purpose").GetString()!, request.GetProperty("value")); break;
                case "identity.verify": result = RemoteProtectedStore.Verify(request.GetProperty("publicKey").GetString()!, request.GetProperty("purpose").GetString()!, request.GetProperty("value"), request.GetProperty("signature").GetString()!); break;
                case "store.get": result = store.Get(request.GetProperty("key").GetString()!); break;
                case "store.set": store.Set(request.GetProperty("key").GetString()!, request.GetProperty("value")); break;
                case "grant.save": store.OwnGrant(request.GetProperty("record").GetProperty("grant").GetProperty("id").GetString()!); break;
                case "capture.start": result = StartCapture(request.GetProperty("grantId").GetString()!); break;
                case "capture.stop": if (Matches(request)) StopCapture(); break;
                case "frame.ack": if (Matches(request) && frameState is { } state) Interlocked.Exchange(ref state.Pending, 0); break;
                case "sound.ack": if (Matches(request) && frameState is { } audioState) { if (Interlocked.Decrement(ref audioState.AudioPending) < 0) Interlocked.Exchange(ref audioState.AudioPending, 0); } break;
                case "mic.format":
                    CheckMicrophone(request); remoteAudio!.Receive(new Packet("mic-format", Text: "pcm", A: request.GetProperty("sampleRate").GetInt32(), B: 16, C: 1), "mic", microphoneDevice); break;
                case "mic.data":
                    CheckMicrophone(request); var encoded = request.GetProperty("data").GetString()!; if (encoded.Length > 16384) throw new IOException("Microphone packet is too large.");
                    var data = Convert.FromBase64String(encoded); if (data.Length % 2 != 0 || data.Length > 8192) throw new IOException("Invalid microphone data."); remoteAudio!.Receive(new Packet("mic", Data: data), "mic", microphoneDevice); Post(new { type = "mic-ack", captureId }); break;
                case "driver.setup":
                    if (designPreview) throw new IOException("Driver setup is disabled in design preview."); EmergencyStop(); using (var setup = new MicrophoneSetupForm()) setup.ShowDialog(this); break;
                case "input.release": if (Matches(request)) input.Release(); break;
                case "input":
                    if (!Matches(request) || !allowInput) throw new IOException("Remote input is not authorized.");
                    if (DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() >= grantExpiresAt) { StopCapture(); throw new IOException("Remote approval expired."); }
                    var command = request.GetProperty("input"); if (command.GetProperty("type").GetString() == "pointer" && command.GetProperty("point").GetProperty("displayId").GetString() != displayId) throw new IOException("Wrong remote display.");
                    input.Apply(command, captureBounds); break;
                default: throw new IOException("Unsupported remote action.");
            }
            if (rpcId != null) Post(new { rpcId, result });
        }
        catch (Exception error) { if (rpcId != null) Post(new { rpcId, error = error.Message }); else Post(new { type = "native-error", message = error.Message }); }
    }
    bool Matches(JsonElement request) => captureId != null && request.TryGetProperty("captureId", out var id) && id.GetString() == captureId;
    void CheckMicrophone(JsonElement request)
    {
        if (!Matches(request) || !allowMicrophone || remoteAudio == null || microphoneDevice < 0) throw new IOException("Phone microphone routing is not permitted or the included driver is not installed.");
        if (DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() >= grantExpiresAt) { StopCapture(); throw new IOException("Remote approval expired."); }
    }
    object StartCapture(string grantId)
    {
        if (designPreview) throw new IOException("Screen sharing is disabled in design preview.");
        var grant = store.OwnGrant(grantId); var permissions = grant.GetProperty("permissions").EnumerateArray().Select(v => v.GetString()).ToArray();
        if (!permissions.Contains("view")) throw new IOException("Screen sharing is not permitted.");
        StopCapture(); captureId = Guid.NewGuid().ToString("N"); allowInput = permissions.Contains("input"); grantExpiresAt = grant.GetProperty("expiresAt").GetInt64();
        captureBounds = Screen.PrimaryScreen?.Bounds ?? throw new IOException("No display is available.");
        int width = Math.Min(1280, captureBounds.Width), height = Math.Max(1, (int)Math.Round(captureBounds.Height * (width / (double)captureBounds.Width)));
        displayId = Guid.NewGuid().ToString("N"); frameState = new FrameState(); var frames = frameState;
        string session = captureId; var bounds = captureBounds; captureStop = new CancellationTokenSource(); var token = captureStop.Token;
        var effective = permissions.Where(p => p != null).Cast<string>().ToList(); var audioErrors = new List<string>(); Packet? soundFormat = null;
        microphoneDevice = permissions.Contains("microphone") ? DriverBundle.CableOutputId() : -2; allowMicrophone = permissions.Contains("microphone") && microphoneDevice >= 0;
        if (permissions.Contains("microphone") && !allowMicrophone) { effective.Remove("microphone"); audioErrors.Add("Install the included microphone driver on this PC to use the phone microphone."); }
        remoteAudio = new AudioBridge(packet =>
        {
            if (packet.Kind == "sound-format") { soundFormat = packet; return true; }
            if (packet.Kind != "sound" || packet.Data == null || token.IsCancellationRequested || captureId != session) return false;
            if (Interlocked.Increment(ref frames.AudioPending) > 8) { Interlocked.Decrement(ref frames.AudioPending); return false; }
            var sound = Convert.ToBase64String(packet.Data);
            try { BeginInvoke(() => { if (captureId == session && !token.IsCancellationRequested) Post(new { type = "sound", captureId = session, data = sound }); }); return true; }
            catch (InvalidOperationException) { Interlocked.Decrement(ref frames.AudioPending); return false; }
        });
        if (permissions.Contains("speaker")) try { remoteAudio.StartCapture(false); } catch (Exception error) { effective.Remove("speaker"); audioErrors.Add("Computer sound: " + error.Message); }
        var expires = grantExpiresAt;
        _ = Task.Run(async () =>
        {
            var encoder = ImageCodecInfo.GetImageEncoders().First(c => c.FormatID == ImageFormat.Jpeg.Guid);
            using var options = new EncoderParameters(1); options.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 65L);
            try
            {
                using var clock = new PeriodicTimer(TimeSpan.FromMilliseconds(83));
                while (await clock.WaitForNextTickAsync(token))
                {
                    if (DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() >= expires) throw new IOException("Remote approval expired.");
                    if (Interlocked.CompareExchange(ref frames.Pending, 1, 0) != 0) continue;
                    using var original = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format24bppRgb); using (var graphics = Graphics.FromImage(original)) graphics.CopyFromScreen(bounds.Location, Point.Empty, bounds.Size);
                    using var scaled = new Bitmap(width, height); using (var graphics = Graphics.FromImage(scaled)) graphics.DrawImage(original, new Rectangle(0, 0, width, height));
                    using var memory = new MemoryStream(); scaled.Save(memory, encoder, options); var jpeg = Convert.ToBase64String(memory.ToArray());
                    if (!token.IsCancellationRequested && !IsDisposed) BeginInvoke(() => { if (captureId == session && !token.IsCancellationRequested) Post(new { type = "frame", captureId = session, jpeg }); });
                }
            }
            catch (OperationCanceledException) { }
            catch (Exception error) { if (!token.IsCancellationRequested && !IsDisposed) try { BeginInvoke(() => { if (captureId == session) { StopCapture(); Post(new { type = "capture-error", message = error.Message }); } }); } catch (InvalidOperationException) { } }
        }, token);
        return new { captureId, width, height, displayId, permissions = effective.ToArray(), soundFormat = soundFormat == null ? null : new { sampleRate = soundFormat.A, bits = soundFormat.B, channels = soundFormat.C, encoding = soundFormat.Text }, audioError = string.Join(" ", audioErrors) };
    }
    void StopCapture() { captureId = null; displayId = null; frameState = null; allowInput = false; allowMicrophone = false; captureStop?.Cancel(); captureStop?.Dispose(); captureStop = null; remoteAudio?.Dispose(); remoteAudio = null; input.Release(); }
    [DllImport("user32.dll")] static extern bool RegisterHotKey(nint window, int id, uint modifiers, uint key);
    [DllImport("user32.dll")] static extern bool UnregisterHotKey(nint window, int id);
}
