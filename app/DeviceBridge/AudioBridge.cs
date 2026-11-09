using NAudio.Wave;
using NAudio.CoreAudioApi;

namespace DeviceBridge;

public sealed class AudioBridge : IDisposable
{
    readonly object gate = new();
    readonly object captureGate = new();
    readonly Func<Packet, bool> send;
    readonly Func<bool, IWaveIn> captureFactory;
    IWaveIn? capture;
    WaveOutEvent? playback;
    BufferedWaveProvider? buffer;
    string? receiving;
    long captureGeneration, lastAudioAt;
    long playbackGeneration;
    double incomingPeak;
    string lastError = "None";
    string captureDescription = "Off", playbackFormat = "Not started";
    long sentPackets, sentBytes, receivedPackets, bufferedPackets, lastCapturedAt;
    double outgoingPeak;
    public string LastError => Volatile.Read(ref lastError);
    public double OutgoingPeak => Environment.TickCount64 - Interlocked.Read(ref lastCapturedAt) < 300 ? Volatile.Read(ref outgoingPeak) : 0;
    public string Diagnostics => $"Audio capture: {Volatile.Read(ref captureDescription)}\nCaptured packets / bytes sent: {Interlocked.Read(ref sentPackets)} / {Interlocked.Read(ref sentBytes)}\nReceived / buffered audio packets: {Interlocked.Read(ref receivedPackets)} / {Interlocked.Read(ref bufferedPackets)}\nPlayback stream: {Volatile.Read(ref receiving) ?? "Off"}\nPlayback format: {Volatile.Read(ref playbackFormat)}\nLast audio error: {LastError}";
    public double IncomingPeak => Environment.TickCount64 - Interlocked.Read(ref lastAudioAt) < 300 ? Volatile.Read(ref incomingPeak) : 0;
    public event Action<string>? Failed;
    public event Action<string>? PlaybackFailed;
    public AudioBridge(Func<Packet, bool> send, Func<bool, IWaveIn>? captureFactory = null) { this.send = send; this.captureFactory = captureFactory ?? (microphone => CreateCapture(microphone)); }
    public void StartCapture(bool microphone)
    {
        StopCapture();
        string kind = microphone ? "mic" : "sound";
        try
        {
            capture = captureFactory(microphone);
            Volatile.Write(ref lastError, "None");
            Volatile.Write(ref captureDescription, (microphone ? "Microphone: " : "System sound: ") + capture.GetType().Name);
            var epoch = Interlocked.Increment(ref captureGeneration);
            var format = capture.WaveFormat;
            bool floating = format.Encoding == WaveFormatEncoding.IeeeFloat ||
                (format is WaveFormatExtensible ext && ext.SubFormat == new Guid("00000003-0000-0010-8000-00aa00389b71"));
            if (!floating && format.Encoding != WaveFormatEncoding.Pcm &&
                !(format is WaveFormatExtensible pcm && pcm.SubFormat == new Guid("00000001-0000-0010-8000-00aa00389b71")))
                throw new NotSupportedException("This audio device uses an unsupported format.");
            send(new Packet(kind + "-format", Text: floating ? "float" : "pcm", A: format.SampleRate, B: format.BitsPerSample, C: format.Channels));
            capture.DataAvailable += (_, e) =>
            {
                lock (captureGate)
                {
                if (Interlocked.Read(ref captureGeneration) != epoch) return;
                Volatile.Write(ref outgoingPeak, AudioSignal.Peak(e.Buffer.AsSpan(0, e.BytesRecorded), format));
                Interlocked.Exchange(ref lastCapturedAt, Environment.TickCount64);
                int chunk = Math.Max(format.BlockAlign, 48000 / format.BlockAlign * format.BlockAlign);
                for (int offset = 0; offset < e.BytesRecorded; offset += chunk)
                {
                    var bytes = e.Buffer.AsSpan(offset, Math.Min(chunk, e.BytesRecorded - offset)).ToArray();
                    if (!send(new Packet(kind, Data: bytes))) break;
                    Interlocked.Increment(ref sentPackets); Interlocked.Add(ref sentBytes, bytes.Length);
                }
                }
            };
            capture.RecordingStopped += (_, e) => { if (e.Exception != null && Interlocked.Read(ref captureGeneration) == epoch) { Volatile.Write(ref lastError, e.Exception.Message); ConnectionLog.Write("Audio capture stopped: " + e.Exception.GetType().Name); Failed?.Invoke(e.Exception.Message); } };
            capture.StartRecording();
        }
        catch (Exception e) { Volatile.Write(ref lastError, e.Message); StopCapture(); send(new Packet(kind + "-stop")); throw; }
    }
    internal static IWaveIn CreateCapture(bool microphone, string? microphoneId = null)
    {
        if (!microphone && ProcessLoopbackCapture.Supported) return new ProcessLoopbackCapture();
        using var devices = new MMDeviceEnumerator();
        var flow = microphone ? DataFlow.Capture : DataFlow.Render;
        var device = microphone && microphoneId != null ? devices.GetDevice(microphoneId) : devices.GetDefaultAudioEndpoint(flow, microphone ? Role.Communications : Role.Multimedia);
        if (device.State != DeviceState.Active || device.DataFlow != flow) { device.Dispose(); throw new InvalidOperationException("The selected microphone is unavailable. Choose another microphone in DeviceBridge."); }
        // Installing a virtual cable can change Windows defaults. Do not capture
        // our own received microphone as a microphone source or system sound.
        if (device.FriendlyName.Contains("VB-Audio", StringComparison.OrdinalIgnoreCase))
        {
            device.Dispose();
            device = devices.EnumerateAudioEndPoints(flow, DeviceState.Active).FirstOrDefault(d => !d.FriendlyName.Contains("VB-Audio", StringComparison.OrdinalIgnoreCase))
                ?? throw new InvalidOperationException("Choose a physical microphone or speaker in Windows Sound, then try again.");
        }
        return microphone ? new WasapiCapture(device) : new WasapiLoopbackCapture(device);
    }
    public static List<MicrophoneChoice> Microphones()
    {
        var result = new List<MicrophoneChoice> { new(null, "Windows default microphone") };
        try
        {
            using var devices = new MMDeviceEnumerator();
            foreach (var device in devices.EnumerateAudioEndPoints(DataFlow.Capture, DeviceState.Active))
            {
                using (device) if (!device.FriendlyName.Contains("VB-Audio", StringComparison.OrdinalIgnoreCase)) result.Add(new(device.ID, device.FriendlyName));
            }
        }
        catch { }
        return result;
    }
    public void Receive(Packet p, string kind, int device)
    {
        lock (gate)
        {
            if (p.Kind == kind && p.Data != null) Interlocked.Increment(ref receivedPackets);
            if (p.Kind == kind + "-stop") { StopPlaybackUnsafe(); return; }
            if (p.Kind == kind + "-format")
            {
                StopPlaybackUnsafe();
                if (p.A is < 8000 or > 192000 || p.C is < 1 or > 8 || p.B is not (8 or 16 or 24 or 32) || p.Text is not ("pcm" or "float") || (p.Text == "float" && p.B != 32))
                    throw new IOException("Unsupported audio format.");
                var format = p.Text == "float" ? WaveFormat.CreateIeeeFloatWaveFormat(p.A, p.C) : new WaveFormat(p.A, p.B, p.C);
                Volatile.Write(ref playbackFormat, format.ToString());
                buffer = new BufferedWaveProvider(format) { BufferDuration = TimeSpan.FromMilliseconds(250), DiscardOnBufferOverflow = true, ReadFully = true };
                playback = new WaveOutEvent { DeviceNumber = device, DesiredLatency = 80 };
                var playbackEpoch = Interlocked.Read(ref playbackGeneration);
                playback.PlaybackStopped += (_, e) =>
                {
                    if (e.Exception != null && playbackEpoch == Interlocked.Read(ref playbackGeneration))
                    { Volatile.Write(ref lastError, e.Exception.Message); PlaybackFailed?.Invoke(e.Exception.Message); }
                };
                playback.Init(buffer); playback.Play(); receiving = kind;
            }
            else if (p.Kind == kind && p.Data != null && buffer != null && receiving == kind)
            {
                if (p.Data.Length % buffer.WaveFormat.BlockAlign != 0) throw new IOException("Invalid audio sample boundary.");
                if (buffer.BufferedDuration.TotalMilliseconds > 160) buffer.ClearBuffer();
                buffer.AddSamples(p.Data, 0, p.Data.Length);
                Interlocked.Increment(ref bufferedPackets);
                Volatile.Write(ref incomingPeak, AudioSignal.Peak(p.Data, buffer.WaveFormat));
                Interlocked.Exchange(ref lastAudioAt, Environment.TickCount64);
            }
        }
    }
    public void StopCapture()
    {
        IWaveIn? old;
        lock (captureGate) { Interlocked.Increment(ref captureGeneration); old = capture; capture = null; }
        Volatile.Write(ref captureDescription, "Off"); Volatile.Write(ref outgoingPeak, 0); Interlocked.Exchange(ref lastCapturedAt, 0);
        if (old != null)
        {
            try { old.StopRecording(); } catch (Exception e) { Volatile.Write(ref lastError, e.Message); }
            try { old.Dispose(); } catch (Exception e) { Volatile.Write(ref lastError, e.Message); }
        }
    }
    void StopPlaybackUnsafe()
    {
        Interlocked.Increment(ref playbackGeneration);
        try { playback?.Stop(); } catch (Exception e) { Volatile.Write(ref lastError, e.Message); }
        try { playback?.Dispose(); } catch (Exception e) { Volatile.Write(ref lastError, e.Message); }
        playback = null; buffer = null; receiving = null; Volatile.Write(ref incomingPeak, 0); Interlocked.Exchange(ref lastAudioAt, 0);
    }
    public void StopPlayback() { lock (gate) StopPlaybackUnsafe(); }
    public void PlaybackError(Exception error) { StopPlayback(); Volatile.Write(ref lastError, error.Message); ConnectionLog.Write("Audio playback stopped: " + error.GetType().Name); }
    public void Dispose() { StopCapture(); StopPlayback(); }
    public static List<(int Id, string Name)> Outputs()
    {
        var list = new List<(int, string)> { (-1, "Windows default playback device") };
        for (int i = 0; i < WaveOut.DeviceCount; i++)
        {
            try { list.Add((i, WaveOut.GetCapabilities(i).ProductName)); }
            catch { /* A disappearing audio endpoint must not prevent input sharing. */ }
        }
        return list;
    }
}
