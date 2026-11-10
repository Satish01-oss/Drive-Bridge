namespace DeviceBridge;

internal sealed class BackgroundSession : IDisposable
{
    readonly Form owner;
    readonly Func<bool> retain;
    readonly NotifyIcon icon;
    bool announced;
    public bool QuitRequested { get; private set; }
    public BackgroundSession(Form owner, Func<bool> retain, Action disconnect, bool showIcon = true)
    {
        this.owner = owner; this.retain = retain;
        var menu = new ContextMenuStrip();
        menu.Items.Add("Open DeviceBridge", null, (_, _) => Restore());
        menu.Items.Add("Disconnect", null, (_, _) => disconnect());
        menu.Items.Add("Disconnect and quit", null, (_, _) => Quit());
        icon = new NotifyIcon { Icon = AppActivation.Icon, Text = "DeviceBridge", ContextMenuStrip = menu, Visible = showIcon };
        icon.DoubleClick += (_, _) => Restore();
        owner.FormClosing += Closing;
        owner.Resize += Resized;
    }
    void Closing(object? sender, FormClosingEventArgs e)
    {
        if (QuitRequested || e.CloseReason != CloseReason.UserClosing || !retain()) return;
        e.Cancel = true; HideToTray();
    }
    void Resized(object? sender, EventArgs e)
    {
        if (!QuitRequested && owner.WindowState == FormWindowState.Minimized && retain()) HideToTray();
    }
    void HideToTray()
    {
        owner.Hide();
        ConnectionLog.Write("Window hidden to tray; sharing retained.");
        if (icon.Visible && !announced) { announced = true; icon.ShowBalloonTip(2500, "DeviceBridge is still running", "Sharing continues. Open DeviceBridge from its tray icon; choose Disconnect and quit to exit.", ToolTipIcon.Info); }
    }
    public void Restore(bool activate = true)
    {
        if (owner.WindowState == FormWindowState.Minimized) owner.WindowState = FormWindowState.Normal;
        owner.Show();
        if (activate) owner.Activate();
    }
    public void Quit() { QuitRequested = true; owner.Close(); }
    public void Dispose() { owner.FormClosing -= Closing; owner.Resize -= Resized; icon.Visible = false; icon.ContextMenuStrip?.Dispose(); icon.Dispose(); }
}
