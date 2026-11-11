namespace DeviceBridge;

internal static class AppNavigation
{
    public static Control Bar(Action mainMenu)
    {
        var bar = new TableLayoutPanel { Dock=DockStyle.Top, Height=62, ColumnCount=2, RowCount=1, Padding=new Padding(12,6,12,4), BackColor=AppTheme.Background, Name="AppNavigation" };
        bar.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize)); bar.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));
        var back=AppTheme.Button("← Main menu"); back.Name="MainMenu"; back.AccessibleName="Main menu"; back.Click+=(_,_)=>mainMenu();
        var hint=new Label { Text="Sharing keeps running. Return with Continue on the main menu.", Dock=DockStyle.Fill, TextAlign=ContentAlignment.MiddleLeft, ForeColor=AppTheme.Muted, AutoEllipsis=true, Padding=new Padding(8,0,0,0) };
        bar.Controls.Add(back,0,0);bar.Controls.Add(hint,1,0);return bar;
    }
}
