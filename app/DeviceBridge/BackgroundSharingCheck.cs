namespace DeviceBridge;

internal static class BackgroundSharingCheck
{
    public static Task RunAsync()
    {
        var finished = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var thread = new Thread(() =>
        {
            try
            {
                using var root = new QuietForm();
                root.Shown += (_, _) =>
                {
                    try
                    {
                        root.Hide();
                        foreach (bool desk in new[] { true, false })
                        {
                            using var window = new QuietForm();
                            using var tray = new BackgroundSession(window, () => true, () => { }, showIcon:false);
                            int teardown = 0; window.FormClosed += (_, _) => teardown++;
                            window.Show(); window.WindowState = FormWindowState.Minimized;
                            if (window.Visible || window.IsDisposed || teardown != 0) throw new Exception("Minimize did not keep the background session.");
                            // This blocks the UI thread on purpose. Real TLS transport and
                            // ordered delivery must keep working without a window timer.
                            ExerciseTransportAsync(desk).GetAwaiter().GetResult();
                            tray.Restore(activate:false);
                            if (!window.Visible) throw new Exception("Minimized session could not be restored from the tray.");
                            window.Close();
                            if (window.Visible || window.IsDisposed || teardown != 0) throw new Exception("X disposed the background session.");
                            ExerciseTransportAsync(desk).GetAwaiter().GetResult();
                            tray.Restore(activate:false); tray.Quit();
                            if (!window.IsDisposed || teardown != 1) throw new Exception("Explicit exit did not clean up exactly once.");
                        }
                        finished.TrySetResult();
                    }
                    catch (Exception error) { finished.TrySetException(error); }
                    finally { root.Close(); }
                };
                Application.Run(root);
            }
            catch (Exception error) { finished.TrySetException(error); }
        }) { IsBackground=true, Name="DeviceBridge background lifecycle test" };
        thread.SetApartmentState(ApartmentState.STA); thread.Start();
        return finished.Task.WaitAsync(TimeSpan.FromSeconds(30));
    }
    static Task ExerciseTransportAsync(bool desk) => Task.Run(async () =>
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        using var host = new PairingHost("127.0.0.1", listeningPort:0);
        var accepting = host.AcceptAsync();
        using var client = await Connection.JoinAsync(host.Invitation,timeout.Token);
        using var server = await accepting.WaitAsync(timeout.Token);
        var delivered = new List<Packet>();
        var complete = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        using var worker = new SessionWorker(packet =>
        {
            delivered.Add(packet);
            if (delivered.Count == 256) complete.TrySetResult();
        }, error => complete.TrySetException(error));
        server.Received += packet => { if (!worker.TryAdd(packet)) complete.TrySetException(new Exception("Background delivery queue overflowed")); };
        server.Start(); client.Start();
        for (int i=0; i<128; i++)
        {
            if (!client.Send(new Packet("key",A:i)) || !client.Send(new Packet(desk ? "sound" : "mic",A:i,Data:new byte[] {1,2,3,4}))) throw new Exception("Background transport stopped");
            if (i%16==0) await Task.Delay(1);
        }
        await complete.Task.WaitAsync(timeout.Token);
        if (!client.IsConnected || !server.IsConnected || !delivered.Where(p=>p.Kind=="key").Select(p=>p.A).SequenceEqual(Enumerable.Range(0,128)) || delivered.Count(p=>p.Kind==(desk?"sound":"mic"))!=128)
            throw new Exception("Hidden/minimized session lost its connection or input/audio packets");
    });
    sealed class QuietForm : Form
    {
        public QuietForm() { ShowInTaskbar=false; Opacity=0; Width=100; Height=100; }
        protected override bool ShowWithoutActivation => true;
    }
}
