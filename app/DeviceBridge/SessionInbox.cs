namespace DeviceBridge;

public sealed class SessionInbox
{
    readonly object gate = new();
    readonly LinkedList<Packet> packets = new();
    readonly int capacity;
    const int AudioCapacity = 32;
    int controls, audio;
    bool closed;
    public SessionInbox(int capacity = 512) => this.capacity = capacity;
    static bool IsAudio(Packet packet) => packet.Kind is "sound" or "mic";
    public int Count { get { lock (gate) return packets.Count; } }
    public bool TryAdd(Packet packet)
    {
        lock (gate)
        {
            if (closed) return false;
            if (IsAudio(packet))
            {
                if (audio == AudioCapacity)
                {
                    var old = packets.First;
                    while (old != null && !IsAudio(old.Value)) old = old.Next;
                    if (old != null) { packets.Remove(old); audio--; }
                }
                audio++;
            }
            else
            {
                if (controls == capacity) return false;
                controls++;
            }
            packets.AddLast(packet); return true;
        }
    }
    public bool TryTake(out Packet packet)
    {
        lock (gate)
        {
            if (!closed && packets.First is { } first)
            {
                packet = first.Value; packets.RemoveFirst();
                if (IsAudio(packet)) audio--; else controls--;
                return true;
            }
            packet = null!; return false;
        }
    }
    public void Close() { lock (gate) { closed = true; packets.Clear(); controls = audio = 0; } }
}
