namespace DeviceBridge;

// Small local diagnostic log: no keys, addresses, typed text or audio payloads.
internal static class ConnectionLog
{
    static readonly object gate = new();
    public static void Write(string message)
    {
        try
        {
            lock (gate)
            {
                var path = Path.Combine(AppContext.BaseDirectory, "connection-log.txt");
                var lines = File.Exists(path) ? File.ReadAllLines(path).TakeLast(99).ToList() : new List<string>();
                lines.Add(DateTimeOffset.Now.ToString("O") + " " + message.Replace('\r', ' ').Replace('\n', ' '));
                File.WriteAllLines(path, lines);
            }
        }
        catch { }
    }
}
