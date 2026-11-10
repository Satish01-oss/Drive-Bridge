namespace DeviceBridge;

public sealed partial class MainForm
{
    Action? fitLayout;
    void BuildWindowLayout()
    {
        var workArea=Screen.FromPoint(Cursor.Position).WorkingArea;
        MinimumSize=new Size(Math.Min(960,workArea.Width-24),Math.Min(700,workArea.Height-20));
        ClientSize=new Size(Math.Min(1060,workArea.Width-60),Math.Min(740,workArea.Height-70));
        BackColor=AppTheme.Background; ForeColor=AppTheme.Forest;
        var shell=new TableLayoutPanel {Dock=DockStyle.Fill,ColumnCount=1,RowCount=3,Padding=new Padding(28,20,22,10)};
        shell.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));
        shell.RowStyles.Add(new RowStyle(SizeType.Absolute,104));shell.RowStyles.Add(new RowStyle(SizeType.Percent,100));shell.RowStyles.Add(new RowStyle(SizeType.Absolute,38));
        var header=new FlowLayoutPanel {Dock=DockStyle.Fill,FlowDirection=FlowDirection.TopDown,WrapContents=false,Margin=Padding.Empty};
        var brand=AppTheme.Copy("DEVICEBRIDGE  /  WINDOWS v"+AppActivation.Version); brand.Font=new Font("Segoe UI",9,FontStyle.Bold);
        var heading=AppTheme.Copy(desk?"Your devices. Both PCs.":"Connect to your desk PC.",true); heading.Font=new Font("Segoe UI",25,FontStyle.Bold); heading.Margin=new Padding(0,0,0,6);
        header.Controls.AddRange(new Control[] {brand,heading,AppTheme.Copy(desk?"Pair once. Your keyboard, mouse, headphones and mic stay together.":"Paste the six-character key from the PC with your keyboard and mouse.")}); shell.Controls.Add(header,0,0);
        var columns=new TableLayoutPanel {Dock=DockStyle.Fill,ColumnCount=2,RowCount=1,Margin=Padding.Empty};
        columns.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,58));columns.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,42));columns.RowStyles.Add(new RowStyle(SizeType.Percent,100));
        var left=new FlowLayoutPanel {Dock=DockStyle.Fill,FlowDirection=FlowDirection.TopDown,WrapContents=false,AutoScroll=true,Margin=Padding.Empty,Padding=new Padding(0,0,10,0)};
        var right=new FlowLayoutPanel {Dock=DockStyle.Fill,FlowDirection=FlowDirection.TopDown,WrapContents=false,AutoScroll=true,Margin=Padding.Empty};
        columns.Controls.Add(left,0,0);columns.Controls.Add(right,1,0);shell.Controls.Add(columns,0,1);

        var pairing=AppTheme.Card(); pairing.Controls.Add(AppTheme.Copy(desk?"01  /  YOUR CONNECTION KEY":"01  /  PASTE THE CONNECTION KEY",true));
        key.Multiline=false;key.MaxLength=6;key.CharacterCasing=CharacterCasing.Upper;key.TextAlign=HorizontalAlignment.Center;key.PlaceholderText=desk?"Generating…":"ABC234";key.Font=new Font("Consolas",30,FontStyle.Bold);key.BorderStyle=BorderStyle.FixedSingle;key.BackColor=AppTheme.Background;key.ForeColor=AppTheme.Forest;key.Margin=new Padding(0,0,0,12);
        pairing.Controls.Add(key);var actions=AppTheme.Row();actions.Controls.AddRange(desk?new Control[]{copy,generate,disconnect}:new Control[]{join,disconnect});pairing.Controls.Add(actions);
        pairing.Controls.Add(AppTheme.Copy(desk?"On the other PC, choose “Use devices from another PC” and paste this key.":"Connect & allow approves keyboard/mouse control and sound sharing. There is no second approval popup."));
        if(desk) {hostAddress.Margin=new Padding(0,6,0,0);hostAddress.ForeColor=AppTheme.Muted;pairing.Controls.Add(hostAddress);}left.Controls.Add(pairing);

        var state=AppTheme.Card();role.Font=new Font("Segoe UI",14,FontStyle.Bold);role.ForeColor=AppTheme.Forest;role.Margin=new Padding(0,0,0,8);
        status.Dock=DockStyle.None;status.AutoSize=true;status.ForeColor=AppTheme.Muted;status.MinimumSize=Size.Empty;status.Margin=Padding.Empty;state.Controls.AddRange(new Control[]{role,status});left.Controls.Add(state);
        if(desk){var layout=AppTheme.Card();layout.Controls.Add(layoutPicker);layout.Controls.Add(AppTheme.Copy("Move across that screen edge to switch PCs. Your keyboard follows."));left.Controls.Add(layout);}

        var advanced=AppTheme.Card();advanced.Visible=false;
        if(desk){advanced.Controls.Add(edgeSwitch);advanced.Controls.Add(control);advanced.Controls.Add(AppTheme.Copy("Local network address"));advanced.Controls.Add(address);}
        else{advanced.Controls.Add(AppTheme.Copy("Connection address, only if automatic search fails"));advanced.Controls.Add(directAddress);}
        advanced.Controls.Add(AppTheme.Copy("Audio output"));advanced.Controls.Add(output);if(!desk)advanced.Controls.Add(hearAudio);advanced.Controls.Add(hint);
        var savedActions=AppTheme.Row();savedActions.Controls.AddRange(new Control[]{reconnect,forget});advanced.Controls.Add(savedActions);left.Controls.Add(advanced);

        var devices=AppTheme.Card();devices.Controls.Add(AppTheme.Copy("02  /  YOUR SHARED DEVICES",true));devices.Controls.Add(desk?hearAudio:sendAudio);
        if(desk){devices.Controls.Add(sendAudio);devices.Controls.Add(AppTheme.Copy("Microphone to share"));devices.Controls.Add(microphoneInput);}
        else{
            devices.Controls.Add(allowInput);var driver=MakeButton("Set up microphone driver");driver.Enabled=DriverBundle.CableOutputId()==-2;if(!driver.Enabled)driver.Text="Microphone driver is ready";
            driver.Click+=(_,_)=>ShowSetup(()=>new MicrophoneSetupForm());devices.Controls.Add(driver);
        }
        devices.Controls.Add(AppTheme.Copy(desk?"Use headphones for the clearest sound and to avoid feedback.":"For calls, select CABLE Output as the microphone in your calling app."));
        devices.Controls.Add(AppTheme.Copy(desk?"Microphone sent to the other PC":"This PC’s sound being shared"));devices.Controls.Add(audioSendLevel);
        devices.Controls.Add(AppTheme.Copy(desk?"Sound received from the other PC":"Shared microphone received"));devices.Controls.Add(audioReceiveLevel);devices.Controls.Add(audioHint);right.Controls.Add(devices);

        var helpCard=AppTheme.Card();helpCard.Controls.Add(AppTheme.Copy("NEED A HAND?",true));
        var networkHelp=MakeButton("Fix connection / network access");networkHelp.Click+=(_,_)=>ShowSetup(()=>new NetworkSetupForm());helpCard.Controls.Add(networkHelp);
        var checkSetup=MakeButton("Check my setup");checkSetup.Click+=(_,_)=>{
            if(input.Capturing)StopInput();
            ShowSetup(()=>new DiagnosticsForm(()=> (desk?"Role: desk PC\n":"Role: other PC\n")+(connection?.Diagnostics??lastSession)+$"\nIncoming queue: {inbox?.Count??0}\nInput sharing: {(desk?input.Capturing:receivingInput)}\nAudio sending / receiving enabled: {sendAudio.Checked} / {hearAudio.Checked}\n"+audio.Diagnostics,()=>audio.IncomingPeak,desk?()=>{connection?.Send(new Packet("speaker-probe"));}:null));
        };helpCard.Controls.Add(checkSetup);
        var links=AppTheme.Row();var more=new LinkLabel {Text="More options",AutoSize=true,Margin=new Padding(0,8,20,6),LinkColor=AppTheme.Forest};
        more.LinkClicked+=(_,_)=>{advanced.Visible=!advanced.Visible;more.Text=advanced.Visible?"Fewer options":"More options";fitLayout?.Invoke();};
        var help=new LinkLabel {Text="Help & licenses",AutoSize=true,Margin=new Padding(0,8,16,6),LinkColor=AppTheme.Forest};help.LinkClicked+=(_,_)=>ShowSetup(()=>new HelpForm());
        var quit=new LinkLabel {Text="Quit app",AutoSize=true,Margin=new Padding(0,8,0,6),LinkColor=AppTheme.Forest};quit.LinkClicked+=(_,_)=>tray.Quit();
        links.Controls.AddRange(new Control[]{more,help,quit});helpCard.Controls.Add(links);right.Controls.Add(helpCard);
        var background=AppTheme.Card();background.BackColor=Color.FromArgb(235,241,222);background.Controls.Add(AppTheme.Copy("RUNS IN THE BACKGROUND",true));background.Controls.Add(AppTheme.Copy("Minimize or X keeps sharing in the tray. Open DeviceBridge from your desktop to return. Use Disconnect and quit to exit."));right.Controls.Add(background);
        var footer=AppTheme.Copy("Minimize / X keeps the app running in the tray  ·  Ctrl + Alt + Esc stops sharing  ·  Wi-Fi + Ethernet supported");footer.Dock=DockStyle.Fill;footer.TextAlign=ContentAlignment.MiddleLeft;footer.Font=new Font("Segoe UI",9);shell.Controls.Add(footer,0,2);
        bool fitting=false,pending=false;
        fitLayout=()=>{if(fitting){pending=true;return;}fitting=true;try{int pass=0;do{pending=false;AppTheme.FitColumn(left);AppTheme.FitColumn(right);}while(pending&&++pass<4);}finally{fitting=false;}};
        left.ClientSizeChanged+=(_,_)=>fitLayout();right.ClientSizeChanged+=(_,_)=>fitLayout();
        Controls.Add(shell);fitLayout();
    }
}
