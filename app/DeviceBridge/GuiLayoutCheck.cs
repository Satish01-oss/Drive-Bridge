namespace DeviceBridge;

internal static class GuiLayoutCheck
{
    public static Task RunAsync()
    {
        var done=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var thread=new Thread(()=>{
            try{
                using var root=new Form {Opacity=0,ShowInTaskbar=false};
                root.Shown+=(_,_)=>{
                    try{
                        root.Hide();
                        foreach(bool desk in new[]{true,false}){
                            using var window=new MainForm(desk,designPreview:true){Opacity=0,ShowInTaskbar=false};
                            try{
                                window.Show();
                                foreach(var size in new[]{new Size(944,660),new Size(1060,740)}){
                                    window.ClientSize=size;
                                    for(int pass=0;pass<5;pass++){window.PerformLayout();Application.DoEvents();}
                                    foreach(var panel in Descendants(window).OfType<FlowLayoutPanel>().Where(p=>p.AutoScroll))
                                        if(panel.HorizontalScroll.Visible)throw new Exception($"Unexpected horizontal scrolling on {(desk?"desk":"other PC")} at {window.ClientSize}: panel {panel.ClientSize}, children {string.Join(";",panel.Controls.Cast<Control>().Select(c=>$"{c.GetType().Name}:{c.Bounds},visible={c.Visible}"))}");
                                }
                            }finally{window.QuitApp();}
                        }
                        done.TrySetResult();
                    }catch(Exception error){done.TrySetException(error);}finally{root.Close();}
                };
                Application.Run(root);
            }catch(Exception error){done.TrySetException(error);}
        }){IsBackground=true,Name="DeviceBridge GUI layout checks"};
        thread.SetApartmentState(ApartmentState.STA);thread.Start();
        return done.Task.WaitAsync(TimeSpan.FromSeconds(20));
    }
    static IEnumerable<Control> Descendants(Control parent){foreach(Control child in parent.Controls){yield return child;foreach(var descendant in Descendants(child))yield return descendant;}}
}
