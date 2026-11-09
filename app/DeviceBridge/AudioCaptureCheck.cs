using NAudio.Wave;

namespace DeviceBridge;

// Explicit diagnostic command. Samples are measured in memory and never saved.
internal static class AudioCaptureCheck
{
    public static async Task RunAsync()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "audio-capture-check.txt");
        File.WriteAllText(path, "Starting process-loopback capture; no audio is saved.\n");
        using var capture = new ProcessLoopbackCapture();
        int phase = 0; double self = 0, external = 0; long frames = 0;
        capture.DataAvailable += (_, e) =>
        {
            var peak = AudioSignal.Peak(e.Buffer.AsSpan(0, e.BytesRecorded), capture.WaveFormat);
            Interlocked.Add(ref frames, e.BytesRecorded / capture.WaveFormat.BlockAlign);
            if (Volatile.Read(ref phase) == 1) Update(ref self, peak);
            else if (Volatile.Read(ref phase) == 2) Update(ref external, peak);
        };
        capture.StartRecording();
        await capture.Initialized.WaitAsync(TimeSpan.FromSeconds(12));
        Volatile.Write(ref phase, 1);
        await DiagnosticsForm.PlayToneAsync();
        await Task.Delay(250);
        Volatile.Write(ref phase, 2);
        File.AppendAllText(path, "READY_EXTERNAL_TONE\n");
        await Task.Delay(9000);
        capture.StopRecording();
        File.AppendAllText(path, $"Captured sample frames: {Interlocked.Read(ref frames)}\nSelf-process tone peak (expected silence on a quiet PC): {Volatile.Read(ref self):F6}\nOther-process tone peak: {Volatile.Read(ref external):F6}\nFormat: 48000 Hz / PCM16 / stereo\nNo audio samples were saved.\n");
        if (frames == 0 || external < .005) throw new IOException("The external tone was not detected; inspect audio routing and rerun this explicit diagnostic.");
        File.AppendAllText(path, "PASS — other-process audio detected.\n");
    }
    static void Update(ref double target, double next)
    {
        double old;
        do { old = Volatile.Read(ref target); if (next <= old) return; }
        while (Interlocked.CompareExchange(ref target, next, old) != old);
    }
}
