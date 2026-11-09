using System.Runtime.InteropServices;

namespace DeviceBridge;

internal static class AppActivation
{
    public const string Title = "DeviceBridge 0.7";
    public static readonly uint RestoreMessage = RegisterWindowMessage("DeviceBridge.RestoreSession.v1");
    public static bool RaiseExisting()
    {
        var root = FindWindow(null, Title);
        return root != 0 && PostMessage(root, RestoreMessage, 0, 0);
    }
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern nint FindWindow(string? name, string title);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern uint RegisterWindowMessage(string message);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] static extern bool PostMessage(nint window, uint message, nint wParam, nint lParam);
}
