using System.Runtime.InteropServices;
using NAudio.CoreAudioApi;
using NAudio.CoreAudioApi.Interfaces;
using NAudio.Wave;

namespace DeviceBridge;

// Windows process loopback captures other applications across all render
// endpoints. Excluding this process also excludes the microphone we play into
// VB-CABLE, so it cannot return through the speaker stream as an echo.
public sealed class ProcessLoopbackCapture : IWaveIn
{
    public static bool Supported => OperatingSystem.IsWindowsVersionAtLeast(10, 0, 20348);
    readonly ManualResetEvent stopping = new(false);
    readonly TaskCompletionSource initialized = new(TaskCreationOptions.RunContinuationsAsynchronously);
    Thread? worker;
    int started, disposed;
    public Task Initialized => initialized.Task;
    public WaveFormat WaveFormat
    {
        get => new(48000, 16, 2);
        set { if (value.SampleRate != 48000 || value.BitsPerSample != 16 || value.Channels != 2) throw new NotSupportedException("System audio uses 48 kHz stereo PCM16."); }
    }
    public event EventHandler<WaveInEventArgs>? DataAvailable;
    public event EventHandler<StoppedEventArgs>? RecordingStopped;
    public void StartRecording()
    {
        ObjectDisposedException.ThrowIf(Volatile.Read(ref disposed) != 0, this);
        if (!Supported) throw new NotSupportedException("Process audio capture requires Windows build 20348 or later.");
        if (Interlocked.Exchange(ref started, 1) != 0) throw new InvalidOperationException("This capture has already started.");
        worker = new Thread(Run) { IsBackground = true, Name = "DeviceBridge system audio" };
        worker.SetApartmentState(ApartmentState.MTA); worker.Start();
    }
    void Run()
    {
        Exception? failure = null;
        AudioClient? client = null;
        bool comInitialized = false;
        try
        {
            Marshal.ThrowExceptionForHR(CoInitializeEx(0, 0)); comInitialized = true;
            var completion = new Activation((uint)Environment.ProcessId);
            IActivationOperation? operation = null;
            try
            {
                var iid = typeof(IAudioClient).GUID;
                int hr = ActivateAudioInterfaceAsync("VAD\\Process_Loopback", ref iid, completion.Parameters, completion, out operation);
                if (hr < 0) { completion.ReleaseParameters(); Marshal.ThrowExceptionForHR(hr); }
                // On timeout the callback retains ownership of its native
                // parameters until Windows completes, avoiding use-after-free.
                var raw = completion.Result.Task.WaitAsync(TimeSpan.FromSeconds(10)).GetAwaiter().GetResult();
                client = new AudioClient((IAudioClient)raw);
            }
            finally { if (operation != null && Marshal.IsComObject(operation)) Marshal.ReleaseComObject(operation); }
            using var sampleReady = new AutoResetEvent(false);
            client.Initialize(AudioClientShareMode.Shared,
                AudioClientStreamFlags.Loopback | AudioClientStreamFlags.EventCallback | AudioClientStreamFlags.AutoConvertPcm | AudioClientStreamFlags.SrcDefaultQuality,
                0, 0, WaveFormat, Guid.Empty);
            client.SetEventHandle(sampleReady.SafeWaitHandle.DangerousGetHandle());
            var capture = client.AudioCaptureClient;
            client.Start(); initialized.TrySetResult();
            var waits = new WaitHandle[] { stopping, sampleReady };
            while (WaitHandle.WaitAny(waits, 1000) != 0)
            {
                while (!stopping.WaitOne(0) && capture.GetNextPacketSize() > 0)
                {
                    var pointer = capture.GetBuffer(out int frames, out var flags);
                    try
                    {
                        if (frames < 0 || frames > 48000) throw new IOException("Invalid system-audio buffer size.");
                        var bytes = new byte[checked(frames * WaveFormat.BlockAlign)];
                        if ((flags & AudioClientBufferFlags.Silent) == 0 && bytes.Length != 0) Marshal.Copy(pointer, bytes, 0, bytes.Length);
                        if (bytes.Length != 0) DataAvailable?.Invoke(this, new WaveInEventArgs(bytes, bytes.Length));
                    }
                    finally { capture.ReleaseBuffer(frames); }
                }
            }
        }
        catch (Exception e) { failure = e; initialized.TrySetException(e); }
        finally
        {
            try { client?.Stop(); } catch { }
            try { client?.Dispose(); } catch { }
            try { RecordingStopped?.Invoke(this, new StoppedEventArgs(failure)); } catch { }
            if (Volatile.Read(ref disposed) != 0) stopping.Dispose();
            if (comInitialized) CoUninitialize();
        }
    }
    public void StopRecording() { try { stopping.Set(); } catch (ObjectDisposedException) { } }
    public void Dispose()
    {
        if (Interlocked.Exchange(ref disposed, 1) != 0) return;
        StopRecording();
        // An activation still owned by Windows may finish later. Its background
        // thread owns the wait handle until it exits; never free it underneath it.
        if (worker == null || (Thread.CurrentThread != worker && worker.Join(1500))) stopping.Dispose();
    }

