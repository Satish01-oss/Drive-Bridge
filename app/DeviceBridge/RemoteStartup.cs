using Microsoft.Win32;

namespace DeviceBridge;

internal interface IStartupRegistration
{
    string? Read();
    void Write(string? command);
}
internal sealed class CurrentUserStartup : IStartupRegistration
{
    const string PathName=@"Software\Microsoft\Windows\CurrentVersion\Run", ValueName="DeviceBridge.Remote";
    public string? Read() { using var key=Registry.CurrentUser.OpenSubKey(PathName); return key?.GetValue(ValueName) as string; }
    public void Write(string? command) { using var key=Registry.CurrentUser.CreateSubKey(PathName); if(command==null)key.DeleteValue(ValueName,false); else key.SetValue(ValueName,command,RegistryValueKind.String); }
}
internal sealed class RemoteStartup
{
    readonly IStartupRegistration registration;
    readonly string command;
    public RemoteStartup(string executable,IStartupRegistration? registration=null) { command=CommandFor(executable);this.registration=registration??new CurrentUserStartup(); }
    internal static string CommandFor(string executable)
    {
        if(!System.IO.Path.IsPathFullyQualified(executable)||!executable.EndsWith(".exe",StringComparison.OrdinalIgnoreCase)||executable.IndexOfAny(new[]{'"','\r','\n'})>=0)throw new ArgumentException("An absolute Windows app path is required.");
        return "\""+executable+"\" --remote --start-hidden";
    }
    public bool Enabled => string.Equals(registration.Read(),command,StringComparison.Ordinal);
    public void Set(bool enabled) { if(enabled)registration.Write(command); else if(Enabled)registration.Write(null); }
    internal static void Check(Action<bool,string> check)
    {
        var memory=new MemoryRegistration();var setting=new RemoteStartup(@"C:\Apps\Device Bridge\DeviceBridge.exe",memory);
        check(!setting.Enabled&&memory.Command==null,"Sign-in startup is opt-in and initially disabled");setting.Set(true);
        check(setting.Enabled&&memory.Command=="\"C:\\Apps\\Device Bridge\\DeviceBridge.exe\" --remote --start-hidden","Startup command quotes the executable and opens only the background remote host");setting.Set(false);
        check(!setting.Enabled&&memory.Command==null,"Disabling startup removes only the app's matching registration");memory.Command="different command";setting.Set(false);
        check(memory.Command=="different command","Disabling startup preserves an unrelated registration");
        try{CommandFor("DeviceBridge.exe");throw new Exception("Relative startup path accepted");}catch(ArgumentException){check(true,"Startup rejects relative executable paths");}
        try{CommandFor("C:\\Apps\\DeviceBridge.exe\" --extra");throw new Exception("Injected startup path accepted");}catch(ArgumentException){check(true,"Startup rejects malformed or injected executable paths");}
    }
    sealed class MemoryRegistration:IStartupRegistration { public string? Command;public string? Read()=>Command;public void Write(string? command)=>Command=command; }
}
