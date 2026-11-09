namespace DeviceBridge;

public sealed class WelcomeForm : Form
{
    readonly Button saved;
    MainForm? activeSession;
    public WelcomeForm()
    {
        Text = AppActivation.Title; ClientSize = new Size(640, 570); MinimumSize = new Size(640, 600);
        Font = new Font("Segoe UI", 11); BackColor = Color.FromArgb(245, 247, 249); StartPosition = FormStartPosition.CenterScreen;
        var content = new FlowLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(32), FlowDirection = FlowDirection.TopDown, WrapContents = false, AutoScroll = true };
        content.Controls.Add(new Label { Text = "One desk. Two PCs.", Font = new Font("Segoe UI", 26, FontStyle.Bold), AutoSize = true });
        content.Controls.Add(new Label { Text = "Open DeviceBridge on both PCs, on the same local network (Wi-Fi or Ethernet).\nWhat would you like to do on this PC?", AutoSize = true, Margin = new Padding(3, 8, 3, 24) });
        var desk = Choice("Use this PC's keyboard, mouse, speakers and mic", "Share with the PC you pair. You can switch the microphone off anytime.");
        var remote = Choice("Connect this PC to those devices", "Choose this on the other PC. You will paste a connection key.");
        content.Controls.Add(desk); content.Controls.Add(remote);
        saved = new Button { Text = "Reconnect my saved PC", Width = 550, Height = 44, Margin = new Padding(3, 15, 3, 8), FlatStyle = FlatStyle.Flat };
        content.Controls.Add(saved);
        content.Controls.Add(new Label { Text = "The desk PC shares its microphone after pairing or reconnecting. You can turn it off in the connected window.", AutoSize = true, MaximumSize = new Size(540, 0), ForeColor = Color.DimGray });
        var checks = new Button { Text = "Check my setup", Width = 550, Height = 35, FlatStyle = FlatStyle.Flat };
        checks.Click += (_, _) => { using var test = new DiagnosticsForm(); test.ShowDialog(this); }; content.Controls.Add(checks);
        var help = new LinkLabel { Text = "Need a hand? Read the simple guide", AutoSize = true, Margin = new Padding(3, 8, 3, 0) }; content.Controls.Add(help);
        content.Controls.Add(new Label { Text = "Windows app · No account · Microphone driver included", AutoSize = true, ForeColor = Color.DimGray, Margin = new Padding(3, 18, 3, 0) });
        Controls.Add(content);
        desk.Click += (_, _) => Open(true, false); remote.Click += (_, _) => Open(false, false);
        saved.Click += (_, _) => { var peer = TrustedPeer.Load(); if (peer != null) Open(peer.Desk, true); };
        help.LinkClicked += (_, _) => { using var guide = new HelpForm(); guide.ShowDialog(this); };
        Activated += (_, _) => saved.Enabled = TrustedPeer.Load() != null;
    }
    static Button Choice(string title, string description) => new() { Text = title + "\n" + description, TextAlign = ContentAlignment.MiddleLeft, Width = 550, Height = 84, Padding = new Padding(14), BackColor = Color.White, FlatStyle = FlatStyle.Flat, Margin = new Padding(3, 3, 3, 10), Cursor = Cursors.Hand };
    protected override void WndProc(ref Message message)
    {
        if ((uint)message.Msg == AppActivation.RestoreMessage)
        {
            if (activeSession != null && !activeSession.IsDisposed) activeSession.RestoreWindow();
            else { Show(); if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal; Activate(); }
            return;
        }
        base.WndProc(ref message);
    }
    void Open(bool desk, bool reconnect)
    {
        Hide();
        try
        {
            var session = activeSession = new MainForm(desk, reconnect);
            session.FormClosed += (_, _) =>
            {
                activeSession = null;
                if (session.QuitRequested) Close();
                else { Show(); saved.Enabled = TrustedPeer.Load() != null; }
                session.Dispose();
            };
            session.Show();
        }
        catch { Show(); throw; }
    }
}

public sealed class HelpForm : Form
{
    public HelpForm()
    {
        Text = "DeviceBridge · Help"; ClientSize = new Size(700, 610); Font = new Font("Segoe UI", 11);
        var tabs = new TabControl { Dock = DockStyle.Fill };
        var guide = new TabPage("Simple guide");
        guide.Controls.Add(TextPanel("GET CONNECTED\n\n1. Open the same app on both PCs. Connect them to the same local network (Wi-Fi or Ethernet).\n\n2. On the PC with your keyboard, mouse and speakers, choose the first option. Copy the key that appears.\n\n3. On the other PC, choose the second option. Enter the six-character key and click Connect & allow. This is the approval button; no separate Allow popup is needed. Connecting allows the first PC to control this PC and hear its sound.\n\n4. On the first PC, choose where the other screen sits. Move the mouse across that edge to switch; the keyboard follows automatically. Move back across the joining edge to return. F8 is optional. Sound and the desk microphone start when you connect; you can switch either off.\n\nNEXT TIME\n\nChoose Reconnect my saved PC on the first PC, then on the other PC.\n\nSTOP AT ANY TIME\n\nPress F8 to bring the keyboard and mouse back here. Press Ctrl+Alt+Pause on either PC to disconnect everything. X keeps sharing in the system tray. Choose Disconnect and quit from the tray menu to exit. Minimize and maximize do not stop sharing.\n\nIF IT DOES NOT CONNECT\n\nCheck the Wi-Fi on both PCs. If Windows asks about network access, allow DeviceBridge on your Private network. Guest Wi-Fi may prevent PCs from connecting. Try a new connection key if a saved connection stops working.\n\nMICROPHONE\n\nKeyboard, mouse and sound need no extra downloads. VB-CABLE by VB-Audio (www.vb-cable.com) is included in this download. On the other PC click Set up included microphone driver, review its license, approve installation and restart Windows. The desk microphone starts after pairing. Choose the correct physical mic in DeviceBridge if needed, and select CABLE Output in your calling app. VB-CABLE is donationware; contributions and license purchases are welcome. Professional deployments require appropriate licensing.\n\nABOUT THIS RELEASE\n\nThis is a preview. Real two-PC input/audio testing is still needed. It does not share the screen or control Windows sign-in, permission screens, or elevated apps. The executable is not digitally signed, so Windows may show an unknown-publisher warning."));
        tabs.TabPages.Add(guide);
        var licenses = new TabPage("Licenses & details");
        var assembly = typeof(HelpForm).Assembly;
        var text = new System.Text.StringBuilder();
        foreach (var name in assembly.GetManifestResourceNames().Where(n => n.EndsWith(".txt", StringComparison.OrdinalIgnoreCase)).Order())
        {
            using var stream = assembly.GetManifestResourceStream(name)!; using var reader = new StreamReader(stream);
            text.AppendLine(name).AppendLine(new string('=', 50)).AppendLine(reader.ReadToEnd()).AppendLine();
        }
        licenses.Controls.Add(TextPanel(text.ToString())); tabs.TabPages.Add(licenses); Controls.Add(tabs);
    }
    static RichTextBox TextPanel(string text) => new() { Dock = DockStyle.Fill, ReadOnly = true, Text = text, BackColor = Color.White, BorderStyle = BorderStyle.None, Font = new Font("Segoe UI", 11), Padding = new Padding(16), DetectUrls = true };
}