    [StructLayout(LayoutKind.Sequential)] struct ActivationParameters { public int Type; public uint ProcessId; public int Mode; }
    [StructLayout(LayoutKind.Sequential)] struct Blob { public int Size; public nint Data; }
    [StructLayout(LayoutKind.Sequential)] struct Variant { public ushort Type, Reserved1, Reserved2, Reserved3; public Blob Blob; }
    [ComVisible(true), Guid("41D949AB-9862-444A-80F6-C261334DA5EB"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IActivationCompletion { [PreserveSig] int ActivateCompleted(IActivationOperation operation); }
    [ComImport, Guid("72A22D78-CDE4-431D-B8CC-843A71199B6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IActivationOperation { [PreserveSig] int GetActivateResult(out int result, [MarshalAs(UnmanagedType.IUnknown)] out object audioInterface); }
    [ComVisible(true), Guid("94EA2B94-E9CC-49E0-C0FF-EE64CA8F5B90"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] public interface IAgile { }
    [ComVisible(true), ClassInterface(ClassInterfaceType.None)]
    public sealed class Activation : IActivationCompletion, IAgile
    {
        nint data, parameters;
        public nint Parameters => parameters;
        public TaskCompletionSource<object> Result { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public Activation(uint process)
        {
            data = Marshal.AllocHGlobal(Marshal.SizeOf<ActivationParameters>());
            Marshal.StructureToPtr(new ActivationParameters { Type = 1, ProcessId = process, Mode = 1 }, data, false);
            parameters = Marshal.AllocHGlobal(Marshal.SizeOf<Variant>());
            Marshal.StructureToPtr(new Variant { Type = 65, Blob = new Blob { Size = Marshal.SizeOf<ActivationParameters>(), Data = data } }, parameters, false);
        }
        public int ActivateCompleted(IActivationOperation operation)
        {
            try
            {
                Marshal.ThrowExceptionForHR(operation.GetActivateResult(out int hr, out object audio));
                Marshal.ThrowExceptionForHR(hr); Result.TrySetResult(audio);
            }
            catch (Exception e) { Result.TrySetException(e); }
            finally { ReleaseParameters(); }
            return 0;
        }
        public void ReleaseParameters()
        {
            var old = Interlocked.Exchange(ref parameters, 0); if (old != 0) Marshal.FreeHGlobal(old);
            old = Interlocked.Exchange(ref data, 0); if (old != 0) Marshal.FreeHGlobal(old);
        }
    }
    [DllImport("Mmdevapi.dll", ExactSpelling = true, CharSet = CharSet.Unicode)]
    static extern int ActivateAudioInterfaceAsync(string path, ref Guid iid, nint parameters, IActivationCompletion completion, out IActivationOperation operation);
    [DllImport("ole32.dll")] static extern int CoInitializeEx(nint reserved, uint flags);
    [DllImport("ole32.dll")] static extern void CoUninitialize();
}
