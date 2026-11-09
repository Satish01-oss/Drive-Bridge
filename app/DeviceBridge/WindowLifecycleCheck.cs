namespace DeviceBridge;

internal static class WindowLifecycleCheck
{
    public static Task RunAsync()
    {
        var done = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var thread = new Thread(() =>
        {
            try
            {
                using var root = new QuietForm(); using var session = new QuietForm();
                using var background = new BackgroundSession(session, () => true, () => { }, showIcon: false);
                int teardown = 0;
                session.FormClosing += (_, e) => { if (!e.Cancel) teardown++; };
                root.Shown += async (_, _) =>
                {
                    try
                    {
                        root.Hide(); session.Show(); session.WindowState = FormWindowState.Minimized; session.WindowState = FormWindowState.Maximized; session.WindowState = FormWindowState.Normal;
                        if (teardown != 0 || session.IsDisposed) throw new Exception("Window state changed session lifetime.");
                        session.Close();
                        await Task.Delay(40);
                        if (session.IsDisposed || session.Visible || teardown != 0) throw new Exception("Close did not retain the hidden session.");
                        background.Restore(activate: false);
                        await Task.Delay(40);
                        if (!session.Visible || session.IsDisposed) throw new Exception("Tray restore lost the session.");
                        background.Quit();
                        if (!session.IsDisposed || teardown != 1) throw new Exception("Explicit quit did not close the session exactly once.");
                        done.TrySetResult();
                    }
                    catch (Exception e) { done.TrySetException(e); }
                    finally { root.Close(); }
                };
                Application.Run(root);
            }
            catch (Exception e) { done.TrySetException(e); }
        }) { IsBackground = true, Name = "DeviceBridge window lifecycle check" };
        thread.SetApartmentState(ApartmentState.STA); thread.Start();
        return done.Task.WaitAsync(TimeSpan.FromSeconds(10));
    }
    sealed class QuietForm : Form
    {
        public QuietForm() { ShowInTaskbar = false; Opacity = 0; Width = 100; Height = 100; }
        protected override bool ShowWithoutActivation => true;
    }
}
