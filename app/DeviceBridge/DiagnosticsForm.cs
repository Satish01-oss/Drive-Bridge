using System.Buffers.Binary;
using System.Net.NetworkInformation;
using System.Reflection;
using System.Text;
using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace DeviceBridge;

public static class AudioSignal
{
    public static Packet SpeakerTestPacket()
    {
        var bytes = new byte[48000 * 4 / 2];
        for (int frame = 0; frame < bytes.Length / 4; frame++)
        {
            short value = (short)(Math.Sin(2 * Math.PI * 660 * frame / 48000) * 2400);
            BinaryPrimitives.WriteInt16LittleEndian(bytes.AsSpan(frame * 4), value);
            BinaryPrimitives.WriteInt16LittleEndian(bytes.AsSpan(frame * 4 + 2), value);
        }
        return new Packet("speaker-test", A: 48000, B: 16, C: 2, Data: bytes);
    }
    public static double Peak(ReadOnlySpan<byte> data, WaveFormat format)
    {
        bool floating = format.Encoding == WaveFormatEncoding.IeeeFloat ||
            (format is WaveFormatExtensible ext && ext.SubFormat == new Guid("00000003-0000-0010-8000-00aa00389b71"));
        int size = format.BitsPerSample / 8;
        if (size is < 1 or > 4 || (floating && size != 4)) return 0;
        double peak = 0;
        for (int i = 0; i + size <= data.Length; i += size)
        {
            double sample = floating ? BitConverter.Int32BitsToSingle(BinaryPrimitives.ReadInt32LittleEndian(data[i..])) : size switch
            {
                1 => (data[i] - 128) / 128.0,
                2 => BinaryPrimitives.ReadInt16LittleEndian(data[i..]) / 32768.0,
                3 => ((data[i] | data[i + 1] << 8 | data[i + 2] << 16) << 8 >> 8) / 8388608.0,
                4 => BinaryPrimitives.ReadInt32LittleEndian(data[i..]) / 2147483648.0,
                _ => 0
            };
            if (double.IsFinite(sample)) peak = Math.Max(peak, Math.Abs(sample));
        }
        return Math.Clamp(peak, 0, 1);
    }
}

public sealed class DiagnosticsForm : Form
{
    readonly Func<string> session;
    readonly Func<double> incomingPeak;
    readonly RichTextBox report = new() { ReadOnly = true, Dock = DockStyle.Fill, BackColor = Color.White, Font = new Font("Consolas", 9) };
    readonly ProgressBar localLevel = new() { Width = 590, Height = 18 }, remoteLevel = new() { Width = 590, Height = 18 };
    readonly Label note = new() { AutoSize = true, MaximumSize = new Size(590, 0) };
    readonly Button microphone = new() { Text = "Check microphone for 8 seconds", AutoSize = true };
    readonly System.Windows.Forms.Timer refresh = new() { Interval = 100 };
    readonly CancellationTokenSource closing = new();
    IWaveIn? meter;
    double micPeak;
    string environment;
    int keyEvents, clicks;
    string speakerResult = "Not checked", microphoneResult = "Not checked";

