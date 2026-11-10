namespace DeviceBridge;

internal static class AppTheme
{
    public static readonly Color Background = Color.FromArgb(246,247,240);
    public static readonly Color Forest = Color.FromArgb(27,48,38);
    public static readonly Color Lime = Color.FromArgb(224,249,144);
    public static readonly Color Muted = Color.FromArgb(104,119,103);
    public static readonly Color Border = Color.FromArgb(220,228,214);
    public static Button Button(string text, bool primary=false) => new()
    {
        Text=text, AutoSize=true, AutoSizeMode=AutoSizeMode.GrowAndShrink,
        MinimumSize=new Size(0,42), Padding=new Padding(13,8,13,8),
        FlatStyle=FlatStyle.Flat, FlatAppearance={BorderColor=primary?Forest:Border}, BackColor=primary?Forest:Color.White,
        ForeColor=primary?Color.White:Forest, Cursor=Cursors.Hand,
        Margin=new Padding(0,0,8,6), Font=new Font("Segoe UI",10,FontStyle.Bold)
    };
    public static FlowLayoutPanel Card() => new()
    {
        AutoSize=true, AutoSizeMode=AutoSizeMode.GrowAndShrink, BackColor=Color.White,
        Padding=new Padding(20), Margin=new Padding(0,0,0,16),
        FlowDirection=FlowDirection.TopDown, WrapContents=false, Tag="card"
    };
    public static FlowLayoutPanel Row() => new()
    {
        AutoSize=true, AutoSizeMode=AutoSizeMode.GrowAndShrink,
        WrapContents=true, Margin=new Padding(0,8,0,0), Tag="row"
    };
    public static Label Copy(string text, bool heading=false) => new()
    {
        Text=text, AutoSize=true, ForeColor=heading?Forest:Muted,
        Font=new Font("Segoe UI",heading?11:10,heading?FontStyle.Bold:FontStyle.Regular),
        Margin=new Padding(0,0,0,heading?12:8)
    };
    public static void FitColumn(FlowLayoutPanel column)
    {
        int width=Math.Max(260,column.ClientSize.Width-column.Padding.Horizontal-SystemInformation.VerticalScrollBarWidth-5);
        foreach (Control card in column.Controls)
        {
            card.MinimumSize=new Size(width,0); card.MaximumSize=new Size(width,0); card.Width=width;
            FitChildren(card,width-card.Padding.Horizontal);
        }
    }
    static void FitChildren(Control parent,int width)
    {
        width=Math.Max(100,width);
        foreach (Control child in parent.Controls)
        {
            if (child is FlowLayoutPanel flow)
            {
                flow.MaximumSize=new Size(width,0);
                FitChildren(flow,width-flow.Padding.Horizontal);
            }
            else if (child is Label)
            {
                child.MinimumSize=Size.Empty; child.MaximumSize=new Size(width,0);
            }
            else if (child is CheckBox check)
            {
                check.AutoSize=false; check.Width=width;
                check.Height=Math.Max(28,TextRenderer.MeasureText(check.Text,check.Font,new Size(Math.Max(60,width-26),1000),TextFormatFlags.WordBreak).Height+10);
                check.ForeColor=Forest; check.Margin=new Padding(0,0,0,8);
            }
            else if (child is TextBox or ComboBox or ProgressBar or ScreenLayoutPicker) child.Width=width;
            if (child is LinkLabel link) { link.LinkColor=Forest; link.ActiveLinkColor=Muted; }
        }
    }
}
