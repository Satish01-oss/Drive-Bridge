using System.Diagnostics;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

namespace DeviceBridge;

public sealed record LocalAdapter(int Index, string Name, string Kind)
{
    public override string ToString() => Name + " (" + Kind + ")";
}

public static class NetworkSetup
{
    public static List<LocalAdapter> Adapters() => NetworkInterface.GetAllNetworkInterfaces()
        .Where(n => n.OperationalStatus == OperationalStatus.Up && n.NetworkInterfaceType != NetworkInterfaceType.Loopback && n.GetIPProperties().UnicastAddresses.Any(a => a.Address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork && Invitation.IsLocal(a.Address)))
        .Select(n => new LocalAdapter(n.GetIPProperties().GetIPv4Properties().Index, n.Name, n.NetworkInterfaceType == NetworkInterfaceType.Wireless80211 ? "Wi-Fi" : n.NetworkInterfaceType is NetworkInterfaceType.Ethernet or NetworkInterfaceType.GigabitEthernet or NetworkInterfaceType.FastEthernetFx or NetworkInterfaceType.FastEthernetT ? "Ethernet" : "local adapter")).ToList();
    public static string Profiles()
    {
        object? manager = null;
        try
        {
            var type = Type.GetTypeFromCLSID(new Guid("DCB00C01-570F-4A9B-8D69-199FDBA5723B"));
            manager = Activator.CreateInstance(type!); var categories = new HashSet<string>();
            foreach (dynamic network in ((dynamic)manager!).GetNetworks(1))
            {
                try { int category = network.GetCategory(); categories.Add(category switch { 0 => "Public", 1 => "Private", 2 => "Managed/domain", _ => "Unknown" }); }
                finally { if (Marshal.IsComObject(network)) Marshal.ReleaseComObject(network); }
            }
            return categories.Count == 0 ? "Unknown" : string.Join(", ", categories.Order());
        }
        catch { return "Unavailable"; }
        finally { if (manager != null && Marshal.IsComObject(manager)) Marshal.ReleaseComObject(manager); }
    }
    internal static string SetupScript(string executable, int adapterIndex)
    {
        if (adapterIndex < 1 || adapterIndex > 100000) throw new ArgumentException("Choose an active network adapter.");
        var quoted = "'" + executable.Replace("'", "''") + "'";
        var id = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(executable.ToUpperInvariant())))[..12];
        return "$ErrorActionPreference='Stop'; $app=" + quoted + "; $profile=Get-NetConnectionProfile -InterfaceIndex " + adapterIndex + "; " +
            "if(@($profile).Count -ne 1){throw 'Choose a single connected network'}; " +
            "if($profile.NetworkCategory -eq 'Public'){Set-NetConnectionProfile -InterfaceIndex " + adapterIndex + " -NetworkCategory Private} " +
            "elseif($profile.NetworkCategory -ne 'Private'){throw 'Ask your administrator to allow DeviceBridge on this managed network'}; " +
            "foreach($protocol in @('TCP','UDP')) { $name='DeviceBridge.PrivateLAN." + id + ".'+$protocol; " +
            "$rule=Get-NetFirewallRule -Name $name -ErrorAction SilentlyContinue; " +
            "if($rule){Set-NetFirewallRule -Name $name -Enabled True -Profile Private -Direction Inbound -Action Allow -Program $app -Protocol $protocol -RemoteAddress LocalSubnet -EdgeTraversalPolicy Block | Out-Null} " +
            "else {New-NetFirewallRule -Name $name -DisplayName ('DeviceBridge trusted LAN - '+$protocol) -Enabled True -Profile Private -Direction Inbound -Action Allow -Program $app -Protocol $protocol -RemoteAddress LocalSubnet -EdgeTraversalPolicy Block | Out-Null} }; ";
    }
    public static int RunElevated(int adapterIndex)
    {
        try
        {
            var script = SetupScript(Environment.ProcessPath!, adapterIndex);
            var start = new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "System32", "WindowsPowerShell", "v1.0", "powershell.exe")) { UseShellExecute = false, CreateNoWindow = true };
            start.ArgumentList.Add("-NoProfile"); start.ArgumentList.Add("-Command"); start.ArgumentList.Add(script);
            using var child = Process.Start(start)!; child.WaitForExit(); return child.ExitCode;
        }
        catch { return 1; }
    }
}

public sealed class NetworkSetupForm : Form
{
    public NetworkSetupForm()
    {
        Text = "DeviceBridge · Local network help"; ClientSize = new Size(640, 390); Font = new Font("Segoe UI", 10); StartPosition = FormStartPosition.CenterParent;
        var root = new FlowLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(24), FlowDirection = FlowDirection.TopDown, WrapContents = false };
        root.Controls.Add(new Label { Text = "Wi-Fi and Ethernet work together", AutoSize = true, Font = new Font("Segoe UI", 17, FontStyle.Bold) });
        var info = new Label { Text = "Both PCs must use the same local network. Guest Wi-Fi or router device isolation can prevent communication.\n\nCurrent Windows profile: " + NetworkSetup.Profiles(), AutoSize = true, MaximumSize = new Size(580, 0), Margin = new Padding(3, 12, 3, 14) }; root.Controls.Add(info);
        var adapters = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Width = 560 };
        foreach (var adapter in NetworkSetup.Adapters()) adapters.Items.Add(adapter);
        if (adapters.Items.Count > 0) adapters.SelectedIndex = 0;
        root.Controls.Add(adapters);
        var consent = new CheckBox { Text = "This is my trusted home/office network and I may configure it.", AutoSize = true, Margin = new Padding(3, 14, 3, 10) }; root.Controls.Add(consent);
        var setup = new Button { Text = "Allow DeviceBridge on this trusted network", AutoSize = true, Enabled = false }; root.Controls.Add(setup);
        var note = new Label { Text = "Windows administrator approval is required. This makes only the selected network Private and allows this app's TCP/UDP traffic from the local subnet. Windows Firewall stays enabled.", AutoSize = true, MaximumSize = new Size(580, 0), Margin = new Padding(3, 14, 3, 0) }; root.Controls.Add(note);
        consent.CheckedChanged += (_, _) => setup.Enabled = consent.Checked && adapters.SelectedItem != null;
        setup.Click += async (_, _) =>
        {
            if (adapters.SelectedItem is not LocalAdapter adapter) return;
            setup.Enabled = false;
            try
            {
                var start = new ProcessStartInfo(Environment.ProcessPath!) { UseShellExecute = true, Verb = "runas" };
                start.ArgumentList.Add("--allow-private-lan"); start.ArgumentList.Add(adapter.Index.ToString(System.Globalization.CultureInfo.InvariantCulture));
                using var process = Process.Start(start);
                if (process != null) { await process.WaitForExitAsync(); note.Text = process.ExitCode == 0 ? "Local network setup completed. Close this help and try a fresh connection key." : "Windows couldn't apply the network setup. Your administrator may need to allow the app. No firewall protection was disabled."; }
                info.Text = "Wi-Fi and Ethernet work together. Current Windows profile: " + NetworkSetup.Profiles();
            }
            catch (System.ComponentModel.Win32Exception) { note.Text = "Administrator approval was cancelled or unavailable. You can try again, or ask your network administrator."; }
            finally { setup.Enabled = consent.Checked; }
        };
        Controls.Add(root);
    }
}
