namespace DeviceBridge;

public sealed class WelcomeForm : Form
{
    readonly Button saved;
    readonly Button resumeLocal = AppTheme.Button("Continue PC sharing →"), resumeRemote = AppTheme.Button("Continue Android connection →");
    bool quitting;
    internal MainForm? LocalSession => activeSession;
    internal RemoteHostForm? PhoneSession => remoteSession;
    MainForm? activeSession;
    RemoteHostForm? remoteSession;
    readonly bool designPreview;
    public WelcomeForm(bool designPreview=false)
    {
        this.designPreview=designPreview;
        Text = AppActivation.Title+(designPreview?" · Design preview":""); Icon = AppActivation.Icon; ClientSize = new Size(820, 660); MinimumSize = new Size(760, 640);
        Font = new Font("Segoe UI", 11); BackColor = AppTheme.Background; ForeColor = AppTheme.Forest; StartPosition = FormStartPosition.CenterScreen;
        var content = new FlowLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(36), FlowDirection = FlowDirection.TopDown, WrapContents = false, AutoScroll = true };
        content.Controls.Add(new Label { Text = "Your devices. Your choice.", Font = new Font("Segoe UI", 28, FontStyle.Bold), AutoSize = true });
        content.Controls.Add(new Label { Text = "Choose local PC sharing or control this computer from Android.\nOpen sessions stay connected when you return to this menu.", AutoSize = true, Margin = new Padding(3, 8, 3, 24) });
        var desk = Choice("Share this PC’s devices", "My keyboard, mouse, headphones and microphone are here.");
        desk.BackColor = AppTheme.Forest; desk.ForeColor = Color.White;
        var remote = Choice("Use devices from another PC", "I’ll paste the connection key on this PC.");
        content.Controls.Add(desk); content.Controls.Add(remote);
        var internet = Choice("Control this PC from Android", "Remote preview · Connect over the internet with computer approval.");
        internet.Click += (_, _) => OpenRemote();
        content.Controls.Add(internet);
        resumeLocal.Visible = resumeRemote.Visible = false;
        resumeLocal.Click += (_, _) => { if(activeSession is { IsDisposed:false }) { Hide(); activeSession.RestoreWindow(); } };
        resumeRemote.Click += (_, _) => { if(remoteSession is { IsDisposed:false }) { Hide(); remoteSession.RestoreWindow(); } };
        content.Controls.Add(resumeLocal); content.Controls.Add(resumeRemote);
        content.Controls.SetChildIndex(resumeLocal,2); content.Controls.SetChildIndex(resumeRemote,3);
        saved = AppTheme.Button("Reconnect my saved PC"); saved.AutoSize=false; saved.Width=700; saved.Height=44; saved.Margin=new Padding(3,15,3,8);
        content.Controls.Add(saved);
        content.Controls.Add(new Label { Text = "The desk PC shares its microphone after pairing or reconnecting. You can turn it off in the connected window.", AutoSize = true, MaximumSize = new Size(540, 0), ForeColor = Color.DimGray });
        var checks = AppTheme.Button("Check my setup"); checks.AutoSize=false; checks.Width=700; checks.Height=42;
        checks.Click += (_, _) => { using var test = new DiagnosticsForm(); test.ShowDialog(this); }; content.Controls.Add(checks);
        var help = new LinkLabel { Text = "Need a hand? Read the simple guide", AutoSize = true, Margin = new Padding(3, 8, 3, 0) }; content.Controls.Add(help);
        content.Controls.Add(new Label { Text = "Windows v" + AppActivation.Version + " · Desktop app · No account · Microphone driver included", AutoSize = true, ForeColor = Color.DimGray, Margin = new Padding(3, 18, 3, 0) });
        content.SizeChanged += (_, _) => { int width = Math.Max(300, content.ClientSize.Width - content.Padding.Horizontal - SystemInformation.VerticalScrollBarWidth - 8); foreach (Control child in content.Controls) { if (child is Button) child.Width = width; else if (child is Label) child.MaximumSize = new Size(width, 0); if (child is LinkLabel link) link.LinkColor = AppTheme.Forest; } };
        Controls.Add(content);
        desk.Click += (_, _) => Open(true, false); remote.Click += (_, _) => Open(false, false);
        saved.Click += (_, _) => { var peer = TrustedPeer.Load(); if (peer != null) Open(peer.Desk, true); };
        help.LinkClicked += (_, _) => { using var guide = new HelpForm(); guide.ShowDialog(this); };
        Activated += (_, _) => saved.Enabled = TrustedPeer.Load() != null;
        FormClosing += (_, e) => { if(!quitting && e.CloseReason == CloseReason.UserClosing && (activeSession is {IsDisposed:false} || remoteSession is {IsDisposed:false})) { e.Cancel=true; Hide(); } };
    }
    static Button Choice(string title, string description) => new() { Text = title + "\n" + description, TextAlign = ContentAlignment.MiddleLeft, Width = 700, Height = 98, Padding = new Padding(14), BackColor = Color.White, ForeColor = AppTheme.Forest, FlatStyle = FlatStyle.Flat, Margin = new Padding(3, 3, 3, 10), Cursor = Cursors.Hand };
    protected override void WndProc(ref Message message)
    {
        if ((uint)message.Msg == AppActivation.RestoreMessage)
        {
            if (Visible) { if(WindowState==FormWindowState.Minimized) WindowState=FormWindowState.Normal; Activate(); }
            else if (remoteSession != null && !remoteSession.IsDisposed) remoteSession.RestoreWindow();
            else if (activeSession != null && !activeSession.IsDisposed) activeSession.RestoreWindow();
            else { Show(); if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal; Activate(); }
            return;
        }
        base.WndProc(ref message);
    }
    internal void Open(bool desk, bool reconnect)
    {
        if(activeSession is {IsDisposed:false})
        {
            if(activeSession.DeskMode == desk) { Hide(); activeSession.RestoreWindow(); return; }
            if(!designPreview && MessageBox.Show(this,"Switching which PC shares devices ends the current local connection. Your Android connection can keep running.","Switch PC-sharing role?",MessageBoxButtons.OKCancel,MessageBoxIcon.Information)!=DialogResult.OK) return;
            activeSession.EndForNavigation();
        }
        Hide();
        try
        {
            var session = activeSession = new MainForm(desk, reconnect, designPreview);
            if(designPreview && Opacity==0) { session.Opacity=0; session.ShowInTaskbar=false; }
            session.MainMenuRequested += (_, _) => ShowMenu();
            session.FormClosed += (_, _) =>
            {
                if(ReferenceEquals(activeSession,session)) activeSession = null;
                if (session.QuitRequested) QuitAll();
                else if(!quitting) ShowMenu();
            };
            session.Show();
        }
        catch { Show(); throw; }
    }
    internal void OpenRemote(bool startHidden=false)
    {
        Hide();
        if(remoteSession is {IsDisposed:false}) { remoteSession.RestoreWindow(); return; }
        var session = remoteSession = new RemoteHostForm(designPreview,startHidden);
        if(designPreview && Opacity==0) { session.Opacity=0; session.ShowInTaskbar=false; }
        session.MainMenuRequested += (_, _) => ShowMenu();
        session.FormClosed += (_, _) => { if(ReferenceEquals(remoteSession,session)) remoteSession=null; if(session.QuitRequested) QuitAll(); else if(!quitting) ShowMenu(); };
        session.Show();
    }
    internal void ShowMenu()
    {
        activeSession?.Hide(); remoteSession?.Hide();
        resumeLocal.Visible = activeSession is {IsDisposed:false}; resumeRemote.Visible = remoteSession is {IsDisposed:false};
        saved.Enabled = TrustedPeer.Load()!=null;
        if(!designPreview){Opacity=1;ShowInTaskbar=true;}
        Show(); if(WindowState==FormWindowState.Minimized) WindowState=FormWindowState.Normal; Activate();
    }
    internal void QuitAll()
    {
        if(quitting)return; quitting=true;
        if(activeSession is {IsDisposed:false})activeSession.QuitApp();
        if(remoteSession is {IsDisposed:false})remoteSession.QuitApp();
        Close();
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
