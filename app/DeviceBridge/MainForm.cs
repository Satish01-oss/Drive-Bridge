using System.Runtime.InteropServices;

namespace DeviceBridge;

public sealed class MainForm : Form
{
    readonly ComboBox address = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 260 };
    readonly TextBox key = new() { Multiline = true, Height = 66, Width = 690, ScrollBars = ScrollBars.Vertical };
    readonly TextBox directAddress = new() { Width = 500, PlaceholderText = "Optional — connection address shown on the first PC" };
    readonly Label hostAddress = new() { AutoSize = true, MaximumSize = new Size(610, 0) };
    readonly Button generate = MakeButton("New key", true), copy = MakeButton("Copy key"), join = MakeButton("Connect & allow", true), disconnect = MakeButton("Disconnect");
    readonly Button control = MakeButton("Start keyboard + mouse  ·  F8", true);
    readonly Button reconnect = MakeButton("Reconnect saved PC"), forget = MakeButton("Forget saved PC");
    readonly CheckBox allowInput = new() { Text = "Allow this PC to receive keyboard and mouse", AutoSize = true };
    readonly CheckBox sendAudio = new() { Text = "Share microphone", AutoSize = true };
    readonly CheckBox hearAudio = new() { Text = "Play remote PC sound here", AutoSize = true };
    readonly ComboBox output = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 400 };
    readonly ComboBox microphoneInput = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 550 };
    string? selectedMicrophone;
    readonly ProgressBar audioSendLevel = new() { Width = 560, Height = 12 }, audioReceiveLevel = new() { Width = 560, Height = 12 };
    readonly Label audioHint = new() { AutoSize = true, MaximumSize = new Size(610, 0), ForeColor = Color.FromArgb(140, 60, 30) };
    long lastAudioMeter;
    readonly Label status = new() { Text = "Ready. Generate a key on your desk PC, or paste a key here.", AutoSize = false, Height = 44, Dock = DockStyle.Fill, ForeColor = Color.FromArgb(29, 96, 86) };
    readonly Label role = new() { Text = "No connection", AutoSize = true, Font = new Font("Segoe UI", 12, FontStyle.Bold) };
    readonly Label hint = new() { AutoSize = true, MaximumSize = new Size(670, 0) };
    PairingHost? host;
    volatile Connection? connection;
    readonly InputBridge input;
    readonly AudioBridge audio;
    CancellationTokenSource? attempt;
    readonly List<(int Id, string Name)> outputs;
    bool desk, remoteInput, resetting;
    volatile bool receivingInput;
    readonly object receiveGate = new();
    string? persistenceError;
    string lastSession = "No active connection";
    long generation;
    TrustedPeer? trusted = TrustedPeer.Load();
    SessionWorker? inbox;
    sealed record ReceiveOptions(bool Desk, bool AllowInput, bool HearAudio, int Output);
    volatile ReceiveOptions receiveOptions = new(false, false, false, -1);
    readonly System.Windows.Forms.Timer incomingTimer = new() { Interval = 15 };
    readonly ScreenLayoutPicker layoutPicker;
    readonly CheckBox edgeSwitch = new() { Text = "Move to the chosen screen edge to switch PCs", AutoSize = true };
    bool setupOpen;
    long layoutRevision;
    readonly BackgroundSession tray;
    public bool QuitRequested => tray.QuitRequested;

    public MainForm(bool deskMode, bool useSaved = false)
    {
        desk = deskMode;
        var savedLayout = DeskLayout.Load(); layoutPicker = new ScreenLayoutPicker(savedLayout.Side); edgeSwitch.Checked = true;
        Text = AppActivation.Title + " · " + (desk ? "Your devices" : "Connect this PC"); Icon = AppActivation.Icon; ClientSize = new Size(740, 740); MinimumSize = new Size(760, 780);
        Font = new Font("Segoe UI", 10); BackColor = Color.FromArgb(245, 247, 249);
        StartPosition = FormStartPosition.CenterScreen;
        tray = new BackgroundSession(this, () => true, () => Reset("Disconnected. Sharing stopped."));
        input = new InputBridge(p => connection?.Send(p) ?? false);
        input.Emergency += reason => connection?.Stop(reason);
        input.EdgeEntered += fraction => { var revision = layoutRevision; Ui(() => { if (revision == layoutRevision) StartInput(true, fraction); }); };
        input.ReturnRequested += fraction =>
        {
            if (!desk && receivingInput) { receivingInput = false; input.ReleaseAll(); connection?.Send(new Packet("input-return", A: fraction)); }
        };
        selectedMicrophone = MicrophoneChoice.Load();
        var microphoneChoices = AudioBridge.Microphones();
        if (selectedMicrophone != null && !microphoneChoices.Any(m => m.Id == selectedMicrophone)) microphoneChoices.Add(new(selectedMicrophone, "Previously selected microphone — unavailable"));
        foreach (var choice in microphoneChoices) microphoneInput.Items.Add(choice);
        microphoneInput.SelectedIndex = Math.Max(0, microphoneChoices.FindIndex(m => m.Id == selectedMicrophone));
        audio = new AudioBridge(p => connection?.Send(p) ?? false, microphone => AudioBridge.CreateCapture(microphone, selectedMicrophone));
        audio.Failed += message => Ui(() => { status.Text = "Audio stopped: " + message; sendAudio.Checked = false; });
        audio.PlaybackFailed += message => Ui(() => { status.Text = "Audio playback stopped: " + message; hearAudio.Checked = false; });
        outputs = AudioBridge.Outputs();
        foreach (var device in outputs) output.Items.Add(device.Name);
        output.SelectedIndex = 0;
        foreach (var ip in Invitation.Addresses()) address.Items.Add(ip);
        if (address.Items.Count > 0) address.SelectedIndex = 0;

        var root = new FlowLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(28), FlowDirection = FlowDirection.TopDown, WrapContents = false, AutoScroll = true };
        var title = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown };
        title.AutoSize = true; title.Dock = DockStyle.None; title.Margin = new Padding(0, 0, 0, 18);
        title.Controls.Add(new Label { Text = desk ? "Your devices. Another PC." : "Let's connect this PC.", AutoSize = true, Font = new Font("Segoe UI", 23, FontStyle.Bold), ForeColor = Color.FromArgb(22, 43, 57) });
        title.Controls.Add(new Label { Text = desk ? "Pair to share your devices, including the microphone. You can turn it off below." : "Paste the key from the PC with the keyboard and mouse.", AutoSize = true, ForeColor = Color.DimGray });
        root.Controls.Add(title);
        var pairing = new FlowLayoutPanel { Width = 665, AutoSize = true, BackColor = Color.White, Padding = new Padding(16), FlowDirection = FlowDirection.TopDown, WrapContents = false };
        pairing.Controls.Add(new Label { Text = desk ? "YOUR CONNECTION KEY" : "PASTE CONNECTION KEY", AutoSize = true, Font = new Font("Segoe UI", 10, FontStyle.Bold) });
        key.Width = 620; key.Height = 60; key.Multiline = false; key.MaxLength = 6; key.CharacterCasing = CharacterCasing.Upper; key.Font = new Font("Consolas", 26, FontStyle.Bold);
        pairing.Controls.Add(key);
        var actions = new FlowLayoutPanel { AutoSize = true, MaximumSize = new Size(630, 0) }; actions.Controls.AddRange(desk ? new Control[] { copy, generate, disconnect } : new Control[] { join, disconnect }); pairing.Controls.Add(actions);
        if (!desk) pairing.Controls.Add(new Label { Text = "Connect & allow is the approval button. It permits keyboard/mouse control and shares this PC's sound. No separate Allow popup is needed.", AutoSize = true, MaximumSize = new Size(610, 0), ForeColor = Color.DimGray });
        if (desk) pairing.Controls.Add(hostAddress);
        var networkHelp = MakeButton("Fix connection / network access");
        networkHelp.Click += (_, _) => ShowSetup(() => new NetworkSetupForm());
        var supportActions = new FlowLayoutPanel { AutoSize = true, MaximumSize = new Size(630, 0) }; supportActions.Controls.Add(networkHelp); pairing.Controls.Add(supportActions);
        root.Controls.Add(pairing); role.Margin = new Padding(3, 16, 3, 8); root.Controls.Add(role);
        status.Dock = DockStyle.None; status.AutoSize = true; status.MinimumSize = new Size(630, 40); status.MaximumSize = new Size(650, 0); status.Margin = new Padding(3, 8, 3, 8); root.Controls.Add(status);
        if (desk) root.Controls.Add(layoutPicker);
        var devices = new FlowLayoutPanel { Width = 665, AutoSize = true, BackColor = Color.White, Padding = new Padding(16), FlowDirection = FlowDirection.TopDown, WrapContents = false };
        devices.Controls.Add(desk ? hearAudio : sendAudio);
        if (desk)
        {
            devices.Controls.Add(sendAudio);
            devices.Controls.Add(new Label { Text = "Microphone to share", AutoSize = true }); devices.Controls.Add(microphoneInput);
        }
        else
        {
            devices.Controls.Add(allowInput);
            var microphone = MakeButton("Set up included microphone driver");
            microphone.Enabled = DriverBundle.CableOutputId() == -2;
            if (!microphone.Enabled) microphone.Text = "Microphone driver ready";
            microphone.Click += (_, _) => ShowSetup(() => new MicrophoneSetupForm());
            devices.Controls.Add(microphone);
        }
        devices.Controls.Add(new Label { Text = desk ? "Connected? Move across the chosen screen edge. Keyboard follows automatically." : "Use the first PC's keyboard and mouse. Keep this app open.", AutoSize = true, ForeColor = Color.DimGray });
        devices.Controls.Add(new Label { Text = desk ? "Your microphone level" : "This PC's sound being shared", AutoSize = true }); devices.Controls.Add(audioSendLevel);
        devices.Controls.Add(new Label { Text = desk ? "Sound received from the other PC" : "Shared microphone received — choose CABLE Output in calls", AutoSize = true, MaximumSize = new Size(610, 0) }); devices.Controls.Add(audioReceiveLevel); devices.Controls.Add(audioHint);
        root.Controls.Add(devices);
        var more = new LinkLabel { Text = "More options", AutoSize = true, Margin = new Padding(3, 12, 3, 8) }; root.Controls.Add(more);
        var advanced = new FlowLayoutPanel { Width = 665, AutoSize = true, FlowDirection = FlowDirection.TopDown, WrapContents = false, Visible = false };
        if (desk) { advanced.Controls.Add(edgeSwitch); advanced.Controls.Add(control); advanced.Controls.Add(new Label { Text = "Network (chosen automatically)", AutoSize = true }); advanced.Controls.Add(address); }
        else { advanced.Controls.Add(new Label { Text = "If automatic search fails: first PC's connection address", AutoSize = true }); advanced.Controls.Add(directAddress); }
        advanced.Controls.Add(new Label { Text = "Audio output", AutoSize = true }); advanced.Controls.Add(output);
        if (!desk) advanced.Controls.Add(hearAudio);
        hint.MaximumSize = new Size(630, 0); advanced.Controls.Add(hint);
        var savedActions = new FlowLayoutPanel { AutoSize = true }; savedActions.Controls.AddRange(new Control[] { reconnect, forget }); advanced.Controls.Add(savedActions);
        more.LinkClicked += (_, _) => { advanced.Visible = !advanced.Visible; more.Text = advanced.Visible ? "Fewer options" : "More options"; }; root.Controls.Add(advanced);
        var checkSetup = MakeButton("Check my setup");
        checkSetup.Click += (_, _) =>
        {
            if (input.Capturing) StopInput();
            ShowSetup(() => new DiagnosticsForm(
                () => (desk ? "Role: desk PC\n" : "Role: other PC\n") + (connection?.Diagnostics ?? lastSession) + $"\nIncoming queue: {inbox?.Count ?? 0}\nInput sharing: {(desk ? input.Capturing : receivingInput)}\nAudio sending / receiving enabled: {sendAudio.Checked} / {hearAudio.Checked}\n" + audio.Diagnostics,
                () => audio.IncomingPeak,
                desk ? () => { connection?.Send(new Packet("speaker-probe")); } : null));
        };
        supportActions.Controls.Add(checkSetup);
        var help = new LinkLabel { Text = "Help & licenses", AutoSize = true }; help.LinkClicked += (_, _) => ShowSetup(() => new HelpForm()); root.Controls.Add(help);
        root.Controls.Add(new Label { Text = "X keeps sharing in the tray. Ctrl+Alt+Esc stops sharing. Tray → Disconnect and quit exits.", AutoSize = true, MaximumSize = new Size(650, 0), ForeColor = Color.DimGray, Font = new Font("Segoe UI", 9), Margin = new Padding(3, 10, 3, 0) });
        Controls.Add(root);
        generate.Click += async (_, _) => await GenerateAsync(); copy.Click += (_, _) => { if (key.Text.Length == 6) { Clipboard.SetText(key.Text); status.Text = "Six-character key copied. Paste it on the other PC and click Connect & allow."; } };
        join.Click += async (_, _) => await JoinAsync(); disconnect.Click += (_, _) => Reset("Disconnected. Sharing stopped."); control.Click += (_, _) => ToggleInput();
        reconnect.Click += async (_, _) => { if (trusted == null) return; if (trusted.Desk) await GenerateAsync(true); else await JoinAsync(trusted.Invitation); };
        forget.Click += (_, _) => { try { TrustedPeer.Forget(); trusted = null; status.Text = "Saved pairing removed. Generate a new key on both PCs to replace their previous pairing."; RefreshUi(); } catch (Exception e) { status.Text = "Could not remove saved pairing: " + e.Message; } };
        allowInput.CheckedChanged += (_, _) => { lock (receiveGate) { UpdateReceiveOptions(); if (!allowInput.Checked) { receivingInput = false; input.ReleaseAll(); } } connection?.Send(new Packet("permission", A: allowInput.Checked ? 1 : 0)); };
        layoutPicker.Changed += _ => SaveLayout(); edgeSwitch.CheckedChanged += (_, _) => SaveLayout();
        sendAudio.CheckedChanged += (_, _) => ChangeCapture();
        microphoneInput.SelectedIndexChanged += (_, _) =>
        {
            if (microphoneInput.SelectedItem is not MicrophoneChoice choice) return;
            selectedMicrophone = choice.Id;
            try { choice.Save(); } catch { status.Text = "Microphone selected for this session; its preference could not be saved."; }
            if (sendAudio.Checked && connection != null) ChangeCapture();
        };
        hearAudio.CheckedChanged += (_, _) => { lock (receiveGate) { UpdateReceiveOptions(); audio.StopPlayback(); } if (hearAudio.Checked) connection?.Send(new Packet("refresh-audio")); };
        output.SelectedIndexChanged += (_, _) => { lock (receiveGate) { UpdateReceiveOptions(); audio.StopPlayback(); } if (hearAudio.Checked) connection?.Send(new Packet("refresh-audio")); };
        incomingTimer.Tick += (_, _) =>
        {
            if (Environment.TickCount64 - lastAudioMeter >= 100)
            {
                lastAudioMeter = Environment.TickCount64;
                audioSendLevel.Value = Math.Clamp((int)(audio.OutgoingPeak * 100), 0, 100);
                audioReceiveLevel.Value = Math.Clamp((int)(audio.IncomingPeak * 100), 0, 100);
                var message = audio.LastError == "None" ? "" : "Audio needs attention: " + audio.LastError;
                if (audioHint.Text != message) audioHint.Text = message;
            }
        };
        // Cancelled close/minimize events must never dispose the sharing session.
        FormClosed += (_, _) => { Reset("Closing."); incomingTimer.Dispose(); input.Dispose(); audio.Dispose(); tray.Dispose(); };
        Resize += (_, _) => ConnectionLog.Write("Window state: " + WindowState);
        Shown += async (_, _) => { if (useSaved && trusted != null) { if (desk) await GenerateAsync(true); else await JoinAsync(trusted.Invitation); } else if (desk) await GenerateAsync(); else key.Focus(); };
        RefreshUi();
    }
    public void RestoreWindow() => tray.Restore();
    static Button MakeButton(string text, bool primary = false) => new() { Text = text, AutoSize = true, Height = 36, Padding = new Padding(9, 3, 9, 3), FlatStyle = FlatStyle.Flat, BackColor = primary ? Color.FromArgb(26, 111, 99) : Color.FromArgb(237, 241, 243), ForeColor = primary ? Color.White : Color.FromArgb(22, 43, 57), Cursor = Cursors.Hand };
    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        var toggle = RegisterHotKey(Handle, 1, 0x4000, 0x77);
        var emergency = RegisterHotKey(Handle, 2, 0x4003, 0x13);
        var escape = RegisterHotKey(Handle, 3, 0x4003, 0x1B);
        if (!toggle || (!emergency && !escape)) status.Text = "A shortcut is used by another app. Automatic screen-edge switching still works. Use Disconnect to stop sharing; Ctrl+Alt+Esc is also handled during input capture.";
    }
    protected override void OnHandleDestroyed(EventArgs e) { UnregisterHotKey(Handle, 1); UnregisterHotKey(Handle, 2); UnregisterHotKey(Handle, 3); base.OnHandleDestroyed(e); }
    protected override void WndProc(ref Message m)
    {
        if (m.Msg == 0x312) { if ((int)m.WParam == 1) ToggleInput(); else Reset("Emergency stop. All sharing stopped."); }
        base.WndProc(ref m);
    }
    void Ui(Action action) { if (!IsDisposed && IsHandleCreated) { try { BeginInvoke(action); } catch (InvalidOperationException) { } } }
    async Task GenerateAsync(bool saved = false)
    {
        string? ip = saved ? trusted?.Invitation.Address : address.SelectedItem as string;
        if (ip == null) { status.Text = "No local network address found. Connect by Wi-Fi or Ethernet, then try again."; return; }
        Reset(""); desk = true;
        var current = ++generation;
        try
        {
            var pending = host = new PairingHost(ip, saved ? trusted : null, discoverable: !saved); key.Text = saved ? "" : pending.Code;
            hostAddress.Text = "The app can wait in the tray. Connection address: " + pending.Invitation.Address + ":" + pending.Invitation.Port;
            status.Text = pending.DiscoveryError ?? (saved ? "Ready for your saved PC. Choose Reconnect my saved PC there." : "Paste this six-character key on the other PC. Both Wi-Fi and Ethernet work on the same local network.");
            RefreshUi();
            var connected = await Task.Run(pending.AcceptAsync);
            if (current != generation) { connected.Dispose(); return; }
            SaveTrusted(new TrustedPeer(true, pending.Invitation with { Secret = Convert.ToHexString(connected.NextSecret!) }, pending.ExportCertificate()));
            pending.Dispose(); host = null; key.Clear(); Attach(connected);
        }
        catch (Exception e) { if (current == generation) Reset(e is OperationCanceledException ? "This key has expired. Click New key for a new one." : e is System.Net.Sockets.SocketException ? "Couldn't start listening. Close other DeviceBridge copies on this PC, then click New key. Details: " + e.Message : "Couldn't get ready: " + e.Message); }
    }
    async Task JoinAsync(Invitation? saved = null)
    {
        string? code = null;
        System.Net.IPEndPoint? direct = null;
        try { if (saved == null) code = ShortPairing.Normalize(key.Text); } catch (Exception e) { status.Text = e.Message; return; }
        try { if (saved == null && !string.IsNullOrWhiteSpace(directAddress.Text)) direct = TcpDiscovery.ParseAddress(directAddress.Text); } catch (ArgumentException e) { status.Text = e.Message; return; }
        Reset(""); desk = false; long current = ++generation;
        attempt = new CancellationTokenSource(TimeSpan.FromSeconds(75));
        status.Text = "Finding the first PC on your local network…"; RefreshUi();
        try
        {
            var connected = saved != null ? await Connection.JoinAsync(saved, attempt.Token) : await Connection.JoinCodeAsync(code!, attempt.Token,
                message => Ui(() => { if (current == generation) status.Text = message; }), direct);
            if (current != generation) { connected.Dispose(); return; }
            attempt.Dispose(); attempt = null;
            var paired = saved != null ? saved with { Secret = Convert.ToHexString(connected.NextSecret!) } : connected.PairedInvitation!;
            SaveTrusted(new TrustedPeer(false, paired, null));
            key.Clear(); Attach(connected);
        }
        catch (Exception e) { if (current == generation) Reset(e is OperationCanceledException ? "Connection timed out. Keep the first PC's key screen open and use Fix connection / network access on both PCs before retrying." : e.Message); }
    }
    void Attach(Connection c)
    {
        connection = c;
        var pending = inbox = new SessionWorker(packet => ProcessInBackground(c, packet), error => c.Stop("Sharing stopped: " + error.Message));
        c.Received += packet => { if (!pending.TryAdd(packet)) c.Stop("Incoming event queue filled. Sharing stopped to prevent delayed input."); };
        c.Closed += reason => { input.ReleaseAll(); Ui(() => { if (connection == c) Reset(reason); }); };
        if (!desk) allowInput.Checked = true;
        UpdateReceiveOptions();
        incomingTimer.Start();
        c.Start(); status.Text = persistenceError ?? (desk ? "Connected. Choose where the other screen sits; then use its edge or F8." : "Connected and allowed. The checked control box below is your approval; uncheck it to stop remote control.");
        RefreshUi();
        // The role choice and Connect button explain this permission before pairing.
        // The desk-role choice explicitly includes microphone sharing.
        if (desk) { hearAudio.Checked = true; sendAudio.Checked = true; }
        else
        {
            allowInput.Checked = true; sendAudio.Checked = true;
            var cable = DriverBundle.CableOutputId();
            if (cable != -2)
            {
                var selected = outputs.FindIndex(x => x.Id == cable);
                if (selected >= 0) { output.SelectedIndex = selected; hearAudio.Checked = true; }
            }
        }
        if (desk) hostAddress.Text = "Sharing stays active when this window is minimized or hidden in the tray.";
        if (c.PeerProtocol < Connection.Protocol) status.Text = "Connected to an older app. Install version 0.8 on BOTH PCs for background sharing fixes.";
    }
    void UpdateReceiveOptions() { lock (receiveGate) receiveOptions = new(desk, allowInput.Checked, hearAudio.Checked, output.SelectedIndex >= 0 ? outputs[output.SelectedIndex].Id : -1); }
    void ProcessInBackground(Connection current, Packet packet)
    {
        if (!ReferenceEquals(connection, current) || !current.IsConnected) return;
        lock (receiveGate)
        {
        if (!ReferenceEquals(connection, current) || !current.IsConnected) return;
        var options = receiveOptions;
        switch (packet.Kind)
        {
            case "input-start" when !options.Desk:
                receivingInput = options.AllowInput;
                if (receivingInput && current.PeerProtocol >= 5)
                {
                    if (!Enum.IsDefined((DeviceSide)packet.A) || packet.B is < 0 or > 65535 || packet.C is < 0 or > 3) throw new IOException("Invalid screen layout request.");
                    input.ConfigureRemote((DeviceSide)packet.A, packet.B, (packet.C & 1) != 0, (packet.C & 2) != 0);
                }
                current.Send(new Packet("input-ack", A: receivingInput ? 1 : 0));
                return;
            case "input-end" when !options.Desk:
                receivingInput = false; input.ReleaseAll(); return;
            case "key" or "move" or "mouse" when !options.Desk:
                if (receivingInput && options.AllowInput) input.Apply(packet, current.Lifetime);
                return;
            case "sound" or "sound-format" or "sound-stop" or "mic" or "mic-format" or "mic-stop":
                if (!options.HearAudio) return;
                try { audio.Receive(packet, options.Desk ? "sound" : "mic", options.Output); }
                catch (Exception error) when (error is NAudio.MmException or COMException)
                {
                    audio.PlaybackError(error);
                    Ui(() => { if (connection == current) { hearAudio.Checked = false; status.Text = "Audio output unavailable: " + error.Message; } });
                }
                return;
            default:
                Ui(() => { if (connection == current) Process(packet); }); return;
        }
        }
    }
    void SaveTrusted(TrustedPeer peer)
    {
        try { peer.Save(); trusted = peer; persistenceError = null; }
        catch (Exception) { trusted = null; persistenceError = "Connected, but pairing could not be saved. You will need a new key next time."; }
    }
    void Process(Packet p)
    {
        if (connection == null || !connection.IsConnected) return;
        try
        {
            switch (p.Kind)
            {
                case "permission" when desk:
                    remoteInput = p.A == 1; if (!remoteInput) StopInput(); RefreshUi(); break;
                case "input-ack" when desk:
                    if (p.A != 1) { StopInput(); status.Text = "On the other PC, check Allow this PC to receive keyboard and mouse."; }
                    break;
                case "input-return" when desk:
                    if (p.A is < 0 or > 65535) throw new IOException("Invalid return position.");
                    StopInput(p.A); break;
                case "speaker-probe" when !desk:
                    connection.Send(AudioSignal.SpeakerTestPacket()); break;
                case "speaker-test" when desk:
                    _ = PlaySpeakerTest(p); break;
                case "refresh-audio":
                    if (sendAudio.Checked) audio.StartCapture(desk); break;
                default: break;
            }
        }
        catch (Exception e) { Reset("Sharing stopped: " + e.Message); }
    }
    async Task PlaySpeakerTest(Packet packet)
    {
        var current = connection;
        var played = await DiagnosticsForm.PlayReceivedTestAsync(packet, outputs[output.SelectedIndex].Id);
        if (connection == current && current != null) status.Text = played ? "Headphone test audio played. Please confirm you heard it." : "Could not play the headphone test. Check the selected output and volume.";
    }
    void ToggleInput()
    {
        if (connection == null || !desk) return;
        if (input.Capturing) { StopInput(); return; }
        StartInput(false, DesktopGeometry.Fraction(SystemInformation.VirtualScreen, Cursor.Position, layoutPicker.Selected));
    }
    void StartInput(bool fromEdge, int fraction)
    {
        if (setupOpen || connection == null || !connection.IsConnected || !desk || input.Capturing) return;
        if (fromEdge && (!edgeSwitch.Checked || connection.PeerProtocol < 5 || !remoteInput)) return;
        if (!remoteInput) { status.Text = "On the remote PC, enable “Allow this PC to receive keyboard and mouse” first."; return; }
        bool automatic = edgeSwitch.Checked && connection.PeerProtocol >= 5;
        try { connection.Send(new Packet("input-start", A: (int)layoutPicker.Selected, B: fraction, C: (automatic ? 1 : 0) | (fromEdge ? 2 : 0))); input.Start(); status.Text = "Keyboard and mouse control the other PC. Move back across the joining edge, or press F8, to return."; RefreshUi(); }
        catch (Exception e) { StopInput(); status.Text = e.Message; }
    }
    void StopInput(int? fraction = null)
    {
        input.StopCapture(fraction); connection?.Send(new Packet("input-end"));
        if (connection != null) status.Text = "Input is here. Use the selected screen edge or F8 to go to the other PC.";
        RefreshUi();
    }
    void SaveLayout()
    {
        layoutRevision++;
        if (input.Capturing) StopInput();
        try { new DeskLayout(layoutPicker.Selected, edgeSwitch.Checked).Save(); }
        catch { status.Text = "Layout works for this session, but couldn't be saved."; }
        RefreshUi();
    }
    void ShowSetup(Func<Form> create)
    {
        setupOpen = true;
        if (desk) { if (input.Capturing) StopInput(); input.WatchEdge(false, layoutPicker.Selected); }
        try { using var dialog = create(); dialog.ShowDialog(this); }
        finally { setupOpen = false; RefreshUi(); }
    }
    void ChangeCapture()
    {
        if (resetting) return;
        try { if (sendAudio.Checked && connection != null) audio.StartCapture(desk); else { audio.StopCapture(); connection?.Send(new Packet(desk ? "mic-stop" : "sound-stop")); } }
        catch (Exception e) { status.Text = "Audio unavailable: " + e.Message; sendAudio.Checked = false; }
    }
    void Reset(string message)
    {
        generation++; resetting = true;
        incomingTimer.Stop();
        attempt?.Cancel(); attempt?.Dispose(); attempt = null;
        host?.Dispose(); host = null;
        var previous = connection; connection = null; previous?.Dispose();
        inbox?.Dispose(); inbox = null;
        if (previous != null) lastSession = "Last session:\n" + previous.Diagnostics + "\nEnded: " + message;
        input.Stop(); input.ReleaseAll(); audio.Dispose();
        remoteInput = receivingInput = false;
        hostAddress.Text = "";
        audioSendLevel.Value = audioReceiveLevel.Value = 0;
        allowInput.Checked = sendAudio.Checked = hearAudio.Checked = false;
        resetting = false; status.Text = message; RefreshUi();
    }
    void RefreshUi()
    {
        bool live = connection != null, busy = host != null || attempt != null;
        generate.Enabled = !live && attempt == null; join.Enabled = !live && !busy; address.Enabled = !live && !busy; key.ReadOnly = live || host != null;
        copy.Enabled = host != null && key.Text.Length == 6; disconnect.Enabled = live || busy;
        reconnect.Enabled = trusted != null && !live && !busy; forget.Enabled = trusted != null && !live && !busy;
        allowInput.Enabled = live && !desk; control.Enabled = live && desk;
        control.Text = input.Capturing ? "Return keyboard + mouse here  ·  F8" : "Start keyboard + mouse  ·  F8";
        sendAudio.Enabled = hearAudio.Enabled = output.Enabled = live;
        sendAudio.Text = desk ? "Share my microphone with the other PC" : "Send this PC's sound to the first PC";
        hearAudio.Text = desk ? "Hear the other PC through my speakers" : "Receive microphone through VB-CABLE";
        hint.Text = !live ? "Connection is direct over your local network. Sharing stays off until you choose it." : desk ? "Use headphones to avoid feedback. Mic uses the Windows default recording device." : "For calls: choose a virtual cable's playback input here, then its recording output in your calling app. Normal speakers play the mic aloud.";
        role.Text = live ? "Connected" : busy ? desk ? "Waiting for your other PC…" : "Connecting…" : "Ready to connect";
        if (desk)
        {
            edgeSwitch.Enabled = !live || connection!.PeerProtocol >= 5;
            edgeSwitch.Text = live && connection!.PeerProtocol < 5 ? "Update the other PC for automatic edge switching; F8 still works" : "Move to the chosen screen edge to switch PCs";
            try { input.WatchEdge(!setupOpen && live && remoteInput && edgeSwitch.Checked && connection!.PeerProtocol >= 5, layoutPicker.Selected); }
            catch { edgeSwitch.Checked = false; status.Text = "Automatic edge switching couldn't start. F8 still works."; }
        }
    }
    [DllImport("user32.dll", SetLastError = true)] static extern bool RegisterHotKey(nint window, int id, uint modifiers, uint key);
    [DllImport("user32.dll")] static extern bool UnregisterHotKey(nint window, int id);
}
