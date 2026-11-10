namespace DeviceBridge;

// Sharing has its own lifetime and thread. The visible window only displays status;
// minimizing, hiding, resizing or pausing its message pump cannot stop packet delivery.
internal sealed class SessionWorker : IDisposable
{
    readonly SessionInbox inbox = new();
    readonly AutoResetEvent wake = new(false);
    readonly Thread thread;
    readonly Action<Packet> deliver;
    readonly Action<Exception> failed;
    int closed;
    public int Count => inbox.Count;
    public SessionWorker(Action<Packet> deliver, Action<Exception> failed)
    {
        this.deliver = deliver; this.failed = failed;
        thread = new Thread(Run) { IsBackground = true, Name = "DeviceBridge background sharing" };
        thread.SetApartmentState(ApartmentState.STA); thread.Start();
    }
    public bool TryAdd(Packet packet)
    {
        if (Volatile.Read(ref closed) != 0 || !inbox.TryAdd(packet)) return false;
        try { wake.Set(); return true; } catch (ObjectDisposedException) { return false; }
    }
    void Run()
    {
        try
        {
            while (Volatile.Read(ref closed) == 0)
            {
                while (Volatile.Read(ref closed) == 0 && inbox.TryTake(out var packet)) deliver(packet);
                if (Volatile.Read(ref closed) == 0) wake.WaitOne();
            }
        }
        catch (Exception error) { if (Volatile.Read(ref closed) == 0) failed(error); }
        finally { inbox.Close(); wake.Dispose(); }
    }
    public void Dispose()
    {
        if (Interlocked.Exchange(ref closed, 1) != 0) return;
        inbox.Close();
        try { wake.Set(); } catch (ObjectDisposedException) { }
        if (Thread.CurrentThread != thread) thread.Join();
    }
}
