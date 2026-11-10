namespace DeviceBridge;

internal static class Program
{
    [STAThread]
    static void Main(string[] args)
    {
        if (args.Contains("--audio-capture-check"))
        {
            try { AudioCaptureCheck.RunAsync().GetAwaiter().GetResult(); Environment.Exit(0); }
            catch (Exception e) { File.AppendAllText(Path.Combine(AppContext.BaseDirectory, "audio-capture-check.txt"), e + "\n"); Environment.Exit(1); }
            return;
        }
        if (args.Length == 2 && args[0] == "--allow-private-lan")
        {
            Environment.Exit(int.TryParse(args[1], out var adapter) ? NetworkSetup.RunElevated(adapter) : 1); return;
        }
        if (args.Contains("--self-test"))
        {
            try { SelfTest.RunAsync().GetAwaiter().GetResult(); Environment.Exit(0); }
            catch (Exception e) { File.WriteAllText(Path.Combine(AppContext.BaseDirectory, "self-test-result.txt"), e.ToString()); Environment.Exit(1); }
            return;
        }
        ApplicationConfiguration.Initialize();
        if (args.Contains("--remote-preview")) { Application.Run(new RemoteHostForm(designPreview: true)); return; }
        if (args.Contains("--ui-preview")) { if(args.Contains("--welcome")) Application.Run(new WelcomeForm(designPreview:true)); else Application.Run(new MainForm(args.Contains("--desk"), designPreview:true)); return; }
        using var instance = new Mutex(true, "Local\\DeviceBridge.Desktop.v1", out bool firstInstance);
        if (!firstInstance && !args.Contains("--inventory"))
        {
            if (!AppActivation.RaiseExisting()) MessageBox.Show("An older DeviceBridge copy is already running. Close its session and welcome windows, then open this update. New versions can be reopened from the system tray.", "DeviceBridge", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }
        if (args.Contains("--remote")) Application.Run(new RemoteHostForm());
        else if (args.Contains("--diagnostics")) Application.Run(new DiagnosticsForm());
        else if (args.Contains("--inventory")) File.WriteAllText(Path.Combine(AppContext.BaseDirectory, "setup-report.txt"), DiagnosticsForm.EnvironmentReport());
        else Application.Run(new WelcomeForm());
    }
}
