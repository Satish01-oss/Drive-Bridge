namespace DeviceBridge;

internal static class NavigationCheck
{
    public static Task RunAsync()
    {
        var done=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var thread=new Thread(()=>
        {
            try
            {
                using var menu=new WelcomeForm(designPreview:true) {Opacity=0,ShowInTaskbar=false};
                menu.Shown+=(_,_)=>
                {
                    try
                    {
                        menu.Open(true,false);var local=menu.LocalSession!;
                        local.GoToMainMenu();
                        if(!menu.Visible||local.IsDisposed||local.Visible)throw new Exception("Main menu disposed the local session.");
                        menu.Open(true,false);
                        if(!ReferenceEquals(local,menu.LocalSession)||!local.Visible||menu.Visible)throw new Exception("Continue replaced the local session.");
                        local.GoToMainMenu();menu.OpenRemote();var phone=menu.PhoneSession!;
                        phone.GoToMainMenu();menu.OpenRemote();
                        if(!ReferenceEquals(phone,menu.PhoneSession)||phone.IsDisposed||!phone.Visible)throw new Exception("Continue replaced the Android host.");
                        phone.GoToMainMenu();menu.Close();
                        if(menu.IsDisposed||menu.Visible||local.IsDisposed||phone.IsDisposed)throw new Exception("Menu X stopped background sharing.");
                        menu.ShowMenu();menu.Open(false,false);var receiver=menu.LocalSession!;
                        if(!local.IsDisposed||ReferenceEquals(local,receiver)||receiver.DeskMode||phone.IsDisposed)throw new Exception("Role switch did not replace only the local session.");
                        receiver.GoToMainMenu();
                        var localBack=receiver.Controls.Find("MainMenu",true).OfType<Button>().Single();
                        if(localBack.Text!="← Main menu"||phone.Controls.Find("MainMenu",true).Length!=1)throw new Exception("A mode is missing its visible Main menu button.");
                        menu.QuitAll();
                        if(!menu.IsDisposed||!receiver.IsDisposed||!phone.IsDisposed)throw new Exception("Quit left a session running.");
                        done.TrySetResult();
                    }
                    catch(Exception error){done.TrySetException(error);}
                    finally{if(!menu.IsDisposed)menu.QuitAll();}
                };
                Application.Run(menu);
            }
            catch(Exception error){done.TrySetException(error);}
        }){IsBackground=true,Name="DeviceBridge navigation checks"};
        thread.SetApartmentState(ApartmentState.STA);thread.Start();return done.Task.WaitAsync(TimeSpan.FromSeconds(20));
    }
}
