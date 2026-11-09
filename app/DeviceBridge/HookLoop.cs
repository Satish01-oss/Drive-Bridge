namespace DeviceBridge;

// Low-level Windows hooks need a pumping thread that does not wait for UI work,
// certificate generation, audio initialization, or setup dialogs.
internal sealed class HookLoop : IDisposable
{
    readonly Thread thread;
    readonly Control dispatcher;
    int disposed;
    public HookLoop()
    {
        var ready = new TaskCompletionSource<Control>(TaskCreationOptions.RunContinuationsAsynchronously);
        thread = new Thread(() =>
        {
            try
            {
                using var control = new Control(); _ = control.Handle; ready.TrySetResult(control); Application.Run();
            }
            catch (Exception e) { ready.TrySetException(e); }
        }) { IsBackground = true, Name = "DeviceBridge input hooks" };
        thread.SetApartmentState(ApartmentState.STA); thread.Start(); dispatcher = ready.Task.GetAwaiter().GetResult();
    }
    public void Invoke(Action action)
    {
        if (Volatile.Read(ref disposed) != 0) return;
        if (dispatcher.InvokeRequired) dispatcher.Invoke(action); else action();
    }
    public void Dispose()
    {
        if (Interlocked.Exchange(ref disposed, 1) != 0) return;
        if (!dispatcher.IsDisposed) dispatcher.BeginInvoke(() => Application.ExitThread());
        if (Thread.CurrentThread != thread) thread.Join(1500);
    }
}