    public DiagnosticsForm(Func<string>? session = null, Func<double>? incomingPeak = null, Action? sharedSpeakerProbe = null)
    {
        this.session = session ?? (() => "No active session. Open Check my setup from a connected session to inspect traffic.");
        this.incomingPeak = incomingPeak ?? (() => 0);
        Text = "DeviceBridge · Check my setup"; ClientSize = new Size(670, 760); MinimumSize = new Size(680, 780); Font = new Font("Segoe UI", 10);
        StartPosition = FormStartPosition.CenterParent;
        var root = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(20), ColumnCount = 1, RowCount = 3 };
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 330)); root.RowStyles.Add(new RowStyle(SizeType.Percent, 100)); root.RowStyles.Add(new RowStyle(SizeType.Absolute, 44));
        var checks = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, WrapContents = false, AutoScroll = true };
        checks.Controls.Add(new Label { Text = "Check your devices — then test them across both PCs", AutoSize = true, Font = new Font("Segoe UI", 13, FontStyle.Bold) });
        var sound = new Button { Text = "Play a short speaker test here", AutoSize = true };
        sound.Click += async (_, _) => { sound.Enabled = false; speakerResult = await PlayToneAsync() ? "Test tone played; human hearing confirmation required" : "Could not play test tone"; note.Text = speakerResult; sound.Enabled = true; };
        checks.Controls.Add(sound); checks.Controls.Add(microphone);
        microphone.Click += async (_, _) => await CheckMicrophone();
        checks.Controls.Add(new Label { Text = "This PC's microphone level (never saved)", AutoSize = true }); checks.Controls.Add(localLevel);
        checks.Controls.Add(new Label { Text = "Incoming audio level (speak/play sound on the other PC)", AutoSize = true }); checks.Controls.Add(remoteLevel);
        if (sharedSpeakerProbe != null)
        {
            var probe = new Button { Text = "Ask other PC to send a headphone test", AutoSize = true };
            probe.Click += (_, _) => { sharedSpeakerProbe(); note.Text = "The other PC sends test audio. Listen here to check network and headphone playback. Then play audio in another app on the other PC to check system capture."; }; checks.Controls.Add(probe);
        }
        var typing = new TextBox { Width = 590, PlaceholderText = "On the other PC: click here, then type using the shared keyboard" };
        typing.KeyDown += (_, _) => keyEvents++;
        var mouse = new Button { Text = "Click here using the shared mouse", AutoSize = true };
        mouse.Click += (_, _) => { clicks++; mouse.Text = $"Shared mouse clicks seen here: {clicks}"; };
        checks.Controls.Add(typing); checks.Controls.Add(mouse); checks.Controls.Add(note);
        root.Controls.Add(checks); root.Controls.Add(report);
        var actions = new FlowLayoutPanel { Dock = DockStyle.Fill };
        var copy = new Button { Text = "Copy report", AutoSize = true }; copy.Click += (_, _) => { Clipboard.SetText(BuildReport()); note.Text = "Report copied. It contains counts and device names, not typed text, audio, pairing keys, or passwords."; };
        var rescan = new Button { Text = "Refresh device check", AutoSize = true }; rescan.Click += (_, _) => environment = EnvironmentReport();
        actions.Controls.Add(copy); actions.Controls.Add(rescan); root.Controls.Add(actions); Controls.Add(root);
        environment = EnvironmentReport();
        refresh.Tick += (_, _) => { localLevel.Value = Math.Clamp((int)(Volatile.Read(ref micPeak) * 100), 0, 100); remoteLevel.Value = Math.Clamp((int)(this.incomingPeak() * 100), 0, 100); report.Text = BuildReport(); };
        refresh.Start();
        FormClosing += (_, _) => { closing.Cancel(); StopMeter(); refresh.Stop(); refresh.Dispose(); };
    }
    string BuildReport() => environment + "\n" + session() + $"\nLocal speaker check: {speakerResult}\nLocal microphone check: {microphoneResult}\nKeys seen in test box (count only): {keyEvents}\nTest button clicks: {clicks}\nPhysical two-PC result: must be confirmed by the person doing the test.\nNo keystrokes or audio content is included in this report.";
    public static string EnvironmentReport()
    {
        var text = new StringBuilder();
        text.AppendLine("DeviceBridge setup report").AppendLine("Build: " + Assembly.GetExecutingAssembly().GetName().Version)
            .AppendLine("Windows: " + Environment.OSVersion.Version).AppendLine("Runtime: " + Environment.Version)
            .AppendLine("Process: " + System.Runtime.InteropServices.RuntimeInformation.ProcessArchitecture)
            .AppendLine("Private IPv4 addresses available: " + Invitation.Addresses().Count)
            .AppendLine("Active local adapters: " + string.Join(", ", NetworkSetup.Adapters().Select(n => n.Kind)))
            .AppendLine("Windows network profiles: " + NetworkSetup.Profiles())
            .AppendLine("Wi-Fi plus Ethernet on the same LAN: supported");
        try
        {
            using var devices = new MMDeviceEnumerator();
            foreach (var flow in new[] { DataFlow.Render, DataFlow.Capture })
            {
                try { using var current = devices.GetDefaultAudioEndpoint(flow, Role.Multimedia); text.AppendLine("Default " + flow + ": " + current.FriendlyName); } catch { }
                var endpoints = devices.EnumerateAudioEndPoints(flow, DeviceState.Active);
                text.AppendLine(flow + " endpoints: " + endpoints.Count);
                foreach (var device in endpoints) { text.AppendLine("  " + device.FriendlyName); device.Dispose(); }
            }
            text.AppendLine("VB-CABLE playback found: " + (DriverBundle.CableOutputId() != -2));
            text.AppendLine("Process-isolated system audio capture supported: " + ProcessLoopbackCapture.Supported);
        }
        catch (Exception e) { text.AppendLine("Audio inventory failed: " + e.Message); }
        return text.ToString();
    }
    async Task CheckMicrophone()
    {
        microphone.Enabled = false; microphoneResult = "Listening for 8 seconds (level only)";
        try
        {
            meter = AudioBridge.CreateCapture(true); var format = meter.WaveFormat;
            double maximum = 0;
            meter.DataAvailable += (_, e) => { var peak = AudioSignal.Peak(e.Buffer.AsSpan(0, e.BytesRecorded), format); Volatile.Write(ref micPeak, peak); double current; do { current = Volatile.Read(ref maximum); if (current >= peak) break; } while (Interlocked.CompareExchange(ref maximum, peak, current) != current); };
            meter.StartRecording(); note.Text = "Speak normally for 8 seconds. Only the moving level is measured; nothing is recorded to a file.";
            await Task.Delay(TimeSpan.FromSeconds(8), closing.Token);
            microphoneResult = Volatile.Read(ref maximum) > .005 ? "Signal detected; cross-PC route still needs checking" : "No clear signal detected; check microphone/mute/Windows permission";
            note.Text = microphoneResult;
        }
        catch (OperationCanceledException) { }
        catch (Exception e) { microphoneResult = "Could not open microphone: " + e.Message; note.Text = microphoneResult; }
        finally { StopMeter(); if (!IsDisposed) microphone.Enabled = true; }
    }
    void StopMeter() { var old = meter; meter = null; if (old != null) { old.StopRecording(); old.Dispose(); } Volatile.Write(ref micPeak, 0); }
    public static async Task<bool> PlayToneAsync(int output = -1)
    {
        try
        {
            var format = new WaveFormat(48000, 16, 1); var bytes = new byte[48000 * 2 / 2];
            for (int i = 0; i < bytes.Length / 2; i++) BinaryPrimitives.WriteInt16LittleEndian(bytes.AsSpan(i * 2), (short)(Math.Sin(2 * Math.PI * 660 * i / 48000) * 2400));
            using var memory = new MemoryStream(bytes); using var source = new RawSourceWaveStream(memory, format); using var player = new WaveOutEvent { DeviceNumber = output };
            player.Init(source); player.Play(); await Task.Delay(750); return true;
        }
        catch { return false; }
    }
    public static async Task<bool> PlayReceivedTestAsync(Packet packet, int output)
    {
        if (packet.A != 48000 || packet.B != 16 || packet.C != 2 || packet.Data?.Length != 96000) return false;
        try
        {
            using var memory = new MemoryStream(packet.Data); using var source = new RawSourceWaveStream(memory, new WaveFormat(48000, 16, 2));
            using var player = new WaveOutEvent { DeviceNumber = output };
            player.Init(source); player.Play(); await Task.Delay(750); return true;
        }
        catch { return false; }
    }
}
