using System.Runtime.InteropServices;

namespace DeviceBridge;

// A tiny no-activate window owns the parked pointer's hit-test and answers
// WM_SETCURSOR with a null cursor. It does not replace Windows cursor schemes
// or change global ShowCursor counters. Windows removes it if the app exits.
internal sealed class CursorCover : IDisposable
{
    readonly Action<Point> activate;
    readonly Action deactivate;
    PointerWindow? window;
    public bool Active { get; private set; }
    public CursorCover()
    {
        activate=point=>{window??=new PointerWindow();window.Cover(point);};
        deactivate=()=>window?.Uncover();
    }
    internal CursorCover(Action<Point> activate,Action deactivate){this.activate=activate;this.deactivate=deactivate;}
    public void HideAt(Point point)
    {
        if(Active)return;
        Active=true;
        try{activate(point);}catch{Restore();throw;}
    }
    public void Refresh(){if(Active)window?.RefreshCursor();}
    public void Restore(){if(!Active)return;Active=false;deactivate();}
    public void Dispose(){try{Restore();}finally{window?.Dispose();window=null;}}
    public static bool PointerVisible
    {
        get{var info=new CursorInfo {Size=Marshal.SizeOf<CursorInfo>()};return GetCursorInfo(ref info)&&(info.Flags&1)!=0;}
    }
    sealed class PointerWindow : Form
    {
        public PointerWindow()
        {
            FormBorderStyle=FormBorderStyle.None;ShowInTaskbar=false;TopMost=true;
            StartPosition=FormStartPosition.Manual;BackColor=Color.Black;Opacity=1.0/255;
            Text="DeviceBridge pointer handoff";AutoScaleMode=AutoScaleMode.None;
        }
        protected override bool ShowWithoutActivation=>true;
        protected override CreateParams CreateParams{get{var p=base.CreateParams;p.ExStyle|=0x08000000|0x80;return p;}}
        public void Cover(Point point)
        {
            Bounds=new Rectangle(point.X-4,point.Y-4,8,8);Show();
            SetLayeredWindowAttributes(Handle,0,1,2);
            var current=Cursor.Position;if(Bounds.Contains(current))Cursor.Position=current;
            RefreshCursor();
        }
        public void RefreshCursor(){if(Visible)SendMessage(Handle,0x20,Handle,(nint)(1|(0x200<<16)));}
        public void Uncover()
        {
            Hide();
            var below=WindowFromPoint(Cursor.Position);
            if(below!=0)SendMessageTimeout(below,0x20,below,(nint)(1|(0x200<<16)),2,50,out _);
        }
        protected override void WndProc(ref Message message)
        {
            if(message.Msg==0x20){SetCursor(0);message.Result=1;return;}
            if(message.Msg==0x21){message.Result=3;return;}
            base.WndProc(ref message);
        }
    }
    [StructLayout(LayoutKind.Sequential)]struct CursorInfo{public int Size,Flags;public nint Cursor;public Point Position;}
    [DllImport("user32.dll")]static extern bool GetCursorInfo(ref CursorInfo info);
    [DllImport("user32.dll")]static extern nint SetCursor(nint cursor);
    [DllImport("user32.dll")]static extern bool SetLayeredWindowAttributes(nint window,uint key,byte alpha,uint flags);
    [DllImport("user32.dll")]static extern nint SendMessage(nint window,int message,nint wParam,nint lParam);
    [DllImport("user32.dll")]static extern nint SendMessageTimeout(nint window,int message,nint wParam,nint lParam,uint flags,uint timeout,out nint result);
    [DllImport("user32.dll")]static extern nint WindowFromPoint(Point point);
}
